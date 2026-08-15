# Joy-Con 2 Bridge

Joy-Con 2の接続をMac側で維持し、複数のローカルWebアプリへ入力を配る単体ツールです。

## 起動

```bash
cd joycon2-bridge
pnpm start
```

初回にmacOSのBluetooth許可が表示されたら許可します。起動中は、Webアプリを再読み込みしてもJoy-Con 2との接続が残ります。

## 受け取り

```js
const joyCon = new EventSource("http://127.0.0.1:8787/events");

joyCon.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  if (event.type !== "input") return;

  console.log(event.side); // left / right
  console.log(event.buttons); // A、B、方向キーなど
  console.log(event.motionPower); // 振りの強さ 0〜1
  console.log(event.stick); // x / y、各 -1〜1
};
```

接続状態は `connected` / `disconnected`、共通入力は `input`、生データは `frame` として届きます。
状態確認は `http://127.0.0.1:8787/health` です。

## 振動出力

右Joy-Con 2の振動特性を検出し、Controllerから次のローカル専用APIで短い通知を送れます。

```text
POST http://127.0.0.1:8787/feedback/rumble
POST http://127.0.0.1:8787/feedback/stop
```

振動回数、1回の長さ、合計時間、強さはBridge側でも制限します。1回の途中はJoy-Con 2用の連続振動データを12ms間隔で更新し、停止パケットまで鳴らします。新しい要求が来た時と切断・終了時は、実行中の振動を停止します。ブラウザからの直接POSTは受け付けません。

環境変数 `JOYCON_BRIDGE_PORT` で待受ポートを変更できます。
