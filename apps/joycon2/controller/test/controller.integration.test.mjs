import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, "..");
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function waitFor(check, { timeoutMs = 5000, intervalMs = 40 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch {}
    await sleep(intervalMs);
  }
  throw new Error("timeout");
}

test("fake BridgeからTALK→ACTIONまでDRY RUNで通る", async (t) => {
  const clients = new Set();
  const fake = createServer((request, response) => {
    if (request.url !== "/events") {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    response.write("retry: 100\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
  });
  await new Promise((resolveListen) => fake.listen(0, "127.0.0.1", resolveListen));
  const fakePort = fake.address().port;
  const uiPort = 18_788 + Math.floor(Math.random() * 500);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "codex-controller-integration-"));
  const temporaryConfig = join(temporaryDirectory, "config.json");
  await writeFile(temporaryConfig, JSON.stringify({
    bindings: {
      talk:"zr", voiceChat:"plus", action:"a", cancel:"b", newChat:"y", focus:[], escape:"x",
      taskUp:"home", taskDown:"chat", reasonUp:"railRightSr", reasonDown:"railRightSl",
      contextPrimary:[], mouseClick:[], master:"plus"
    }
  }));
  const child = spawn(process.execPath, ["src/controller.mjs"], {
    cwd: projectDir,
    env: {
      ...process.env,
      CODEX_CONTROLLER_DRY_RUN: "1",
      CODEX_CONTROLLER_PORT: String(uiPort),
      CODEX_CONTROLLER_CONFIG: temporaryConfig,
      JOYCON_BRIDGE_URL: `http://127.0.0.1:${fakePort}/events`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolveExit) => child.once("exit", resolveExit)).catch(() => {});
    for (const client of clients) client.end();
    await new Promise((resolveClose) => fake.close(resolveClose));
  });

  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${uiPort}/health`);
    return response.ok;
  });
  await waitFor(() => clients.size > 0);

  const send = (payload) => {
    for (const client of clients) client.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const neutral = {
    type: "input",
    id: "R1",
    name: "Joy-Con 2 (R)",
    side: "right",
    buttons: {},
    stick: { x: 0, y: 0 },
    batteryVoltage: 4.05
  };
  send({ type: "connected", id: "R1", name: "Joy-Con 2 (R)" });
  send(neutral);

  await waitFor(async () => {
    const payload = await (await fetch(`http://127.0.0.1:${uiPort}/health`)).json();
    return payload.state.neutralReady;
  });
  const armResponse = await fetch(`http://127.0.0.1:${uiPort}/api/arm`, { method: "POST" });
  assert.equal(armResponse.status, 200);

  send({ ...neutral, buttons: { zr: true } });
  await sleep(300);
  send({ ...neutral, buttons: { zr: false } });
  await sleep(350);
  send({ ...neutral, buttons: { a: true } });
  send({ ...neutral, buttons: { a: false } });

  const final = await waitFor(async () => {
    const payload = await (await fetch(`http://127.0.0.1:${uiPort}/health`)).json();
    const messages = payload.logs.map((entry) => entry.message);
    return messages.includes("ACTION送信") ? payload : null;
  }, { timeoutMs: 6000 });

  assert.equal(final.state.armed, true);
  assert.ok(final.logs.some((entry) => entry.message === "TALK開始"));
  assert.ok(final.logs.some((entry) => entry.message === "TALK終了"));
  assert.ok(final.logs.some((entry) => entry.message === "ACTION送信"));
  assert.ok(final.logs.some((entry) => entry.message.includes("VoiceKey POST") && entry.message.endsWith("/start")));
  assert.ok(final.logs.some((entry) => entry.message.includes("VoiceKey POST") && entry.message.endsWith("/stop")));
  assert.match(output, /Mode: DRY RUN/);

  const changedBindings = {
    talk:["railRightSl"], voiceChat:["plus"], action:["a"], cancel:["b"], newChat:["y"], focus:[], escape:["x"],
    taskUp:["home"], taskDown:["chat"], reasonUp:["railRightSr"], reasonDown:[],
    contextPrimary:["zr"], mouseClick:["stickRight"]
  };
  const feedback = { enabled:true, strength:5 };
  const armedSave = await fetch(`http://127.0.0.1:${uiPort}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bindings: changedBindings, mouse:{ enabled:true, sensorSensitivity:0.3, stickSpeed:27 }, feedback })
  });
  assert.equal(armedSave.status, 409);

  await fetch(`http://127.0.0.1:${uiPort}/api/disarm`, { method: "POST" });
  await waitFor(async () => {
    const payload = await (await fetch(`http://127.0.0.1:${uiPort}/health`)).json();
    return !payload.state.armed && !payload.controller.actionBusy;
  });

  const duplicateSave = await fetch(`http://127.0.0.1:${uiPort}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bindings: { ...changedBindings, action:["railRightSl"] }, mouse:{ enabled:true, sensorSensitivity:0.3, stickSpeed:27 }, feedback })
  });
  assert.equal(duplicateSave.status, 400);

  const settingsResponse = await fetch(`http://127.0.0.1:${uiPort}/api/settings`);
  const settings = await settingsResponse.json();
  assert.equal(settings.ok, true);
  assert.ok(settings.buttonOptions.some((option) => option.value === "railRightSl"));
  assert.ok(settings.buttonOptions.some((option) => option.value === "home"));
  assert.ok(settings.functionOptions.some((option) => option.value === "taskUp"));
  assert.ok(settings.functionOptions.some((option) => option.value === "taskDown"));
  assert.ok(settings.functionOptions.some((option) => option.value === "reasonUp"));
  assert.ok(settings.functionOptions.some((option) => option.value === "reasonDown"));
  assert.ok(settings.functionOptions.some((option) => option.value === "mouseClick"));
  assert.ok(settings.functionOptions.some((option) => option.value === "contextPrimary"));
  assert.ok(settings.functionOptions.some((option) => option.value === "voiceChat"));
  assert.ok(settings.functionOptions.some((option) => option.value === "escape"));
  assert.equal(settings.mouse.sensorSensitivity, 0.4);
  assert.equal(settings.mouse.stickSpeed, 54);
  assert.deepEqual(settings.feedback, feedback);

  const validSave = await fetch(`http://127.0.0.1:${uiPort}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bindings: changedBindings, mouse:{ enabled:true, sensorSensitivity:0.3, stickSpeed:27 }, feedback:{ enabled:true, strength:4 } })
  });
  assert.equal(validSave.status, 200);
  const savedConfig = JSON.parse(await readFile(temporaryConfig, "utf8"));
  assert.deepEqual(savedConfig.bindings.talk, ["railRightSl"]);
  assert.deepEqual(savedConfig.bindings.taskUp, ["home"]);
  assert.deepEqual(savedConfig.bindings.taskDown, ["chat"]);
  assert.deepEqual(savedConfig.bindings.contextPrimary, ["zr"]);
  assert.deepEqual(savedConfig.bindings.mouseClick, ["stickRight"]);
  assert.equal(savedConfig.mouse.sensorSensitivity, 0.3);
  assert.equal(savedConfig.mouse.stickSpeed, 27);
  assert.deepEqual(savedConfig.feedback, { enabled:true, strength:4 });

  send(neutral);
  await waitFor(async () => {
    const payload = await (await fetch(`http://127.0.0.1:${uiPort}/health`)).json();
    return payload.state.neutralReady;
  });
  const rearmResponse = await fetch(`http://127.0.0.1:${uiPort}/api/arm`, { method: "POST" });
  assert.equal(rearmResponse.status, 200);

  const talkCountBefore = final.logs.filter((entry) => entry.message === "TALK開始").length;
  send({ ...neutral, buttons: { zr: true } });
  send({ ...neutral, buttons: { zr: false } });
  await sleep(100);
  send({ ...neutral, buttons: { railRightSl: true } });
  await sleep(300);
  send({ ...neutral, buttons: { railRightSl: false } });
  const remapped = await waitFor(async () => {
    const payload = await (await fetch(`http://127.0.0.1:${uiPort}/health`)).json();
    return payload.logs.filter((entry) => entry.message === "TALK開始").length === talkCountBefore + 1
      ? payload
      : null;
  }, { timeoutMs: 6000 });
  assert.deepEqual(remapped.controller.bindings.talk, ["railRightSl"]);
});
