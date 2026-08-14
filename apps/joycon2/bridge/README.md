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

環境変数 `JOYCON_BRIDGE_PORT` で待受ポートを変更できます。
