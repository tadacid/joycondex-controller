import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UIServer } from "../src/ui-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("ブラウザのSSE接続中でもUIサーバーを終了できる", async () => {
  const ui = new UIServer({
    host: "127.0.0.1",
    port: 0,
    publicDir: resolve(here, "../public"),
    getPayload: () => ({ state: {}, controller: {}, logs: [] }),
    arm: () => ({ ok: true }),
    disarm: () => ({ ok: true })
  });
  await ui.start();
  const port = ui.server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/events`);
  assert.equal(response.ok, true);
  await Promise.race([
    ui.stop(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("UIサーバー終了timeout")), 1000))
  ]);
});

test("画面の接続ボタンからJoy-Con接続役を起動できる", async () => {
  let calls = 0;
  const ui = new UIServer({
    host: "127.0.0.1",
    port: 0,
    publicDir: resolve(here, "../public"),
    getPayload: () => ({ state: {}, controller: {}, logs: [] }),
    arm: () => ({ ok: true }),
    disarm: () => ({ ok: true }),
    connectJoycon: async () => {
      calls += 1;
      return { ok: true, message: "接続待ちを開始しました" };
    }
  });
  await ui.start();
  const port = ui.server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/connect-joycon`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(calls, 1);
  } finally {
    await ui.stop();
  }
});

test("設定をJSONでバックアップし、復元APIへ渡せる", async () => {
  const backup = {
    schemaVersion: 1,
    exportedAt: "2026-08-14T00:00:00.000Z",
    bindings: { talk:["r"] },
    mouse: { enabled:true, sensorSensitivity:0.4, stickSpeed:54 }
  };
  let restored = null;
  const ui = new UIServer({
    host: "127.0.0.1",
    port: 0,
    publicDir: resolve(here, "../public"),
    getPayload: () => ({ state: {}, controller: {}, logs: [] }),
    arm: () => ({ ok: true }),
    disarm: () => ({ ok: true }),
    getSettingsBackup: () => backup,
    restoreSettings: async (value) => {
      restored = value;
      return { ok:true, status:200 };
    }
  });
  await ui.start();
  const port = ui.server.address().port;
  try {
    const download = await fetch(`http://127.0.0.1:${port}/api/settings/backup`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /attachment/);
    assert.deepEqual(await download.json(), backup);

    const restore = await fetch(`http://127.0.0.1:${port}/api/settings/restore`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup)
    });
    assert.equal(restore.status, 200);
    assert.deepEqual(restored, backup);
  } finally {
    await ui.stop();
  }
});
