# JoyCondex

[日本語](README.md) | [English](README.en.md)

JoyCondex lets you control Codex with one hand using a Joy-Con 2 on macOS.

It combines Codex controls, safety locks, voice input, task navigation, mouse control, and haptic notifications.

- **Joy-Con 2 version:** Implemented and tested on real hardware.

**Joy-Con + Codex = JoyCondex.**

## Start with Codex

Open the entire `joycondex-controller` folder in Codex.

Read these files first:

1. `AGENTS.md`
2. `docs/CURRENT_STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/JOYCON_NEXT_STEPS.md`

Run the tests:

```bash
npm test
```

Then start the macOS dry run:

```bash
./START_JOYCON_DRY_RUN.command
```

If everything looks correct, start live control:

```bash
./START_JOYCON_LIVE.command
```

For daily use, open `JoyCondex.app` in the Applications folder. It starts the live controller when needed and otherwise opens the dashboard.

## Current Joy-Con 2 controls

| Joy-Con 2 | JoyCondex |
|---|---|
| Hold/release R | Start/stop voice input |
| ZR | Left click on a desk; switch between main and side input while lifted |
| A | Send / action |
| Tap/hold B | Delete one character / clear the input field |
| Tap/hold X | Escape or back / jump to the latest message |
| Y | New chat |
| HOME / C | Previous / next task |
| SR / SL | Increase / decrease reasoning level |
| Stick | Move the cursor while lifted |
| Tap/hold + | Voice mode / master enable or disable |

See `apps/joycon2/controller/README.md` for more details.

## Voice input

The current implementation sends start and stop commands to VoiceKey, a custom app made by the author. VoiceKey is not included in this repository.

To use another dictation app, open this repository in Codex and ask:

> Replace the VoiceKey integration with the start and stop method used by my dictation app. Keep recording active only while I hold R.

Include the name of your dictation app and its keyboard shortcuts or local commands so Codex can adapt the integration correctly.

## Dashboard

Open `http://127.0.0.1:8788/` while JoyCondex is running. When the controller is disabled, you can change button mappings, mouse controls, cursor speeds, and haptic settings. Settings can be backed up and restored as JSON and remain available after restarting.

A completed Codex task sends one long vibration. An approval that needs your action sends three long vibrations. Requests handled by automatic review do not vibrate. Haptic notifications remain available while the controller is disabled.

The dashboard also estimates the Joy-Con battery level from its voltage and shows a macOS charging warning at 3.55 V or below.

## Architecture

JoyCondex converts physical Joy-Con 2 input into guarded Codex actions.

```text
Joy-Con 2 -> Semantic Actions -> Mac/Codex control
```
