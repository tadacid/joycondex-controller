import test from "node:test";
import assert from "node:assert/strict";
import { CursorDriver } from "../src/cursor-driver.mjs";

test("入力欄切替は常駐ヘルパーへ専用命令を1回送る", () => {
  const writes = [];
  const driver = new CursorDriver({
    sourcePath: "/tmp/cursor-helper.swift",
    binaryPath: "/tmp/cursor-helper",
    dryRun: false
  });
  driver.child = {
    stdin: {
      writable: true,
      write: (value) => writes.push(value)
    }
  };

  driver.focusComposer();

  assert.deepEqual(writes, ["focus-composer\n"]);
});

test("Stick移動だけ画面起動付きで常駐ヘルパーへ送る", async () => {
  const writes = [];
  const driver = new CursorDriver({
    sourcePath: "/tmp/cursor-helper.swift",
    binaryPath: "/tmp/cursor-helper",
    dryRun: false
  });
  driver.child = {
    stdin: {
      writable: true,
      write: (value) => writes.push(value)
    }
  };

  driver.move(2, 3, { wakeDisplay: true });
  await new Promise((resolve) => setImmediate(resolve));
  driver.move(4, 5, { wakeDisplay: false });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(writes, ["move 2.000 3.000 wake\n", "move 4.000 5.000 passive\n"]);
});
