import test from "node:test";
import assert from "node:assert/strict";
import { MacOSActions } from "../src/macos-actions.mjs";

function createDryActions() {
  const logs = [];
  const actions = new MacOSActions({
    appNames: ["ChatGPT"],
    dryRun: true,
    onLog: (level, message) => logs.push({ level, message })
  });
  return { actions, logs };
}

test("左サイドバーのチャット上下移動は専用ショートカットを直接送る", async () => {
  const { actions, logs } = createDryActions();

  await actions.previousRecentChat();
  await actions.nextRecentChat();

  assert.equal(logs[0].level, "dry");
  assert.match(logs[0].message, /key code 126 using \{control down, option down, shift down\}/);
  assert.equal(logs[1].level, "dry");
  assert.match(logs[1].message, /key code 125 using \{control down, option down, shift down\}/);
  assert.doesNotMatch(logs.map(({ message }) => message).join("\n"), /keystroke "k"/);
});

test("推論レベルの連続操作はモデル選択を開いたまま全入力を反映する", async () => {
  const { actions, logs } = createDryActions();

  await actions.increaseReasoningEffort();
  await actions.increaseReasoningEffort();
  await actions.decreaseReasoningEffort();
  await new Promise((resolve) => setTimeout(resolve, 560));
  await actions.drain();

  assert.match(logs[0].message, /keystroke "m" using \{control down, shift down\}/);
  assert.match(logs[1].message, /key code 124/);
  assert.match(logs[2].message, /key code 124/);
  assert.match(logs[3].message, /key code 123/);
  assert.match(logs.at(-1).message, /key code 53/);
  const allLogs = logs.map(({ message }) => message).join("\n");
  assert.equal((allLogs.match(/keystroke "m"/g) ?? []).length, 1);
  assert.doesNotMatch(allLogs, /clipboard|keystroke "k"|option down|key code 36/);
});

test("推論調整直後の通常操作はモデル選択を閉じてから実行する", async () => {
  const { actions, logs } = createDryActions();

  await actions.increaseReasoningEffort();
  await actions.enqueue("send", () => actions.sendComposer());

  const allLogs = logs.map(({ message }) => message).join("\n");
  assert.match(allLogs, /key code 53[\s\S]*key code 36/);
});

test("ボイスモードはControl+Option+Vを送る", async () => {
  const { actions, logs } = createDryActions();

  await actions.toggleVoiceChat();

  assert.equal(logs[0].level, "dry");
  assert.match(logs[0].message, /keystroke \"v\" using \{control down, option down\}/);
});

test("戻ると最新メッセージ移動は座標を使わずキー操作を送る", async () => {
  const { actions, logs } = createDryActions();

  await actions.escape();
  await actions.scrollLatest();

  assert.match(logs[0].message, /key code 53/);
  assert.match(logs[1].message, /key code 125 using \{command down\}/);
});
