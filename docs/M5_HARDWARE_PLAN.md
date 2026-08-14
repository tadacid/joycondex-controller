# M5Stack Codex Grip - Hardware Plan

Joy-Con 2版で操作UXを先行検証した後に作る専用ハード版です。

## 現在の想定V0ハード

- Chain DualKey with ESP32-S3 ×1
- Chain Mechanical Key ×3
- Chain Joystick ×1
- Chain Encoder ×1
- Chain RGB Matrix 8×8 ×1
- M5Stack Passive Buzzer Unit ×1
- Unit Mini IMU ×1
- Unit ChainBus ×1
- Chain Return Connector
- V0はUSB-C常時給電

将来:

- TimerPWR
- 3.7V / 約1500mAh LiPo
- BLE運用
- 3Dプリントグリップ
- TALKの側面・人差し指トリガー化

## 想定操作

Joy-Con 2版で検証した意味イベントを移植する。

- TALK
- ACTION
- CANCEL
- NEW
- FOCUS
- JoystickでAgent/Thread選択
- Encoderでスクロール・選択
- RGB MatrixでAgent状態
- Buzzerで完了・待機・エラー通知
- IMUで持ち上げWake、置いたら減光、裏返しMute等を検討

## 形状

基本は24mm前後のChainモジュールを2列で並べる4段系レイアウト。
DualKeyは約2列幅。

最終形は単純な平板ではなく、下部・背面に握りやすいグリップを追加し、TALKを人差し指トリガーへ移す案を優先して検証する。

## 注意

M5版はJoy-Con版のUXが固まる前に作り込みすぎない。
Joy-Con 2は、M5版のボタン配置・トリガー・Stick操作の実使用テスト機として扱う。
