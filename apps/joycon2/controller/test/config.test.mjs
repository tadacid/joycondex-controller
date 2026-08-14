import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveEditableSettings,
  validateEditableBindings,
  validateEditableMouse
} from "../src/config.mjs";

const validBindings = {
  talk:["zr", "r"], voiceChat:["plus"], action:["a"], cancel:["b"], newChat:["y"], focus:[], escape:["x"],
  taskUp:["home"], taskDown:["chat"], reasonUp:["railRightSr"], reasonDown:["railRightSl"],
  contextPrimary:[], mouseClick:["stickRight"]
};

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
    mouse: { enabled:true, sensorSensitivity:0.4, stickSpeed:54 }
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
  assert.throws(() => validateEditableMouse({ ...mouse, sensorSensitivity:0.9 }), /0.1〜0.8/);
  assert.throws(() => validateEditableMouse({ ...mouse, stickSpeed:109 }), /14〜108/);

  const directory = await mkdtemp(join(tmpdir(), "codex-controller-mouse-config-"));
  const configPath = join(directory, "config.json");
  await writeFile(configPath, JSON.stringify({
    mouse:{ enabled:false, stickSpeed:22, sensorSensitivity:0.2, sensorSmoothing:0.35 },
    bindings:{ ...validBindings, master:"plus" }
  }));
  await saveEditableSettings(configPath, { bindings:validBindings, mouse });
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(saved.mouse, { ...mouse, sensorSmoothing:0.35 });
});
