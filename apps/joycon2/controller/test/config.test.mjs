import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveEditableSettings,
  validateEditableBindings,
  validateEditableFeedback,
  normalizeSettingsBackup,
  validateEditableMouse
} from "../src/config.mjs";

const validBindings = {
  talk:["zr", "r"], voiceChat:["plus"], action:["a"], cancel:["b"], newChat:["y"], focus:[], escape:["x"],
  taskUp:["home"], taskDown:["chat"], reasonUp:["railRightSr"], reasonDown:["railRightSl"],
  contextPrimary:[], mouseClick:["stickRight"]
};
const validMouse = { enabled:true, sensorSensitivity:0.4, stickSpeed:54 };
const validFeedback = { enabled:true, strength:3 };

test("同じ機能へ複数ボタンを割り当てられる", () => {
  assert.deepEqual(validateEditableBindings(validBindings), validBindings);
  assert.deepEqual(
    validateEditableBindings({ ...validBindings, talk:[] }).talk,
    []
  );
  assert.deepEqual(
    validateEditableBindings({ ...validBindings, talk:["r"], contextPrimary:["zr"] }).contextPrimary,
    ["zr"]
  );
  assert.throws(
    () => validateEditableBindings({ ...validBindings, action:["zr"] }),
    /複数の機能/
  );
  assert.throws(
    () => validateEditableBindings({ ...validBindings, talk:["plus"], voiceChat:[] }),
    /plusはボイスモード専用/
  );
  assert.throws(
    () => validateEditableBindings({ ...validBindings, master:"plus" }),
    /変更できない操作/
  );
});

test("保存時は他の設定を維持してbindingsだけ原子的に更新する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-controller-config-"));
  const configPath = join(directory, "config.json");
  await writeFile(configPath, JSON.stringify({ bridgeUrl:"http://example.test/events", bindings:{ ...validBindings, master:"plus" } }));
  const changed = { ...validBindings, talk:["zr"] };
  await saveEditableSettings(configPath, {
    bindings: changed,
    mouse: validMouse,
    feedback: validFeedback
  });
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(saved.bridgeUrl, "http://example.test/events");
  assert.deepEqual(saved.bindings, { ...changed, master:"plus" });
});

test("マウスON/OFFと2種類の速度を検証して保存する", async () => {
  const mouse = { enabled:true, sensorSensitivity:0.3, stickSpeed:27 };
  assert.deepEqual(validateEditableMouse(mouse), mouse);
  assert.throws(() => validateEditableMouse({ enabled:true }), /sensorSensitivity/);
  assert.throws(() => validateEditableMouse({ ...mouse, enabled:"true" }), /真偽値/);
  assert.deepEqual(
    validateEditableMouse({ ...mouse, sensorSensitivity:1.6, stickSpeed:216 }),
    { ...mouse, sensorSensitivity:1.6, stickSpeed:216 },
  );
  assert.throws(() => validateEditableMouse({ ...mouse, sensorSensitivity:1.65 }), /0.1〜1.6/);
  assert.throws(() => validateEditableMouse({ ...mouse, stickSpeed:217 }), /14〜216/);

  const directory = await mkdtemp(join(tmpdir(), "codex-controller-mouse-config-"));
  const configPath = join(directory, "config.json");
  await writeFile(configPath, JSON.stringify({
    mouse:{ enabled:false, stickSpeed:22, sensorSensitivity:0.2, sensorSmoothing:0.35 },
    bindings:{ ...validBindings, master:"plus" }
  }));
  await saveEditableSettings(configPath, { bindings:validBindings, mouse, feedback:validFeedback });
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(saved.mouse, { ...mouse, sensorSmoothing:0.35 });
});

test("振動通知のON/OFFと強さを検証して保存する", async () => {
  assert.deepEqual(validateEditableFeedback(validFeedback), validFeedback);
  assert.throws(() => validateEditableFeedback({ enabled:true, strength:0 }), /1〜5/);
  assert.throws(() => validateEditableFeedback({ enabled:"true", strength:3 }), /真偽値/);

  const directory = await mkdtemp(join(tmpdir(), "codex-controller-feedback-config-"));
  const configPath = join(directory, "config.json");
  await writeFile(configPath, JSON.stringify({ bindings:{ ...validBindings, master:"plus" } }));
  await saveEditableSettings(configPath, { bindings:validBindings, mouse:validMouse, feedback:{ enabled:false, strength:5 } });
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(saved.feedback, { enabled:false, strength:5 });
});

test("V1バックアップは現在の振動設定を補い、V2は振動設定を復元する", () => {
  const v1 = normalizeSettingsBackup({ schemaVersion:1, bindings:validBindings, mouse:validMouse }, validFeedback);
  assert.deepEqual(v1.feedback, validFeedback);
  const v2 = normalizeSettingsBackup({
    schemaVersion:2,
    bindings:validBindings,
    mouse:validMouse,
    feedback:{ enabled:false, strength:2 }
  }, validFeedback);
  assert.deepEqual(v2.feedback, { enabled:false, strength:2 });
  assert.throws(
    () => normalizeSettingsBackup({ schemaVersion:1, bindings:validBindings, mouse:validMouse, feedback:validFeedback }, validFeedback),
    /バックアップではありません/
  );
});
