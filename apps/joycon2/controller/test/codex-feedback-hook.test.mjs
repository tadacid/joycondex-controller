import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

test("Codex Hookを完了・人による承認待ちだけローカル通知へ変換する", async () => {
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
    const approval = await runHook({ hook_event_name:"PermissionRequest", session_id:"s1", turn_id:"t2", approvals_reviewer:"user", tool_name:"Bash", tool_input:{ command:"test" } }, endpoint);
    await runHook({ hook_event_name:"PermissionRequest", session_id:"s1", turn_id:"t3", approvals_reviewer:"auto_review", tool_name:"Bash", tool_input:{ command:"test" } }, endpoint);
    await runHook({ hook_event_name:"PermissionRequest", session_id:"s1", turn_id:"t4", tool_name:"Bash", tool_input:{ command:"test" } }, endpoint);
    assert.equal(stopped.code, 0);
    assert.deepEqual(JSON.parse(stopped.stdout), { continue:true });
    assert.equal(approval.code, 0);
    assert.equal(received.length, 2);
    assert.equal(received[0].type, "complete");
    assert.equal(received[1].type, "approval");
    assert.match(received[0].eventId, /^[a-f0-9]{64}$/);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test("現在のターン記録から人による承認待ちを判定する", async () => {
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
  const fixtureDir = await mkdtemp(resolve(tmpdir(), "joycondex-hook-"));
  const transcriptPath = resolve(fixtureDir, "transcript.jsonl");
  await writeFile(transcriptPath, [
    JSON.stringify({ type:"turn_context", payload:{ turn_id:"t-user", approvals_reviewer:"user" } }),
    JSON.stringify({ type:"turn_context", payload:{ turn_id:"t-auto", approvals_reviewer:"auto_review" } })
  ].join("\n"));

  try {
    await runHook({ hook_event_name:"PermissionRequest", session_id:"s1", turn_id:"t-user", transcript_path:transcriptPath, tool_name:"Bash", tool_input:{ command:"test" } }, endpoint);
    await runHook({ hook_event_name:"PermissionRequest", session_id:"s1", turn_id:"t-auto", transcript_path:transcriptPath, tool_name:"Bash", tool_input:{ command:"test" } }, endpoint);
    assert.equal(received.length, 1);
    assert.equal(received[0].type, "approval");
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(fixtureDir, { recursive:true, force:true });
  }
});
