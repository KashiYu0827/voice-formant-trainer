// =====================
// 定数
// =====================
const FORMANT_LOW  = 2500;   // Singer's Formant 下限Hz
const FORMANT_HIGH = 3500;   // Singer's Formant 上限Hz
const FFT_SIZE     = 2048;
const SMOOTHING    = 0.8;
const MAX_FREQ     = 8000;   // 表示する最大周波数
// ゲージ閾値
const GAUGE_MID    = 0.10;   // 10%以上で黄
const GAUGE_HIGH   = 0.20;   // 20%以上で緑

// =====================
// 状態
// =====================
let audioContext = null;
let analyser     = null;
let source       = null;
let tracks       = [];
let animationId  = null;
let isRunning    = false;

// =====================
// ヘルパー
// =====================
function freqToBin(freq, sampleRate, fftSize) {
  return Math.round(freq / (sampleRate / fftSize));
}

function resizeCanvas(canvas) {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

// =====================
// 波形描画
// =====================
function drawWaveform(canvas, analyser) {
  const ctx    = resizeCanvas(canvas);
  const W      = canvas.getBoundingClientRect().width;
  const H      = canvas.getBoundingClientRect().height;
  const bufLen = analyser.fftSize;
  const data   = new Uint8Array(bufLen);
  analyser.getByteTimeDomainData(data);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0d1e';
  ctx.fillRect(0, 0, W, H);

  // 中心線
  ctx.strokeStyle = '#333366';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  // 波形
  ctx.strokeStyle = '#7ecfff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const sliceW = W / bufLen;
  let x = 0;
  for (let i = 0; i < bufLen; i++) {
    const v = data[i] / 128.0;
    const y = (v * H) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
    x += sliceW;
  }
  ctx.stroke();
}

// =====================
// スペクトル描画
// =====================
function drawSpectrum(canvas, analyser, sampleRate) {
  const ctx    = resizeCanvas(canvas);
  const W      = canvas.getBoundingClientRect().width;
  const H      = canvas.getBoundingClientRect().height;
  const bufLen = analyser.frequencyBinCount;
  const data   = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(data);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d0d1e';
  ctx.fillRect(0, 0, W, H);

  // 2500-3500Hz 帯域ハイライト
  const lowBin  = freqToBin(FORMANT_LOW,  sampleRate, FFT_SIZE);
  const highBin = freqToBin(FORMANT_HIGH, sampleRate, FFT_SIZE);
  const maxBin  = freqToBin(MAX_FREQ,     sampleRate, FFT_SIZE);

  // 表示するビン数
  const displayBins = Math.min(maxBin, bufLen);

  const highlightX1 = (lowBin  / displayBins) * W;
  const highlightX2 = (highBin / displayBins) * W;

  ctx.fillStyle = 'rgba(255, 140, 0, 0.18)';
  ctx.fillRect(highlightX1, 0, highlightX2 - highlightX1, H);

  // スペクトルバー
  const barW = W / displayBins;
  for (let i = 0; i < displayBins; i++) {
    const barH = (data[i] / 255) * H;
    const x    = i * barW;
    const inFormant = (i >= lowBin && i < highBin);
    ctx.fillStyle = inFormant ? '#ff8c00' : 'rgba(200, 220, 255, 0.85)';
    ctx.fillRect(x, H - barH, Math.max(barW - 1, 1), barH);
  }

  // 帯域境界線
  ctx.strokeStyle = 'rgba(255, 140, 0, 0.7)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(highlightX1, 0);
  ctx.lineTo(highlightX1, H);
  ctx.moveTo(highlightX2, 0);
  ctx.lineTo(highlightX2, H);
  ctx.stroke();
  ctx.setLineDash([]);

  // 軸ラベル
  const labels = [
    { freq: 0,    label: '0' },
    { freq: 1000, label: '1k' },
    { freq: 2000, label: '2k' },
    { freq: 3000, label: '3k' },
    { freq: 4000, label: '4k' },
    { freq: 8000, label: '8k Hz' },
  ];
  ctx.fillStyle = '#aaa';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (const { freq, label } of labels) {
    const bin = freqToBin(freq, sampleRate, FFT_SIZE);
    const lx  = (bin / displayBins) * W;
    const clampedX = Math.min(Math.max(lx, 10), W - 10);
    ctx.fillText(label, clampedX, H - 4);
  }
}

// =====================
// ゲージ更新
// =====================
function updateGauge(analyser, sampleRate) {
  const bufLen = analyser.frequencyBinCount;
  const data   = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(data);

  const lowBin  = freqToBin(FORMANT_LOW,  sampleRate, FFT_SIZE);
  const highBin = freqToBin(FORMANT_HIGH, sampleRate, FFT_SIZE);

  let bandSum  = 0;
  let totalSum = 0;
  for (let i = 0; i < bufLen; i++) {
    totalSum += data[i];
    if (i >= lowBin && i < highBin) bandSum += data[i];
  }

  const ratio = totalSum > 0 ? bandSum / totalSum : 0;
  const pct   = Math.min(ratio * 100, 100).toFixed(1);

  // カラー
  let color;
  if (ratio >= GAUGE_HIGH)     color = '#22c55e'; // 緑
  else if (ratio >= GAUGE_MID) color = '#eab308'; // 黄
  else                         color = '#6b7280'; // グレー

  const gaugeBar  = document.getElementById('gaugeBar');
  const gaugeText = document.getElementById('gaugeText');

  // ゲージバー本体のバー幅
  const fillEl = document.getElementById('gaugeFill');
  if (fillEl) {
    fillEl.style.width = `${Math.min(ratio * 100, 100)}%`;
    fillEl.style.background = color;
  }
  gaugeText.textContent = `${pct}%`;
  gaugeText.style.color = color;
}

// =====================
// マイク起動
// =====================
async function startMic() {
  try {
    // iOS Safari 対応: ボタンタップ後に AudioContext を生成
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    tracks = stream.getTracks();

    analyser = audioContext.createAnalyser();
    analyser.fftSize             = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;

    source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    isRunning = true;
    drawLoop();
  } catch (err) {
    alert('マイクへのアクセスに失敗しました: ' + err.message);
    isRunning = false;
    updateMicBtn(false);
  }
}

// =====================
// マイク停止
// =====================
function stopMic() {
  isRunning = false;
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  tracks.forEach(t => t.stop());
  tracks = [];
  if (source) {
    source.disconnect();
    source = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  analyser = null;

  // キャンバスをクリア
  ['waveform', 'spectrum'].forEach(id => {
    const canvas = document.getElementById(id);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  // ゲージリセット
  const fillEl = document.getElementById('gaugeFill');
  if (fillEl) { fillEl.style.width = '0%'; fillEl.style.background = '#6b7280'; }
  document.getElementById('gaugeText').textContent = '0%';
  document.getElementById('gaugeText').style.color = '#6b7280';
}

// =====================
// 描画ループ
// =====================
function drawLoop() {
  if (!isRunning || !analyser) return;
  const sampleRate = audioContext.sampleRate;

  drawWaveform(document.getElementById('waveform'), analyser);

  // スペクトルは展開中のみ描画
  if (document.getElementById('spectrumSection').classList.contains('open')) {
    drawSpectrum(document.getElementById('spectrum'), analyser, sampleRate);
  }

  updateGauge(analyser, sampleRate);

  animationId = requestAnimationFrame(drawLoop);
}

// =====================
// ボタン表示更新
// =====================
function updateMicBtn(on) {
  const btn = document.getElementById('micBtn');
  btn.textContent = on ? 'マイク OFF' : 'マイク ON';
  btn.classList.toggle('on', on);
}

// =====================
// micBtn イベントリスナー
// =====================
document.getElementById('micBtn').addEventListener('click', () => {
  if (!isRunning) {
    updateMicBtn(true);
    startMic();
  } else {
    stopMic();
    updateMicBtn(false);
  }
});

// =====================
// スペクトル アコーディオン
// =====================
document.getElementById('spectrumSection').addEventListener('click', () => {
  const section = document.getElementById('spectrumSection');
  section.classList.toggle('open');
});

// =====================
// リサイズハンドラ
// =====================
window.addEventListener('resize', () => {
  // 次のフレームで自動的に resizeCanvas が呼ばれるので特別な処理は不要
  // ただし停止中は一度クリアしておく
  if (!isRunning) {
    ['waveform', 'spectrum'].forEach(id => {
      const canvas = document.getElementById(id);
      const dpr  = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width  = rect.width  * dpr;
      canvas.height = rect.height * dpr;
    });
  }
});
