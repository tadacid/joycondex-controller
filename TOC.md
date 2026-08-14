# Project Map / TOC

```text
codex-grip/
├─ README.md
├─ AGENTS.md
├─ TOC.md
├─ package.json
├─ START_JOYCON_DRY_RUN.command
├─ START_JOYCON_LIVE.command
│
├─ apps/
│  ├─ joycon2/
│  │  ├─ bridge/       # CoreBluetooth -> JSONL -> SSE。既存・原則変更しない
│  │  └─ controller/   # Joy-Con入力を安全なCodex操作へ変換。V0実装済み
│  │
│  └─ m5-grip/
│     └─ firmware/     # 将来のM5Stack専用ファーム置き場
│
├─ packages/
│  ├─ core/            # 将来: TALK/ACTION/CANCEL等の共通状態機械
│  └─ mac-bridge/      # 将来: Codex操作、音声HUD、App Server連携
│
└─ docs/
   ├─ CURRENT_STATE.md
   ├─ ARCHITECTURE.md
   ├─ JOYCON_NEXT_STEPS.md
   ├─ M5_HARDWARE_PLAN.md
   ├─ DECISIONS.md
   ├─ ORIGINAL_JOYCON_BRIDGE_HANDOFF.md
   └─ references/kirari/
```

## 今触る場所

現時点でCodexが最初に触るべき場所は主に:

- `apps/joycon2/controller/`
- 必要な場合だけ `apps/joycon2/bridge/`

`packages/core` と `packages/mac-bridge` は、Joy-Con V0の実機確認後に共通化するための予約領域です。**今すぐ抽象化のためだけにコードを移動しないこと。**
