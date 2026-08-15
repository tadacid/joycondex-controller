import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

const TRANSCRIPT_TAIL_BYTES = 8 * 1024 * 1024;

function reviewerFromInput(input) {
  return input.approvals_reviewer
    ?? input.reviewer
    ?? input.approval_context?.approvals_reviewer
    ?? null;
}

async function reviewerFromTranscript(transcriptPath, turnId) {
  if (typeof transcriptPath !== "string" || !transcriptPath || typeof turnId !== "string" || !turnId) return null;

  let file;
  try {
    file = await open(transcriptPath, "r");
    const { size } = await file.stat();
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);

    const lines = buffer.toString("utf8").split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      let entry;
      try {
        entry = JSON.parse(lines[index]);
      } catch {
        continue;
      }
      if (entry?.type === "turn_context" && entry.payload?.turn_id === turnId) {
        return entry.payload.approvals_reviewer ?? null;
      }
    }
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => {});
  }
  return null;
}

async function needsHumanApproval(input) {
  const reviewer = reviewerFromInput(input)
    ?? await reviewerFromTranscript(input.transcript_path, input.turn_id);
  return reviewer === "user";
}

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
  : input.hook_event_name === "PermissionRequest" && await needsHumanApproval(input)
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
