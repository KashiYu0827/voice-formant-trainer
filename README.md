# 🎙️ 通る声トレーナー

ブラウザだけで動く **Singer's Formant** リアルタイム可視化ツール。依存ゼロ、Web Audio API のみ使用。

---

## Singer's Formant とは

プロの声楽家や舞台俳優に共通してみられる **2500〜3500 Hz 帯域の共鳴エネルギーの集中**のこと。
この帯域が強調されると、オーケストラの中でも声が「抜けて聞こえる」——いわゆる「通る声」になります。
ゲージが **20% 以上（緑）** を目指して練習しましょう。

---

## 使い方

1. **URL をブラウザで開く**（ローカルなら `index.html` をダブルクリック、または GitHub Pages URL へ）
2. **「マイク ON」ボタンをタップ**（iOS Safari ではボタン操作後に AudioContext が起動します）
3. **マイクに向かって発声する**
   - 「ア」「イ」など母音をロングトーンで出す
   - 喉を開いて共鳴させる意識で
4. **ゲージを確認**
   - グレー（< 10%）: まだ弱い
   - 黄（10〜20%）: 改善中
   - 緑（≥ 20%）: Singer's Formant が出ている！

---

## GitHub Pages デプロイ手順

```bash
# 1. リモートリポジトリを作成（GitHub CLI）
gh repo create voice-formant-trainer --public --source=. --remote=origin --push

# 2. GitHub リポジトリの Settings → Pages を開く
#    Source: "Deploy from a branch"
#    Branch: main / (root)
#    → Save

# 以降は git push origin main だけで自動デプロイされます
git push origin main
```

デプロイ後の URL: `https://<your-github-username>.github.io/voice-formant-trainer/`

---

## 技術メモ

| 項目 | 内容 |
|------|------|
| FFT サイズ | 2048 |
| スムージング | 0.8 |
| 表示帯域 | 0〜8 kHz（線形スケール） |
| ゲージ計算 | Σ(帯域内) / Σ(全体) |
| 高 DPI 対応 | devicePixelRatio スケーリング |

---

## フィードバックメモ

<!-- ここに気づいたことや改善案を書いておく -->

- [ ] 発声時の最大値・平均値を記録して履歴表示したい
- [ ] ピーク保持（peak hold）をスペクトルに追加する
- [ ] 録音して後から振り返れる機能
- [ ] ターゲット周波数帯域を変更できるスライダー
