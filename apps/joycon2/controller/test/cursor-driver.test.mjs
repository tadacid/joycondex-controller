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
