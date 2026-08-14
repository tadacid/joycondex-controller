import { createConnection } from "node:net";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function post(urlString, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const port = Number(url.port || 80);
    let settled = false;
    let responseText = "";
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.end();
      callback(value);
    };
    const socket = createConnection({ host: url.hostname, port }, () => {
      const path = `${url.pathname}${url.search}`;
      socket.write(
        `POST ${path} HTTP/1.1\r\n` +
        `Host: ${url.host}\r\n` +
        "User-Agent: Codex-Grip\r\n" +
        "Accept: */*\r\n\r\n"
      );
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      finish(reject, Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    });
    socket.on("data", (chunk) => {
      responseText += chunk.toString("utf8");
      const lineEnd = responseText.indexOf("\r\n");
      if (lineEnd < 0) return;
      const match = responseText.slice(0, lineEnd).match(/^HTTP\/1\.[01] (\d{3})\b/);
      if (!match) {
        finish(reject, new Error("VoiceKeyのHTTP応答が不正です"));
        return;
      }
      const status = Number(match[1]);
      if (status >= 200 && status < 300) finish(resolve, status);
      else finish(reject, Object.assign(new Error(`HTTP ${status}`), { status }));
    });
    socket.once("error", (error) => finish(reject, error));
    socket.once("close", () => {
      if (!settled) finish(reject, new Error("応答前に接続が閉じられました"));
    });
  });
}

export class VoiceKeyClient {
  constructor({
    baseUrl = "http://127.0.0.1:47321",
    timeoutMs = 1000,
    dryRun = false,
    stopRetryCount = 1,
    stopRetryDelayMs = 100,
    onLog
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.dryRun = dryRun;
    this.stopRetryCount = stopRetryCount;
    this.stopRetryDelayMs = stopRetryDelayMs;
    this.onLog = onLog ?? (() => {});
    this.ownsRecording = false;
  }

  async start() {
    if (this.ownsRecording) return { ok: true, skipped: true };
    await this.#command("start");
    this.ownsRecording = true;
    return { ok: true };
  }

  async stop() {
    if (!this.ownsRecording) return { ok: true, skipped: true };

    let lastError = null;
    for (let attempt = 0; attempt <= this.stopRetryCount; attempt += 1) {
      try {
        await this.#command("stop");
        this.ownsRecording = false;
        return { ok: true, attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        if (attempt < this.stopRetryCount) {
          this.onLog("warn", "VoiceKey停止を再試行します");
          await sleep(this.stopRetryDelayMs);
        }
      }
    }
    throw lastError ?? new Error("VoiceKeyを停止できませんでした");
  }

  async #command(command) {
    const url = `${this.baseUrl}/${command}`;
    if (this.dryRun) {
      this.onLog("dry", `VoiceKey POST ${url}`);
      return;
    }

    try {
      await post(url, this.timeoutMs);
    } catch (error) {
      if (error?.code === "ETIMEDOUT") {
        throw new Error(`VoiceKey ${command}が${this.timeoutMs}ms以内に応答しませんでした`);
      }
      if (error?.status) throw new Error(`VoiceKey ${command}失敗: HTTP ${error.status}`);
      throw new Error(`VoiceKey ${command}へ接続できません: ${error.message}`);
    }
  }
}
