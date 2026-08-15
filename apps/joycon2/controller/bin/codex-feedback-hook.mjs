import { createHash } from "node:crypto";

const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 64 * 1024) process.exit(0);
  chunks.push(chunk);
}

let input = {};
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.exit(0);
}

const type = input.hook_event_name === "Stop"
  ? "complete"
  : input.hook_event_name === "PermissionRequest"
    ? "approval"
    : null;

if (type) {
  const identity = JSON.stringify({
    event: input.hook_event_name,
    session: input.session_id,
    turn: input.turn_id,
    tool: input.tool_name,
    toolInput: input.tool_input
  });
  const eventId = createHash("sha256").update(identity).digest("hex");
  try {
    const endpoint = process.env.CODEX_GRIP_FEEDBACK_URL ?? "http://127.0.0.1:8788/api/codex-event";
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, eventId }),
      signal: AbortSignal.timeout(700)
    });
  } catch {
    // Controller未起動時もCodex本体の処理を妨げない。
  }
}

if (input.hook_event_name === "Stop") process.stdout.write('{"continue":true}\n');
