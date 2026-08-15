import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateRumbleRequest } from "../../bridge/rumble.mjs";

test("Bridgeは安全な振動要求だけを受け付ける", () => {
  const valid = { pulses:[{ onMs:500, offMs:0 }], strength:5 };
  assert.deepEqual(validateRumbleRequest(valid), valid);
  assert.throws(() => validateRumbleRequest({ ...valid, strength:6 }), /1〜5/);
  assert.throws(() => validateRumbleRequest({ ...valid, pulses:[{ onMs:501, offMs:0 }] }), /40〜500/);
  assert.throws(() => validateRumbleRequest({ ...valid, extra:true }), /だけを指定/);
  assert.throws(
    () => validateRumbleRequest({ pulses:Array.from({ length:6 }, () => ({ onMs:500, offMs:500 })), strength:1 }),
    /合計3000ms/
  );
});

test("完了・承認待ちに使う長いpulseを安全上限内で受け付ける", () => {
  const complete = { pulses:[{ onMs:500, offMs:0 }], strength:5 };
  const approval = {
    pulses:[{ onMs:500, offMs:250 }, { onMs:500, offMs:250 }, { onMs:500, offMs:0 }],
    strength:5
  };
  assert.deepEqual(validateRumbleRequest(complete), complete);
  assert.deepEqual(validateRumbleRequest(approval), approval);
});

test("native Bridgeは短周期で振動波形を更新する", async () => {
  const source = await readFile(new URL("../../bridge/native/main.swift", import.meta.url), "utf8");
  assert.match(source, /private let rumbleRefreshMs = 12/);
  assert.match(source, /context\.rumbleRefreshGeneration == refreshGeneration/);
  assert.match(source, /let levels: \[UInt16\] = \[5_800, 11_600, 17_400, 23_200, 29_000\]/);
  assert.match(source, /highFrequency: 0x187/);
  assert.match(source, /lowFrequency: 0x112/);
});
