import test from "node:test";
import assert from "node:assert/strict";
import { parseAdditionalSensorValues } from "../../bridge/input-sensors.mjs";

test("Joy-Con 2のマウス・温度・充電値を入力データから読む", () => {
  const bytes = Buffer.alloc(63);
  bytes.writeUInt16LE(101, 0x10);
  bytes.writeUInt16LE(202, 0x12);
  bytes.writeUInt16LE(303, 0x14);
  bytes.writeUInt16LE(404, 0x16);
  bytes.writeInt16LE(-505, 0x2e);
  bytes[0x21] = 0x02;
  bytes.writeUInt16LE(125, 0x22);
  assert.deepEqual(parseAdditionalSensorValues(bytes), {
    mouse: { positionX:101, positionY:202, surfaceQuality:303, liftOffDistance:404 },
    imuTemperatureRaw:-505,
    batteryCurrentMilliamps:1.25,
    chargeStatus:2
  });
});
