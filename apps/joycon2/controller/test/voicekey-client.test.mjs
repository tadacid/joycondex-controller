import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { VoiceKeyClient } from "../src/voicekey-client.mjs";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("VoiceKeyは開始・停止を各1回だけ送る", async () => {
  const commands = [];
  await withServer((request, response) => {
    commands.push(`${request.method} ${request.url}`);
    response.writeHead(204).end();
  }, async (baseUrl) => {
    const client = new VoiceKeyClient({ baseUrl });
    await client.start();
    await client.start();
    assert.equal(client.ownsRecording, true);
    await client.stop();
    await client.stop();
    assert.equal(client.ownsRecording, false);
  });
  assert.deepEqual(commands, ["POST /start", "POST /stop"]);
});

test("VoiceKey停止だけ1回再試行する", async () => {
  let stopCount = 0;
  await withServer((request, response) => {
    if (request.url === "/stop") {
      stopCount += 1;
      response.writeHead(stopCount === 1 ? 500 : 204).end();
      return;
    }
    response.writeHead(204).end();
  }, async (baseUrl) => {
    const client = new VoiceKeyClient({ baseUrl, stopRetryDelayMs: 1 });
    await client.start();
    await client.stop();
  });
  assert.equal(stopCount, 2);
});

test("開始失敗後は停止要求を送らない", async () => {
  const commands = [];
  await withServer((request, response) => {
    commands.push(request.url);
    response.writeHead(503).end();
  }, async (baseUrl) => {
    const client = new VoiceKeyClient({ baseUrl });
    await assert.rejects(client.start(), /HTTP 503/);
    assert.equal(client.ownsRecording, false);
    await client.stop();
  });
  assert.deepEqual(commands, ["/start"]);
});

test("停止が再試行後も失敗した場合は録音所有状態を維持する", async () => {
  let stopCount = 0;
  await withServer((request, response) => {
    if (request.url === "/stop") {
      stopCount += 1;
      response.writeHead(503).end();
      return;
    }
    response.writeHead(204).end();
  }, async (baseUrl) => {
    const client = new VoiceKeyClient({ baseUrl, stopRetryDelayMs: 1 });
    await client.start();
    await assert.rejects(client.stop(), /HTTP 503/);
    assert.equal(client.ownsRecording, true);
  });
  assert.equal(stopCount, 2);
});
