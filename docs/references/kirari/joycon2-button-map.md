# Joy-Con 2 実機調査表

更新日：2026-08-03

## 現在地

- Gamepad API・WebHIDの確認UIは `/controller` に実装済み
- Nintendo vendorId `0x057e` で端末選択できる
- productId・collection数・input report ID・生バイトをローカル表示できる
- Joy-Con 2実機のBLE・IMU値を測定済み。ゲームで使う左右の主要ボタンは実押下で照合済み
- 2026-08-02のMac通常Bluetooth / IOHIDではNintendo / Joy-Con端末は表示されないことを確認
- CoreBluetoothによる直接スキャンではJoy-Con 2 L/Rの2本を検出し、各63 bytesの入力通知を受信
- Chrome用`WebBluetoothJoyConAdapter`を実装。アプリ内ブラウザはWeb Bluetooth未対応
- ChromeのIntegration Labで左右2本の同時接続、実機攻撃14回、2人技5回の成立を確認
- 実カメラPoseとの同時稼働を確認（640×360、確認時の推論約37ms）

## 接続結果

| 項目 | Left | Right |
| --- | --- | --- |
| productName | Joy-Con 2 (L) | Joy-Con 2 (R) |
| BLE company ID | `0x0553` | `0x0553` |
| productId | BLEでは非公開 | BLEでは非公開 |
| GATT services | 2 | 2 |
| input notify | `AB7DE9BE-89FE-49AD-828F-118F09DF7FD2` / 63 bytes | 同左 |
| update rate | 約33Hz | 約33Hz |

## ボタンマッピング

| 操作 | Left report / byte / bit | Right report / byte / bit |
| --- | --- | --- |
| SL | byte 6 / bit 5 | byte 4 / bit 5 |
| SR | byte 6 / bit 4 | byte 4 / bit 4 |
| L / R | byte 6 / bit 6 | byte 4 / bit 6 |
| ZL / ZR | byte 6 / bit 7 | byte 4 / bit 7 |
| スティック押し込み | byte 5 / bit 3 | byte 5 / bit 2 |
| - / + | byte 5 / bit 0 | byte 5 / bit 1 |
| 方向キー / ABXY | ↓/↑/→/← = byte 6 / bit 0/1/2/3 | Y/X/B/A = byte 4 / bit 0/1/2/3 |

2026-08-03にChromeの測定UIで各ボタンを1つずつ押し、左右の表示名とbit表が一致することを確認した。

## IMU測定

| 動作 | min | max | average | update rate |
| --- | --- | --- | --- | --- |
| 静止 | 未測定 | 未測定 | 未測定 | 未測定 |
| 傾ける | 未測定 | 未測定 | 未測定 | 未測定 |
| 回す | 未測定 | 未測定 | 未測定 | 未測定 |
| 縦に振る | 未測定 | 未測定 | 未測定 | 未測定 |
| 横に振る | 未測定 | 未測定 | 未測定 | 未測定 |
| 弱く振る | 未測定 | 未測定 | 未測定 | 未測定 |

- 通常〜強い振りの正規化最大強度は左右とも`1.00`
- 軽い振りも左右とも正規化最大強度`1.00`、静止時は`0.02`
- 現在のSwing Detector開始しきい値`0.48`に対して静止との差が十分あり、静止中の誤反応もなかったためPhase 0では現設定を採用

## Bridge判断

次のどれかに当てはまる場合のみ、Swift Bridgeへ進む。

- Chromeから端末を選択できない
- 2本同時にinput reportを受信できない
- ボタンまたはIMUの必要データがWebHID / Gamepad APIで取得できない
- 入力遅延が150ms目標を安定して超える

実測後の結論：Web Bluetoothで左右2本とIMUを取得できたため、現時点ではSwift Bridge不要。

## Web Bluetooth実測

- service: `AB7DE9BE-89FE-49AD-828F-118F09DF7FD0`
- write: `649D4AC9-8EB7-4E6C-AF44-1EA54FE5F005`
- input notify: `AB7DE9BE-89FE-49AD-828F-118F09DF7FD2`
- 左右ともスティック、加速度、ジャイロ、電池電圧の変化を確認
- ボタンbit表は主要ボタンを左右とも実押下照合済み
