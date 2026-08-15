# Joy-Con 2版: Codexへ渡す続きの申し送り

## 現在地

同一repo `joycondex-controller` の中に、Joy-Con 2版を別appとして整理済み。

- Bridge: `apps/joycon2/bridge/`
- Codex Controller: `apps/joycon2/controller/`
- M5Stack版: `apps/m5-grip/`（設計のみ）

Bridgeは原則変更せず、Controller側でCodex操作を実装する。

実装済み:

- Bridge SSEの再接続クライアント
- 右Joy-Con 2限定
- ボタンEdge検出
- Stick latch
- Neutral Gate
- `+` 0.8秒長押しのMASTER ENABLE/DISABLE
- 切断・Watchdog時の強制DISABLE
- 設定済みボタンのVoiceKey TALK、ACTION、DELETE、NEW、FOCUS
- Stick左右の前後チャット移動
- macOS操作の直列化
- DRY RUN
- ローカル状態確認UI `127.0.0.1:8788`
- DISABLED中のボタン設定画面と即時反映
- マウス操作ON/OFF、机上センサー／持ち上げStickの自動切替
- HOME/Cによるタスク選択 上／下、ZRの机上クリック／持ち上げ時入力欄切替、Stick押込による左クリック
- 作業完了1回・ユーザー操作が必要な承認待ち3回のJoy-Con振動通知と強さ設定（自動審査は除外）
- Node標準テスト65件
- ルートからの一括起動 `.command`

## 最初に実機で確認すること

repoルートで:

```bash
npm test
```

続いて:

```bash
./START_JOYCON_DRY_RUN.command
```

DRY RUNで入力とSafety Gateが期待通りなら:

```bash
./START_JOYCON_LIVE.command
```

実機で確認:

1. Rを押している間だけVoiceKeyが録音し、解放後にCodexへ貼り付けるか
2. ChatGPT/Codexの実際のfrontmost process名
3. Aでcomposerが送信されるか
4. Bの全文Clearがcomposerだけへ作用するか
5. 机上センサーマウスと持ち上げ時Stickマウスの向き・感度
6. Accessibility / Automation権限が正しく通るか
7. TALKをSL/SRへ変更し、設定が再起動後も残るか
8. HOMEで上、Cで下のタスクを1つ選べるか
9. ZRとStick押込で左クリックできるか

## 重要な設計方針

- `apps/joycon2/bridge` は必要性が明確でない限り変更しない
- UI座標クリックは使わない
- V0はショートカット / deep link / 明示的ローカル操作を優先
- 危険操作は単一ボタンに追加しない
- App Server統合はV1として分離
- send/clear失敗時はdraftを復元する
- 音声操作失敗時は安全停止する
- M5Stack版へ流用するため、ハード固有入力と意味イベントを徐々に分離する

## 次に実装する優先順位

### P0: 実機差分の修正

- VoiceKeyの貼り付け確定待ち1秒が実機で十分か確認する
- frontmost app判定の実機確認
- composer送信方法を設定化
- B Clearの安全性を確認
- センサー／Stickマウスの感度を実機に合わせる

### P1: UX検証

数日使い、以下を記録する:

- TALKはZRで快適か
- ACTION/CANCELは状態依存で十分か
- NEWはどれくらい使うか
- FOCUSの使用頻度
- StickでのAgent/Thread移動が自然か
- 空いているR/C/Stick押込に何が本当に必要か

候補:

- R: CONTEXT / Screenshot
- C(chat): Attention Queue
- Stick押込: 選択Threadを開く

### P2: 共通層抽出

UXが固まってからのみ:

- `packages/core`: semantic actions / safety state
- `packages/mac-bridge`: Mac/Codex操作、voice HUD

へ抽出する。

### P3: App Server統合

- thread list/status取得
- Stickで実thread選択
- FOCUSで選択threadを開く
- B長押しで安全なinterrupt
- 承認待ちを検知し、ACTION/CANCELを状態依存切替
- Attention Queue

この段階はV0実機確認と別変更にする。

### P4: Joy-Con出力

右Joy-Con 2の振動出力をV1.1で追加済み。Codexの`Stop`と`PermissionRequest` Hookを、Controllerのローカル通知口からBridgeへ渡す。

LED feedbackと、確実な通知口がないエラー自動振動は別作業にする。
