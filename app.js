// =====================
// 定数
// =====================
const FFT_SIZE  = 2048;
const SMOOTHING = 0.8;
const MAX_FREQ  = 8000;

// モード設定
const MODES = {
  singing: {
    low:      2500,
    high:     3500,
    mid:      0.10,
    high_th:  0.20,
    label:    'Singer\'s Formant（2500–3500 Hz）',
    legend:   [{ pct: '10%', color: 'yellow', text: '10% — 黄ゾーン' },
               { pct: '20%', color: 'green',  text: '20% — 通る声ゾーン' }],
    hint:     '20%以上で「通る声」ゾーン',
    highlight: 'rgba(255, 140, 0, 0.18)',
    barColor:  '#ff8c00',
  },
  speech: {
    low:      2000,
    high:     5000,
    mid:      0.20,
    high_th:  0.35,
    label:    'Twang / プレゼンス（2000–5000 Hz）',
    legend:   [{ pct: '20%', color: 'yellow', text: '20% — 黄ゾーン' },
               { pct: '35%', color: 'green',  text: '35% — 通る声ゾーン' }],
    hint:     '35%以上で「通る話し声」ゾーン',
    highlight: 'rgba(100, 200, 255, 0.15)',
    barColor:  '#38bdf8',
  },
};

let currentMode = 'singing';

// =====================
// 状態
// =====================
let audioContext  = null;
let analyser      = null;
let source        = null;
let tracks        = [];
let animationId   = null;
let isRunning     = false;
let sustainedStart = null;   // 通る声ゾーン突入タイムスタンプ
const SUSTAINED_MS = 500;    // 何ms継続でグロー発動

// 計測状態
let isMeasuring     = false;
let measureVoice    = 0;
let measureGreen    = 0;
let measureYellow   = 0;

// 動的ノイズフロア
let noiseFloor      = 0;     // キャリブレーション後にセット
let calibFrames     = [];    // キャリブレーション用バッファ
let isCalibrating   = false;
const CALIB_MS      = 3000;  // 起動後何ms環境ノイズを計測するか
const VAD_MULTIPLIER = 3.0;  // ノイズフロアの何倍以上で有声とみなすか
let calibStartTime  = 0;

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

  // モードに応じた帯域ハイライト
  const mode    = MODES[currentMode];
  const lowBin  = freqToBin(mode.low,  sampleRate, FFT_SIZE);
  const highBin = freqToBin(mode.high, sampleRate, FFT_SIZE);
  const maxBin  = freqToBin(MAX_FREQ,  sampleRate, FFT_SIZE);

  const displayBins = Math.min(maxBin, bufLen);

  const highlightX1 = (lowBin  / displayBins) * W;
  const highlightX2 = (highBin / displayBins) * W;

  ctx.fillStyle = mode.highlight;
  ctx.fillRect(highlightX1, 0, highlightX2 - highlightX1, H);

  // スペクトルバー
  const barW = W / displayBins;
  for (let i = 0; i < displayBins; i++) {
    const barH = (data[i] / 255) * H;
    const x    = i * barW;
    const inBand = (i >= lowBin && i < highBin);
    ctx.fillStyle = inBand ? mode.barColor : 'rgba(200, 220, 255, 0.85)';
    ctx.fillRect(x, H - barH, Math.max(barW - 1, 1), barH);
  }

  // 帯域境界線
  ctx.strokeStyle = currentMode === 'speech' ? 'rgba(56, 189, 248, 0.7)' : 'rgba(255, 140, 0, 0.7)';
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
// ゲージ更新（モード対応 + SPR + 持続グロー）
// =====================
function updateGauge(analyser, sampleRate) {
  const mode   = MODES[currentMode];
  const bufLen = analyser.frequencyBinCount;
  const data   = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(data);

  // --- 帯域エネルギー比率 ---
  const lowBin  = freqToBin(mode.low,  sampleRate, FFT_SIZE);
  const highBin = freqToBin(mode.high, sampleRate, FFT_SIZE);

  let bandSum = 0, totalSum = 0;
  for (let i = 0; i < bufLen; i++) {
    totalSum += data[i];
    if (i >= lowBin && i < highBin) bandSum += data[i];
  }
  const ratio = totalSum > 0 ? bandSum / totalSum : 0;
  const pct   = Math.min(ratio * 100, 100).toFixed(1);

  // --- SPR: 2–4kHz / 0–2kHz ---
  const spr2kBin = freqToBin(2000, sampleRate, FFT_SIZE);
  const spr4kBin = freqToBin(4000, sampleRate, FFT_SIZE);
  let lowBandSum = 0, highBandSum = 0;
  for (let i = 0; i < bufLen; i++) {
    if (i < spr2kBin)                       lowBandSum  += data[i];
    else if (i >= spr2kBin && i < spr4kBin) highBandSum += data[i];
  }
  const spr = lowBandSum > 0 ? highBandSum / lowBandSum : 0;

  // --- カラー（モードごとの閾値） ---
  let color;
  if (ratio >= mode.high_th)  color = '#22c55e';
  else if (ratio >= mode.mid) color = '#eab308';
  else                        color = '#6b7280';

  // --- ゲージバー幅をモードの高閾値に対して正規化 ---
  const fillPct = Math.min((ratio / mode.high_th) * 80, 100);
  const fillEl  = document.getElementById('gaugeFill');
  if (fillEl) { fillEl.style.width = `${fillPct}%`; fillEl.style.background = color; }

  document.getElementById('gaugeText').textContent = `${pct}%`;
  document.getElementById('gaugeText').style.color = color;

  // --- SPR表示 ---
  const sprEl = document.getElementById('sprText');
  if (sprEl) {
    sprEl.textContent = `SPR ${spr.toFixed(2)}`;
    sprEl.style.color = spr >= 1.0 ? '#22c55e' : spr >= 0.5 ? '#eab308' : '#556699';
  }

  // --- キャリブレーション（環境ノイズ計測） ---
  if (isCalibrating) {
    calibFrames.push(totalSum);
    const elapsed = Date.now() - calibStartTime;
    const remaining = Math.ceil((CALIB_MS - elapsed) / 1000);
    document.getElementById('measureBtn').textContent = `環境音を計測中… ${remaining}`;
    if (elapsed >= CALIB_MS) {
      isCalibrating = false;
      noiseFloor = calibFrames.reduce((a, b) => a + b, 0) / calibFrames.length;
      document.getElementById('measureBtn').textContent = '計測スタート';
    }
    return;
  }

  // --- 計測フレーム集計（ノイズフロアの3倍超で有声） ---
  const vadThreshold = noiseFloor * VAD_MULTIPLIER;
  if (isMeasuring && totalSum > vadThreshold) {
    measureVoice++;
    if (ratio >= mode.high_th)  measureGreen++;
    else if (ratio >= mode.mid) measureYellow++;
  }

  // --- 持続グロー ---
  const gaugeBar    = document.getElementById('gaugeBar');
  const sustainedEl = document.getElementById('sustainedLabel');
  if (ratio >= mode.high_th) {
    if (!sustainedStart) sustainedStart = Date.now();
    if (Date.now() - sustainedStart >= SUSTAINED_MS) {
      gaugeBar.classList.add('sustained');
      if (sustainedEl) sustainedEl.classList.add('visible');
    }
  } else {
    sustainedStart = null;
    gaugeBar.classList.remove('sustained');
    if (sustainedEl) sustainedEl.classList.remove('visible');
  }
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

    isRunning      = true;
    isCalibrating  = true;
    calibFrames    = [];
    calibStartTime = Date.now();
    noiseFloor     = 0;

    const btn = document.getElementById('measureBtn');
    btn.classList.remove('not-ready');
    btn.textContent = 'キャリブレーション中…';

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
  document.getElementById('sprText').textContent = 'SPR —';
  document.getElementById('sprText').style.color = '#556699';
  sustainedStart = null;
  document.getElementById('gaugeBar').classList.remove('sustained');
  document.getElementById('sustainedLabel').classList.remove('visible');
  isMeasuring = false;
  isCalibrating = false;
  const mBtn = document.getElementById('measureBtn');
  mBtn.classList.add('not-ready');
  mBtn.classList.remove('measuring');
  mBtn.textContent = '計測スタート';
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
// 計測スコア
// =====================
function showScore() {
  const mode     = MODES[currentMode];
  const greenPct  = measureVoice > 0 ? (measureGreen  / measureVoice) * 100 : 0;
  const yellowPct = measureVoice > 0 ? (measureYellow / measureVoice) * 100 : 0;
  const grayPct   = Math.max(0, 100 - greenPct - yellowPct);

  const card = document.getElementById('scoreCard');
  card.hidden = false;

  // スコア見出し（通る声率）
  const headEl = document.getElementById('scoreHeadline');
  let grade, gradeColor;
  if (greenPct >= 60)      { grade = 'S  通る声マスター'; gradeColor = '#22c55e'; }
  else if (greenPct >= 40) { grade = 'A  いい感じ！';     gradeColor = '#4ade80'; }
  else if (greenPct >= 20) { grade = 'B  もう少し';       gradeColor = '#eab308'; }
  else                     { grade = 'C  練習あるのみ';   gradeColor = '#6b7280'; }

  headEl.textContent  = `通る声率 ${greenPct.toFixed(0)}%  ${grade}`;
  headEl.style.color  = gradeColor;

  // 内訳バー
  document.getElementById('scoreGreen').style.width  = `${greenPct}%`;
  document.getElementById('scoreYellow').style.width = `${yellowPct}%`;

  // 内訳テキスト
  document.getElementById('scoreDetail').textContent =
    `緑 ${greenPct.toFixed(0)}%  黄 ${yellowPct.toFixed(0)}%  測定フレーム ${measureVoice}`;
}

document.getElementById('measureBtn').addEventListener('click', () => {
  const btn = document.getElementById('measureBtn');
  if (btn.classList.contains('not-ready')) return;  // 未準備なら無視

  if (!isMeasuring) {
    isMeasuring   = true;
    measureVoice  = 0;
    measureGreen  = 0;
    measureYellow = 0;
    document.getElementById('scoreCard').hidden = true;
    btn.textContent = '計測ストップ';
    btn.classList.add('measuring');
  } else {
    isMeasuring = false;
    btn.textContent = '計測スタート';
    btn.classList.remove('measuring');
    showScore();
  }
});

// =====================
// モード切替
// =====================
function applyMode(modeName) {
  currentMode = modeName;
  const mode  = MODES[modeName];

  document.getElementById('gaugeLabel').textContent = mode.label;
  document.getElementById('gaugeText').textContent  = '0%';
  document.getElementById('sprText').textContent    = 'SPR —';
  document.querySelector('#sustainedLabel').classList.remove('visible');
  document.querySelector('#gaugeBar').classList.remove('sustained');

  const fillEl = document.getElementById('gaugeFill');
  if (fillEl) { fillEl.style.width = '0%'; fillEl.style.background = '#6b7280'; }

  // 閾値マーカーをJS制御に変更（CSS変数経由）
  document.documentElement.style.setProperty('--marker-mid',  `${mode.mid  * 100}%`);
  document.documentElement.style.setProperty('--marker-high', `${mode.high_th * 100}%`);

  sustainedStart = null;
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyMode(btn.dataset.mode);
  });
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
