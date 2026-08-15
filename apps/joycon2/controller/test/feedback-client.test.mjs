import test from "node:test";
import assert from "node:assert/strict";
import { FeedbackClient } from "../src/feedback-client.mjs";

function response(status = 202, payload = { ok:true, requestId:"r1" }) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("完了は2回、承認待ちは3回の振動として送る", async () => {
  const calls = [];
  const client = new FeedbackClient({
    endpoint:"http://127.0.0.1:8787/feedback/rumble",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(); }
  });
  client.handleBridgeEvent({ type:"haptics", ready:true });
  await client.notify("complete", { eventId:"complete-1" });
  await client.notify("approval", { eventId:"approval-1" });
  const complete = JSON.parse(calls[0].options.body);
  const approval = JSON.parse(calls[1].options.body);
  assert.deepEqual(complete.pulses, [
    { onMs:500, offMs:250 },
    { onMs:500, offMs:0 }
  ]);
  assert.deepEqual(approval.pulses, [
    { onMs:500, offMs:250 },
    { onMs:500, offMs:250 },
    { onMs:500, offMs:0 }
  ]);
  assert.equal(complete.strength, 5);
  assert.equal(approval.strength, 5);
});

test("DISABLEDとは無関係に通知し、同じイベントは重複送信しない", async () => {
  let calls = 0;
  const client = new FeedbackClient({
    endpoint:"http://127.0.0.1:8787/feedback/rumble",
    fetchImpl: async () => { calls += 1; return response(); }
  });
  client.handleBridgeEvent({ type:"haptics", ready:true });
  await client.notify("complete", { eventId:"same-turn" });
  const duplicate = await client.notify("complete", { eventId:"same-turn" });
  assert.equal(calls, 1);
  assert.equal(duplicate.duplicate, true);
});

test("通知OFFと未接続時はBridgeへ送らない", async () => {
  let calls = 0;
  const client = new FeedbackClient({
    endpoint:"http://127.0.0.1:8787/feedback/rumble",
    enabled:false,
    fetchImpl: async () => { calls += 1; return response(); }
  });
  assert.equal((await client.notify("complete", { eventId:"off" })).skipped, true);
  client.configure({ enabled:true, strength:3 });
  assert.equal((await client.notify("approval", { eventId:"disconnected" })).status, 409);
  assert.equal(calls, 0);
});

test("左Joy-Con切断では右Joy-Conの振動準備状態を失わず、Bridge切断では解除する", () => {
  const client = new FeedbackClient({ endpoint:"http://127.0.0.1:8787/feedback/rumble" });
  client.handleBridgeEvent({ type:"haptics", id:"right", ready:true });
  client.handleBridgeEvent({ type:"disconnected", id:"left" });
  assert.equal(client.snapshot().hapticsReady, true);
  client.setBridgeConnection(false);
  assert.equal(client.snapshot().hapticsReady, false);
});
