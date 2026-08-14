import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { BridgeLauncher } from "../src/bridge-launcher.mjs";

test("Bridge起動済みなら二重起動しない", async () => {
  let spawnCalls = 0;
  const launcher = new BridgeLauncher({
    bridgeDir: "/tmp/fake-bridge",
    fetchFn: async () => ({ ok: true }),
    spawnFn: () => { spawnCalls += 1; }
  });
  const result = await launcher.ensureStarted();
  assert.equal(result.ok, true);
  assert.equal(result.alreadyRunning, true);
  assert.equal(spawnCalls, 0);
  assert.equal(launcher.snapshot().phase, "running");
});

test("画面からBridgeのビルド後にサーバーを起動する", async () => {
  let healthChecks = 0;
  let launch = null;
  const child = new EventEmitter();
  child.pid = 12_345;
  child.killed = false;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  const launcher = new BridgeLauncher({
    bridgeDir: "/tmp/fake-bridge",
    fetchFn: async () => ({ ok: ++healthChecks > 1 }),
    spawnFn: (command, args, options) => {
      launch = { command, args, options };
      return child;
    }
  });
  const result = await launcher.ensureStarted();
  assert.equal(result.ok, true);
  assert.equal(result.alreadyRunning, false);
  assert.equal(launch.command, "/bin/zsh");
  assert.deepEqual(launch.args, ["-c", "zsh build.sh && exec node server.mjs"]);
  assert.equal(launch.options.cwd, "/tmp/fake-bridge");
});
