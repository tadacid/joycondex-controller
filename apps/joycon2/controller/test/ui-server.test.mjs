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
