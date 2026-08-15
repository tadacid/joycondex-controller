# Architecture

## 現在

```text
Joy-Con 2
   │ Bluetooth input / haptics
   ▼
apps/joycon2/bridge/native/main.swift
   │ JSON Lines
   ▼
apps/joycon2/bridge/server.mjs
   │ SSE 127.0.0.1:8787
   ▼
apps/joycon2/controller
   │ Safety + semantic-ish actions + feedback
   ▼
macOS / Codex app

Codex Stop / PermissionRequest Hook
   │ localhost event
   └──────────────► Controller ─► Bridge ─► Joy-Con 2 vibration
```

## 目標

ハード固有層とCodex操作層を分離する。

```text
┌────────────────┐          ┌────────────────┐
│ Joy-Con adapter│          │ M5Stack adapter│
└───────┬────────┘          └───────┬────────┘
        │                            │
        └──────── Semantic Actions ──┘
                     │
              packages/core
                     │
              packages/mac-bridge
                     │
        ┌────────────┴─────────────┐
        │                          │
     Codex App               future HUD / APIs
```

## なぜ今すぐ共通化しないか

Joy-Con 2版はまだ実機UX検証前です。使わない操作や変更される状態機械を先に抽象化すると、後で共通層が足枷になります。

したがって:

1. Joy-Con V0を使う
2. 本当に必要な操作を確定
3. 安定した意味イベントだけ抽出
4. M5Stack版で再利用

という順番にします。

## 安全境界

物理入力から直接危険操作へ飛ばさず、Controller/Coreの状態機械を必ず通します。

```text
Physical Input
    ↓
Edge / Latch
    ↓
Neutral + Master Gate
    ↓
Context / Frontmost Gate
    ↓
Semantic Action
    ↓
Mac / Codex operation
```
