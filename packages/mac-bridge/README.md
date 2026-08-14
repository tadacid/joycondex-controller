# packages/mac-bridge

将来、入力デバイスに依存しないMac/Codex側の処理を置く予定です。

候補:

- Codex focus / deep link / shortcuts
- 音声入力・文字起こしHUD
- Screenshot / CONTEXT
- Codex App Server integration
- Thread/Agent state sync
- M5 RGB / Buzzerへのfeedback

現時点の実装は `apps/joycon2/controller/src/macos-actions.mjs` にあります。
Joy-Con V0の実機確認後、共通化する価値が固まってから抽出します。
