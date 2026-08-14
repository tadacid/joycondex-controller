import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, "..");

export const EDITABLE_BINDING_KEYS = Object.freeze([
  "talk", "voiceChat", "action", "cancel", "newChat", "focus", "escape", "taskUp", "taskDown",
  "reasonUp", "reasonDown", "contextPrimary", "mouseClick"
]);

export const BUTTON_OPTIONS = Object.freeze([
  { value: "zr", label: "ZR" },
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "x", label: "X" },
  { value: "y", label: "Y" },
  { value: "r", label: "R" },
  { value: "chat", label: "C" },
  { value: "home", label: "HOME" },
  { value: "plus", label: "+" },
  { value: "stickRight", label: "Stick押込" },
  { value: "railRightSl", label: "SL" },
  { value: "railRightSr", label: "SR" }
]);

export const FUNCTION_OPTIONS = Object.freeze([
  { value: "", label: "未割当" },
  { value: "talk", label: "音声入力" },
  { value: "voiceChat", label: "ボイスモード" },
  { value: "action", label: "送信 / 承認" },
  { value: "cancel", label: "DELETE" },
  { value: "newChat", label: "新規" },
  { value: "focus", label: "前面化" },
  { value: "escape", label: "Escape / 戻る" },
  { value: "taskUp", label: "タスク選択 上" },
  { value: "taskDown", label: "タスク選択 下" },
  { value: "reasonUp", label: "推論レベル 上" },
  { value: "reasonDown", label: "推論レベル 下" },
  { value: "contextPrimary", label: "入力欄切替 / 机上クリック" },
  { value: "mouseClick", label: "マウスクリック" }
]);

const ALLOWED_BINDING_BUTTONS = new Set(BUTTON_OPTIONS.map(({ value }) => value));

const defaults = Object.freeze({
  bridgeUrl: "http://127.0.0.1:8787/events",
  uiHost: "127.0.0.1",
  uiPort: 8788,
  deviceSide: "right",
  targetAppNames: ["Codex", "ChatGPT"],
  masterHoldMs: 800,
  watchdogMs: 2200,
  stickTrigger: 0.68,
  stickRelease: 0.34,
  actionCooldownMs: 140,
  focusDelayMs: 220,
  minimumTalkMs: 250,
  deleteHoldMs: 700,
  escapeHoldMs: 700,
  reasonRepeatDelayMs: 420,
  reasonRepeatIntervalMs: 180,
  dictationSettleMs: 1000,
  voiceKeyUrl: "http://127.0.0.1:47321",
  voiceKeyCommandTimeoutMs: 1000,
  draftExpiryMs: 30_000,
  actionRequiresDraft: false,
  mouse: {
    enabled: true,
    surfaceDistanceMax: 500,
    surfaceReleaseDistance: 650,
    sensorSensitivity: 0.4,
    sensorSmoothing: 0.35,
    sensorDeadzone: 2,
    sensorJumpThreshold: 1200,
    stickDeadzone: 0.2,
    stickSpeed: 54
  },
  bindings: {
    talk: ["r"],
    voiceChat: ["plus"],
    action: ["a"],
    cancel: ["b"],
    newChat: ["y"],
    focus: [],
    escape: ["x"],
    taskUp: ["home"],
    taskDown: ["chat"],
    reasonUp: ["railRightSr"],
    reasonDown: ["railRightSl"],
    contextPrimary: ["zr"],
    mouseClick: ["stickRight"],
    master: "plus"
  }
});

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    bindings: { ...base.bindings, ...(override.bindings ?? {}) },
    mouse: { ...base.mouse, ...(override.mouse ?? {}) }
  };
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function validateEditableBindings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("bindingsはオブジェクトで指定してください");
  }

  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !EDITABLE_BINDING_KEYS.includes(key));
  const missing = EDITABLE_BINDING_KEYS.filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw new Error(`変更できない操作があります: ${unknown.join(", ")}`);
  if (missing.length > 0) throw new Error(`操作の指定が不足しています: ${missing.join(", ")}`);

  const normalized = {};
  const assignedButtons = new Set();
  for (const key of EDITABLE_BINDING_KEYS) {
    const requested = typeof value[key] === "string" ? [value[key]] : value[key];
    if (!Array.isArray(requested)) {
      throw new Error(`${key}のボタンが不正です`);
    }
    const buttons = [];
    for (const button of requested) {
      if (typeof button !== "string" || !ALLOWED_BINDING_BUTTONS.has(button)) {
        throw new Error(`${key}のボタンが不正です`);
      }
      if (button === "plus" && key !== "voiceChat") {
        throw new Error("plusはボイスモード専用です");
      }
      if (buttons.includes(button)) throw new Error(`${key}に同じボタンが重複しています`);
      if (assignedButtons.has(button)) throw new Error(`${button}に複数の機能を割り当てることはできません`);
      buttons.push(button);
      assignedButtons.add(button);
    }
    normalized[key] = buttons;
  }
  return normalized;
}

export function validateEditableMouse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("mouseはオブジェクトで指定してください");
  }
  const keys = Object.keys(value);
  const allowed = ["enabled", "sensorSensitivity", "stickSpeed"];
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) {
    throw new Error("mouseにはenabled、sensorSensitivity、stickSpeedを指定してください");
  }
  if (typeof value.enabled !== "boolean") throw new Error("mouse.enabledは真偽値で指定してください");
  if (!Number.isFinite(value.sensorSensitivity) || value.sensorSensitivity < 0.1 || value.sensorSensitivity > 0.8) {
    throw new Error("机上マウス速度は0.1〜0.8で指定してください");
  }
  if (!Number.isFinite(value.stickSpeed) || value.stickSpeed < 14 || value.stickSpeed > 108) {
    throw new Error("Stick速度は14〜108で指定してください");
  }
  return {
    enabled: value.enabled,
    sensorSensitivity: Math.round(value.sensorSensitivity * 100) / 100,
    stickSpeed: Math.round(value.stickSpeed)
  };
}

export async function saveEditableSettings(configPath, { bindings, mouse }) {
  const validatedBindings = validateEditableBindings(bindings);
  const validatedMouse = validateEditableMouse(mouse);
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!fileConfig || typeof fileConfig !== "object" || Array.isArray(fileConfig)) {
    throw new Error("設定ファイルの形式が不正です");
  }

  const nextConfig = {
    ...fileConfig,
    bindings: { ...validatedBindings, master: "plus" },
    mouse: { ...(fileConfig.mouse ?? {}), ...validatedMouse }
  };
  const temporaryPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, configPath);
  return { bindings: validatedBindings, mouse: validatedMouse };
}

export async function loadConfig() {
  const configPath = resolve(
    process.env.CODEX_CONTROLLER_CONFIG ?? resolve(projectDir, "config.json")
  );
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const config = mergeConfig(defaults, fileConfig);
  if (process.env.JOYCON_BRIDGE_URL) config.bridgeUrl = process.env.JOYCON_BRIDGE_URL;
  if (process.env.CODEX_CONTROLLER_PORT) {
    config.uiPort = finiteNumber(process.env.CODEX_CONTROLLER_PORT, config.uiPort);
  }
  config.dryRun = /^(1|true|yes)$/i.test(process.env.CODEX_CONTROLLER_DRY_RUN ?? "false");

  if (!Array.isArray(config.targetAppNames) || config.targetAppNames.length === 0) {
    throw new Error("targetAppNamesには1件以上のアプリ名が必要です");
  }
  if (config.stickRelease >= config.stickTrigger) {
    throw new Error("stickReleaseはstickTriggerより小さくしてください");
  }
  if (typeof config.mouse.enabled !== "boolean") throw new Error("mouse.enabledは真偽値で指定してください");
  if (config.mouse.surfaceReleaseDistance <= config.mouse.surfaceDistanceMax) {
    throw new Error("mouse.surfaceReleaseDistanceはsurfaceDistanceMaxより大きくしてください");
  }
  for (const key of ["surfaceDistanceMax", "surfaceReleaseDistance", "sensorSensitivity", "sensorSmoothing", "sensorDeadzone", "sensorJumpThreshold", "stickDeadzone", "stickSpeed"]) {
    if (!Number.isFinite(config.mouse[key])) throw new Error(`mouse.${key}は数値で指定してください`);
  }
  if (config.mouse.sensorSmoothing < 0 || config.mouse.sensorSmoothing > 1) {
    throw new Error("mouse.sensorSmoothingは0〜1で指定してください");
  }
  if (config.mouse.stickDeadzone < 0 || config.mouse.stickDeadzone >= 1) {
    throw new Error("mouse.stickDeadzoneは0以上1未満で指定してください");
  }
  const bindings = validateEditableBindings(Object.fromEntries(
    EDITABLE_BINDING_KEYS.map((key) => [key, config.bindings[key]])
  ));
  if (config.bindings.master !== "plus") {
    throw new Error("MASTERは安全のためplus固定です");
  }
  config.bindings = { ...bindings, master: "plus" };
  return { config, configPath, projectDir };
}
