# Decisions

## D001: 1 repo / deviceごとに別app

Joy-Con 2版とM5Stack版は別プロジェクトにせず、同一 `joycondex-controller` repo内の別appとして管理する。

理由:

- TALK/ACTION/CANCEL等のUX知見を共有できる
- Mac側Codex操作を再利用できる
- Joy-Con 2をM5Stack版のPoCとして扱える
- Codexに同じrepoを読ませればコンテキスト分断が減る

## D002: Joy-Con Bridgeは原則維持

既存Bridgeは入力取得・正規化・ローカルSSE配信まで完成している。
Codex専用操作は別controllerで実装する。

## D003: V0は安全なMac操作を優先

UI座標クリックではなく、ショートカット・deep link・明示APIを優先する。
App Serverによる深い統合はV1候補。

## D004: M5の電池は後付け

M5 V0はUSB給電でUX・消費電力を確認する。
便利さが確認できてからTimerPWR + 約1500mAh LiPoを追加する。

## D005: 入力デバイスではなく意味イベントを共有する

Joy-Conの `ZR` や `A` と、M5の物理トリガー・キーを直接Codex操作へ結びつけず、TALK/ACTION等の意味イベントへ変換する方向を目指す。
