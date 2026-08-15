/* global console, process */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUTTON_OPTIONS,
  EDITABLE_BINDING_KEYS,
  FUNCTION_OPTIONS,
  loadConfig,
  normalizeSettingsBackup,
  saveEditableSettings,
  validateEditableBindings,
  validateEditableFeedback,
  validateEditableMouse
} from "./config.mjs";
import { CursorDriver } from "./cursor-driver.mjs";
import { MacOSActions } from "./macos-actions.mjs";
import { ControllerStateMachine } from "./state-machine.mjs";
import { SSEClient } from "./sse-client.mjs";
import { UIServer } from "./ui-server.mjs";
import { VoiceKeyClient } from "./voicekey-client.mjs";
import { BridgeLauncher } from "./bridge-launcher.mjs";
import { BatteryMonitor } from "./battery-monitor.mjs";
import { FeedbackClient } from "./feedback-client.mjs";

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const here = dirname(fileURLToPath(import.meta.url));
const { config, configPath, projectDir } = await loadConfig();
const logs = [];
let frontmostApp = null;
let actionBusy = false;
let latestState = null;
let stopping = false;
let stateBroadcastTimer = null;

function scheduleStateBroadcast() {
  if (stateBroadcastTimer !== null) return;
  stateBroadcastTimer = setTimeout(() => {
    stateBroadcastTimer = null;
    ui?.broadcast();
  }, 50);
}

const bridgeLauncher = new BridgeLauncher({
  bridgeDir: resolve(projectDir, "../bridge"),
  healthUrl: new URL("/health", config.bridgeUrl).href,
  onLog: (level, message) => log(level, message)
});

function log(level, message, detail = null) {
  const entry = { at: Date.now(), level, message, detail };
  logs.push(entry);
  if (logs.length > 80) logs.splice(0, logs.length - 80);
  const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[controller:${level}] ${message}${suffix}`);
  ui?.broadcast();
}

const actions = new MacOSActions({
  appNames: config.targetAppNames,
  focusDelayMs: config.focusDelayMs,
  actionCooldownMs: config.actionCooldownMs,
  dryRun: config.dryRun,
  onLog: (level, message) => log(level, message)
});

const voiceKey = new VoiceKeyClient({
  baseUrl: config.voiceKeyUrl,
  timeoutMs: config.voiceKeyCommandTimeoutMs,
  dryRun: config.dryRun,
  onLog: (level, message) => log(level, message)
});

const feedback = new FeedbackClient({
  endpoint: new URL("/feedback/rumble", config.bridgeUrl).href,
  enabled: config.feedback.enabled,
  strength: config.feedback.strength,
  timeoutMs: config.feedbackCommandTimeoutMs,
  onLog: (level, message) => log(level, message),
  onState: scheduleStateBroadcast
});

const cursor = new CursorDriver({
  sourcePath: resolve(projectDir, "native/cursor-helper.swift"),
  binaryPath: resolve(projectDir, "native/build/cursor-helper"),
  dryRun: config.dryRun,
  onLog: (level, message) => log(level, message)
});

const batteryMonitor = new BatteryMonitor({
  onWarning: async ({ voltage }) => {
    log("warn", `Joy-Conのバッテリー残量が少なくなっています (${voltage.toFixed(2)} V)`);
    try {
      await actions.notifyLowBattery(voltage);
    } catch (error) {
      log("warn", `バッテリー通知を表示できませんでした: ${error.message}`);
    }
  }
});

async function targetGuarded(operation) {
  await actions.requireTargetFrontmost();
  return operation();
}

function dispatchAction(action) {
  const run = async () => {
    actionBusy = true;
    ui?.broadcast();
    try {
      const current = machine.snapshot();
      if (!current.armed && action.name !== "talkStop") {
        log("blocked", `${action.name}はDISABLED中のため無視`);
        return;
      }
      if (action.detail?.delayMs) await sleep(action.detail.delayMs);
      switch (action.name) {
        case "talkStart":
          await actions.activateTarget();
          await voiceKey.start();
          log("action", "TALK開始");
          break;
        case "talkStop":
          await voiceKey.stop();
          await sleep(config.dictationSettleMs);
          log("action", "TALK終了", action.detail);
          break;
        case "send":
          await actions.activateAndSendComposer();
          log("action", "ACTION送信");
          break;
        case "deleteBackward":
          await targetGuarded(() => actions.deleteBackward());
          log("action", "DELETEを1回");
          break;
        case "clear":
          await targetGuarded(() => actions.clearComposer());
          log("action", "DELETE長押しで入力欄を全文削除");
          break;
        case "newChat":
          await actions.openNewChat();
          log("action", "新規Codexチャット");
          break;
        case "focus":
          await actions.activateTarget();
          log("action", "Codexを前面へ");
          break;
        case "escape":
          await targetGuarded(() => actions.escape());
          log("action", "Escape / 戻る");
          break;
        case "scrollLatest":
          await targetGuarded(() => actions.scrollLatest());
          log("action", "最新メッセージまで移動");
          break;
        case "focusComposer":
          await targetGuarded(() => cursor.focusComposer());
          log("action", "メイン／サイド入力欄を切替");
          break;
        case "voiceChat":
          await actions.toggleVoiceChat();
          log("action", "ボイスモード切替");
          break;
        case "previousChat":
          await targetGuarded(() => actions.previousChat());
          log("action", "前のチャット");
          break;
        case "nextChat":
          await targetGuarded(() => actions.nextChat());
          log("action", "次のチャット");
          break;
        case "taskUp":
          await targetGuarded(() => actions.previousRecentChat());
          log("action", "タスク選択 上");
          break;
        case "taskDown":
          await targetGuarded(() => actions.nextRecentChat());
          log("action", "タスク選択 下");
          break;
        case "reasonUp":
          await targetGuarded(() => actions.increaseReasoningEffort());
          log("action", "推論レベルを上げる");
          break;
        case "reasonDown":
          await targetGuarded(() => actions.decreaseReasoningEffort());
          log("action", "推論レベルを下げる");
          break;
        case "blocked":
          log("blocked", action.detail?.reason ?? "安全条件により操作を無視");
          break;
        default:
          log("warn", `未実装アクション: ${action.name}`);
      }
    } catch (error) {
      machine.handleActionFailure(action.name, error.message);
      log("error", `${action.name}失敗: ${error.message}`);
    } finally {
      actionBusy = false;
      ui?.broadcast();
    }
  };
  actions.enqueue(action.name, run).catch((error) => log("error", error.message));
}

const machine = new ControllerStateMachine({
  config,
  onAction: dispatchAction,
  onPointerMove: ({ dx, dy }) => cursor.move(dx, dy),
  onPointerButton: ({ down }) => cursor.button(down),
  onState: (state) => {
    latestState = state;
    batteryMonitor.update({ connected: state.joyconConnected, voltage: state.batteryVoltage });
    scheduleStateBroadcast();
  }
});
latestState = machine.snapshot();

function currentEditableBindings() {
  return Object.fromEntries(
    EDITABLE_BINDING_KEYS.map((key) => [key, [...config.bindings[key]]])
  );
}

function settingsPayload() {
  const current = machine.snapshot();
  return {
    ok: true,
    bindings: currentEditableBindings(),
    mouse: {
      enabled: Boolean(config.mouse.enabled),
      sensorSensitivity: config.mouse.sensorSensitivity,
      stickSpeed: config.mouse.stickSpeed
    },
    feedback: { ...config.feedback },
    master: "plus",
    buttonOptions: BUTTON_OPTIONS,
    functionOptions: FUNCTION_OPTIONS,
    canSave: !current.armed && !current.talkActive && !current.settingsUpdating && !actionBusy
  };
}

function settingsBackupPayload() {
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    bindings: currentEditableBindings(),
    mouse: {
      enabled: Boolean(config.mouse.enabled),
      sensorSensitivity: config.mouse.sensorSensitivity,
      stickSpeed: config.mouse.stickSpeed
    },
    feedback: { ...config.feedback }
  };
}

async function saveSettings(requestedBindings, requestedMouse, requestedFeedback) {
  let bindings;
  let mouse;
  let nextFeedback;
  try {
    bindings = validateEditableBindings(requestedBindings);
    mouse = validateEditableMouse(requestedMouse);
    nextFeedback = validateEditableFeedback(requestedFeedback);
  } catch (error) {
    return { ok: false, status: 400, message: error.message };
  }
  if (actionBusy) {
    return { ok: false, status: 409, message: "操作の完了後に保存してください" };
  }

  const begin = machine.beginBindingsUpdate();
  if (!begin.ok) return { ...begin, status: 409 };

  try {
    await saveEditableSettings(configPath, { bindings, mouse, feedback: nextFeedback });
    const applied = machine.applySettings({ bindings, mouse, feedback: nextFeedback });
    if (!applied.ok) throw new Error(applied.message);
    feedback.configure(nextFeedback);
    log("info", "操作設定を保存しました", { bindings, mouse, feedback: nextFeedback });
    return {
      ok: true,
      status: 200,
      bindings,
      mouse,
      feedback: nextFeedback,
      master: "plus",
      neutralRequired: true
    };
  } catch (error) {
    machine.cancelBindingsUpdate(error.message);
    log("error", `操作設定の保存失敗: ${error.message}`);
    return { ok: false, status: 500, message: error.message };
  }
}

async function restoreSettings(backup) {
  try {
    const restored = normalizeSettingsBackup(backup, config.feedback);
    return saveSettings(restored.bindings, restored.mouse, restored.feedback);
  } catch (error) {
    return { ok: false, status: 400, message: error.message };
  }
}

function payload() {
  return {
    state: latestState,
    controller: {
      actionBusy,
      dryRun: config.dryRun,
      frontmostApp,
      configPath,
      bridgeUrl: config.bridgeUrl,
      bridgeLaunch: bridgeLauncher.snapshot(),
      bindings: config.bindings,
      voiceKeyOwned: voiceKey.ownsRecording,
      cursor: cursor.snapshot(),
      battery: batteryMonitor.snapshot(),
      feedback: feedback.snapshot()
    },
    logs
  };
}

const ui = new UIServer({
  host: config.uiHost,
  port: config.uiPort,
  publicDir: resolve(projectDir, "public"),
  getPayload: payload,
  arm: () => machine.armFromUi(),
  disarm: () => machine.disarmFromUi(),
  connectJoycon: async () => {
    const result = await bridgeLauncher.ensureStarted();
    log("info", result.message);
    ui.broadcast();
    return result;
  },
  getSettings: settingsPayload,
  saveSettings,
  getSettingsBackup: settingsBackupPayload,
  restoreSettings,
  receiveCodexEvent: (event) => feedback.notify(event.type, { eventId: event.eventId }),
  testFeedback: () => feedback.test(),
  onLog: log
});

const bridge = new SSEClient(config.bridgeUrl, {
  onStatus: ({ connected, phase }) => {
    feedback.setBridgeConnection(connected);
    machine.setBridgeConnection(connected);
    log(connected ? "info" : "warn", `Bridge: ${phase}`);
  },
  onMessage: (data) => {
    try {
      const event = JSON.parse(data);
      feedback.handleBridgeEvent(event);
      machine.handleBridgeEvent(event);
    } catch (error) {
      log("warn", `Bridgeイベント解析失敗: ${error.message}`);
    }
  },
  onError: (error) => log("warn", `Bridge SSE: ${error.message}`)
});

await ui.start();
console.log(`[controller] UI: http://${config.uiHost}:${config.uiPort}`);
console.log(`[controller] Config: ${configPath}`);
console.log(`[controller] Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);
bridge.start();
cursor.start().catch((error) => log("error", error.message));

const tickTimer = setInterval(() => machine.tick(), 200);
const appTimer = setInterval(async () => {
  try {
    frontmostApp = await actions.frontmostApp();
    ui.broadcast();
  } catch {
    frontmostApp = null;
  }
}, 1800);

async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(tickTimer);
  clearInterval(appTimer);
  if (stateBroadcastTimer !== null) clearTimeout(stateBroadcastTimer);
  stateBroadcastTimer = null;
  machine.disarmFromUi();
  await feedback.stop();
  await actions.enqueue("voiceKeyShutdownStop", () => voiceKey.stop()).catch((error) => {
    log("error", `終了時のVoiceKey停止失敗: ${error.message}`);
  });
  await actions.drain();
  await bridge.stop();
  await bridgeLauncher.stop();
  await cursor.stop();
  await ui.stop();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
