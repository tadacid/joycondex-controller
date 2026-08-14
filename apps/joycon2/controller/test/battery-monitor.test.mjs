import test from "node:test";
import assert from "node:assert/strict";
import { BatteryMonitor } from "../src/battery-monitor.mjs";

test("低電圧は1回だけ警告し、回復後は再び警告できる", async () => {
  const warnings = [];
  const monitor = new BatteryMonitor({ onWarning: (warning) => warnings.push(warning) });

  monitor.update({ connected:true, voltage:4.05 });
  monitor.update({ connected:true, voltage:3.54 });
  monitor.update({ connected:true, voltage:3.48 });
  await Promise.resolve();
  assert.equal(warnings.length, 1);
  assert.equal(monitor.snapshot().low, true);

  monitor.update({ connected:true, voltage:3.72 });
  monitor.update({ connected:true, voltage:3.5 });
  await Promise.resolve();
  assert.equal(warnings.length, 2);
});

test("切断中や電圧不明では警告しない", async () => {
  const warnings = [];
  const monitor = new BatteryMonitor({ onWarning: (warning) => warnings.push(warning) });
  monitor.update({ connected:false, voltage:3.4 });
  monitor.update({ connected:true, voltage:null });
  await Promise.resolve();
  assert.equal(warnings.length, 0);
  assert.equal(monitor.snapshot().low, false);
});
