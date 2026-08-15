import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = resolve(here, "../bin/codex-feedback-hook.mjs");

async function runHook(input, endpoint) {
  const child = spawn(process.execPath, [hookPath], {
    env:{ ...process.env, CODEX_GRIP_FEEDBACK_URL:endpoint },
    stdio:["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stdin.end(JSON.stringify(input));
  const code = await new Promise((resolveExit) => child.once("exit", resolveExit));
  return { code, stdout };
}

test("Codex Hookを完了・承認待ちのローカル通知へ変換する", async () => {
  const received = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(202, { "Content-Type":"application/json" });
      response.end('{"ok":true}');
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/codex-event`;
  try {
    const stopped = await runHook({ hook_event_name:"Stop", session_id:"s1", turn_id:"t1" }, endpoint);
    const approval = await runHook({ hook_event_name:"PermissionRequest", session_id:"s1", turn_id:"t2", tool_name:"Bash", tool_input:{ command:"test" } }, endpoint);
    assert.equal(stopped.code, 0);
    assert.deepEqual(JSON.parse(stopped.stdout), { continue:true });
    assert.equal(approval.code, 0);
    assert.equal(received[0].type, "complete");
    assert.equal(received[1].type, "approval");
    assert.match(received[0].eventId, /^[a-f0-9]{64}$/);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
