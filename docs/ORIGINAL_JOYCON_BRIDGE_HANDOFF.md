# Joy-Con 2 Bridge / ChatGPT・Codex操作向け申し送り

## 目的

既存の「Joy-Con 2をMacへつなぐ入力Bridge」を使い、Joy-ConからCodexを安全に操作する方法を検討・実装したい。

このZIPは、ゲーム本体ではなく接続部分だけを抜き出したもの。既存BridgeはJoy-Con入力の取得とローカル配信まで完成している。Codex操作への割り当て部分は未実装。

## 現在の構成

1. `native/main.swift`
   - macOSのCoreBluetoothでJoy-Con 2 L/Rを直接検索・接続する。
   - ボタン、スティック、加速度、ジャイロを含む63 bytesの通知を受け取る。
   - 受信内容をJSON Linesとして標準出力へ流す。
2. `server.mjs`
   - Swift製の接続役を子プロセスとして起動する。
   - 生データからボタン、スティック、振りの強さなどを共通形式へ変換する。
   - `http://127.0.0.1:8787/events` からSSEで複数のローカルアプリへ配信する。
3. `kirari-reference/local-bridge.ts`
   - 既存Webアプリ側の受信例。接続確認、左右の割り当て、振り判定、再接続を含む。

## 起動方法

必要環境はApple Silicon Mac、Node.js 22以上、Xcode Command Line Tools。

```bash
cd joycon2-bridge
npm run start
```

または `pnpm start`。初回にmacOSのBluetooth許可が出たら許可する。

Joy-Con 2のSYNCボタンをランプが流れるまで長押しする。通常のmacOS Bluetooth一覧に表示されなくても、BridgeはCoreBluetoothから直接検出できる。

## 受信方法

```js
const source = new EventSource("http://127.0.0.1:8787/events");

source.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  if (event.type !== "input") return;
  console.log(event.side);        // left / right
  console.log(event.buttons);     // a, b, x, y, dpadUp, plus など
  console.log(event.stick);       // x / y: -1〜1
  console.log(event.motionPower); // 0〜1
};
```

状態確認は `GET http://127.0.0.1:8787/health`。

主なイベントは `ready`、`scanning`、`found`、`connected`、`disconnected`、`input`、`frame`、`error`。

## 2026-08-13の確認結果

- 同梱のarm64実行ファイルは起動できた。
- BridgeはJoy-Con 2 (R)を実際に検出した。
- `/health` は応答した。
- この確認ではSYNC操作をしていないため、接続完了後の入力までは再確認していない。
- 元プロジェクトでは左右2本の同時接続、実機ボタン、IMU、ゲーム入力への利用まで確認済み。

## Codex操作へ転用する際の希望

- Bridge本体はなるべく変えず、Codex操作用の別アプリまたは別の受信処理を追加したい。
- ボタンの押し始めだけを1回として扱い、長押し連打を防ぐ。
- 最初は「選択移動」「決定」「戻る」「音声入力開始・停止」など、元に戻しやすい操作に限定する。
- 削除、公開、送信、シェル実行など危険な操作をJoy-Conの1ボタンだけで確定しない。
- Codexの内部仕様に強く依存する直接操作より、キーボードショートカットまたは明示したローカル操作APIを優先して比較したい。
- 接続切れ、二重入力、別アプリが手前にある場合の誤操作を防ぐ停止スイッチを設けたい。
- まず小さい試作として、ボタン状態を画面表示し、操作先を切り替えられる形を提案してほしい。

## 現時点の制限・注意

- `.app`形式のGUIではなく、ターミナルから起動するローカルツール。
- 入力専用。Joy-Conの振動やLEDを操作する送信APIはない。
- 自動起動、メニューバー表示、設定画面はない。
- HTTP待受は `127.0.0.1` 限定だが、SSEには `Access-Control-Allow-Origin: *` が付く。Codex操作へ使う場合は、利用元制限や一時トークンも検討する。
- `native/build/joycon2-bridge` はApple Silicon向けの既存ビルド。ソースから再ビルド可能。

## ChatGPTへの依頼文

このZIPを読み、既存のJoy-Con 2 Bridgeを活かして、Joy-ConでMac版Codexを安全に操作する最小構成を提案してください。まず、Codexの操作方法として「キーボード操作」「画面操作」「利用可能なら公式な操作口」の違いを整理し、壊れにくさと安全性で第一案を選んでください。その後、ボタン割り当て、誤操作防止、必要な追加ファイル、実装順を具体化してください。既存Bridgeの変更は必要最小限にしてください。
