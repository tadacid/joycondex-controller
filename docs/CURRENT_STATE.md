# Current State

## 2026-08-14 時点

Joy-Con 2版のV0は、既存Bridgeの横に安全制御付きControllerを追加するところまで実装済みです。

### `apps/joycon2/bridge`

既存実装。主な役割:

- macOS CoreBluetoothでJoy-Con 2 L/Rを探索・接続
- 63 byte通知を受信
- ボタン・Stick・IMU等の生データをSwiftからJSONL出力
- Node側で共通形式へ正規化
- `http://127.0.0.1:8787/events` からSSE配信
- `/health` を提供

原則として既存Bridgeは変更しません。

### `apps/joycon2/controller`

追加済みV0。実装済み:

- Bridge SSE再接続
- 右Joy-Con 2限定入力
- ボタンEdge検出
- Stick latch
- Neutral Gate
- `+` 0.8秒長押しMASTER ENABLE/DISABLE
- 切断・watchdog時の強制DISABLE
- 設定済みボタンのホールド中だけVoiceKey TALK（localhostの`/start`・`/stop`）
- A ACTION
- B CANCEL
- Y NEW
- X短押しでEscape、長押しで最新メッセージまで移動
- Stick左右で前後チャット移動
- Mac操作直列化
- DRY RUN
- `127.0.0.1:8788` デバッグUI
- DISABLED中のボタン設定画面と原子的保存
- マウス操作ON/OFF、机上の光学センサー／持ち上げ時Stickの自動切替
- HOME/Cによるタスク選択 上／下、ZRの机上左クリック／持ち上げ時メイン・サイド入力欄切替、Stick押込による左クリック
- SR/SLによる推論レベル 上／下
- HOME/Cは競合するControl+Tabを避け、Codexの専用ショートカットで左サイドバーの前／次チャットを検索画面なしで切替
- Bridge/SSE切断時のVoiceKey停止と再ニュートラル要求
- Node標準テスト

### テスト

Controllerの自動テストは現在49件あり、全件Pass確認済み。

Mac上のLIVE実行でJoy-Con 2の検出・接続、VoiceKey開始／停止、A送信、B長押しクリア、HOME/C移動、SR/SL推論変更、持ち上げ時ZRのメイン／サイド入力欄切替まで操作ログを確認済みです。整理版への最終再起動後はControllerとBridgeが正常起動し、個人設定（机上速度0.4、Stick速度108）も維持されています。再起動直後はJoy-Conがスリープ中でBridgeは`scanning / devices: 0`でした。

再編後もルートで:

```bash
npm test
```

を実行する。

## 未確認

Joy-Con 2実機で、以下を最終確認:

- X長押しが最新メッセージ移動として実用上十分か
- 机上／持ち上げ境界でZRが誤クリックしないか
- VoiceKey録音中の実切断で停止が確実に働くか
- 数日使用した時の再接続と速度設定の安定性
