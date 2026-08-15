import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function jsonDownload(response, payload) {
  const date = new Date().toISOString().slice(0, 10);
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="joycondex-settings-${date}.json"`,
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function originAllowed(request, host, port) {
  const origin = request.headers.origin;
  return !origin || origin === `http://${host}:${port}`;
}

function readJsonBody(request, { maximumBytes = 8192 } = {}) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (status, message) => {
      if (settled) return;
      settled = true;
      rejectBody(Object.assign(new Error(message), { status }));
    };

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        fail(413, "設定データが大きすぎます");
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        rejectBody(Object.assign(new Error("JSONの形式が不正です"), { status: 400 }));
      }
    });
    request.on("error", () => fail(400, "設定データを読み取れませんでした"));
  });
}

export class UIServer {
  constructor({ host, port, publicDir, getPayload, arm, disarm, connectJoycon, getSettings, saveSettings, getSettingsBackup, restoreSettings, receiveCodexEvent, testFeedback, onLog }) {
    this.host = host;
    this.port = port;
    this.publicDir = publicDir;
    this.getPayload = getPayload;
    this.arm = arm;
    this.disarm = disarm;
    this.connectJoycon = connectJoycon ?? (async () => ({ ok: false, status: 501, message: "接続機能がありません" }));
    this.getSettings = getSettings ?? (() => ({ ok: false, message: "設定機能がありません" }));
    this.saveSettings = saveSettings ?? (async () => ({ ok: false, status: 501, message: "設定機能がありません" }));
    this.getSettingsBackup = getSettingsBackup ?? (() => ({ ok: false, message: "バックアップ機能がありません" }));
    this.restoreSettings = restoreSettings ?? (async () => ({ ok: false, status: 501, message: "復元機能がありません" }));
    this.receiveCodexEvent = receiveCodexEvent ?? (async () => ({ ok: false, status: 501, message: "通知機能がありません" }));
    this.testFeedback = testFeedback ?? (async () => ({ ok: false, status: 501, message: "振動テスト機能がありません" }));
    this.onLog = onLog ?? (() => {});
    this.clients = new Set();
    this.server = createServer((request, response) => this.#handle(request, response));
  }

  start() {
    return new Promise((resolveStart, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolveStart();
      });
    });
  }

  stop() {
    for (const client of this.clients) client.end();
    this.clients.clear();
    const closing = new Promise((resolveStop) => this.server.close(resolveStop));
    this.server.closeAllConnections?.();
    return closing;
  }

  broadcast(payload = this.getPayload()) {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  async #handle(request, response) {
    const url = new URL(request.url ?? "/", `http://${this.host}:${this.port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true, ...this.getPayload() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      response.write("retry: 1000\n\n");
      this.clients.add(response);
      response.write(`data: ${JSON.stringify(this.getPayload())}\n\n`);
      request.on("close", () => this.clients.delete(response));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/settings") {
      json(response, 200, this.getSettings());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/settings/backup") {
      jsonDownload(response, this.getSettingsBackup());
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/settings") {
      if (!originAllowed(request, this.host, this.port)) {
        json(response, 403, { ok: false, message: "Origin rejected" });
        return;
      }
      const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        json(response, 415, { ok: false, message: "Content-Typeはapplication/jsonにしてください" });
        return;
      }
      try {
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body) ||
            Object.keys(body).length !== 3 || !("bindings" in body) || !("mouse" in body) || !("feedback" in body)) {
          json(response, 400, { ok: false, message: "bindings、mouse、feedbackだけを指定してください" });
          return;
        }
        const result = await this.saveSettings(body.bindings, body.mouse, body.feedback);
        json(response, result.status ?? (result.ok ? 200 : 400), result);
        this.broadcast();
      } catch (error) {
        json(response, error.status ?? 400, { ok: false, message: error.message });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/codex-event") {
      if (request.headers.origin) {
        json(response, 403, { ok: false, message: "Browser Origin rejected" });
        return;
      }
      const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        json(response, 415, { ok: false, message: "Content-Typeはapplication/jsonにしてください" });
        return;
      }
      try {
        const body = await readJsonBody(request, { maximumBytes: 1024 });
        if (!body || typeof body !== "object" || Array.isArray(body) ||
            Object.keys(body).length !== 2 || typeof body.type !== "string" || typeof body.eventId !== "string") {
          json(response, 400, { ok: false, message: "typeとeventIdだけを指定してください" });
          return;
        }
        const result = await this.receiveCodexEvent(body);
        json(response, result.status ?? (result.ok ? 202 : 400), result);
        this.broadcast();
      } catch (error) {
        json(response, error.status ?? 400, { ok: false, message: error.message });
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/feedback/test") {
      if (!originAllowed(request, this.host, this.port)) {
        json(response, 403, { ok: false, message: "Origin rejected" });
        return;
      }
      const result = await this.testFeedback();
      json(response, result.status ?? (result.ok ? 202 : 400), result);
      this.broadcast();
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/settings/restore") {
      if (!originAllowed(request, this.host, this.port)) {
        json(response, 403, { ok: false, message: "Origin rejected" });
        return;
      }
      const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        json(response, 415, { ok: false, message: "Content-Typeはapplication/jsonにしてください" });
        return;
      }
      try {
        const backup = await readJsonBody(request);
        const result = await this.restoreSettings(backup);
        json(response, result.status ?? (result.ok ? 200 : 400), result);
        this.broadcast();
      } catch (error) {
        json(response, error.status ?? 400, { ok: false, message: error.message });
      }
      return;
    }
    if (request.method === "POST" && (url.pathname === "/api/arm" || url.pathname === "/api/disarm")) {
      if (!originAllowed(request, this.host, this.port)) {
        json(response, 403, { ok: false, message: "Origin rejected" });
        return;
      }
      const result = url.pathname.endsWith("arm") && !url.pathname.endsWith("disarm")
        ? this.arm()
        : this.disarm();
      json(response, result.ok ? 200 : 409, result);
      this.broadcast();
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/connect-joycon") {
      if (!originAllowed(request, this.host, this.port)) {
        json(response, 403, { ok: false, message: "Origin rejected" });
        return;
      }
      try {
        const result = await this.connectJoycon();
        json(response, result.status ?? (result.ok ? 200 : 500), result);
        this.broadcast();
      } catch (error) {
        json(response, 500, { ok: false, message: error.message });
      }
      return;
    }
    if (request.method !== "GET") {
      json(response, 405, { ok: false, message: "Method not allowed" });
      return;
    }

    const fileName = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const publicRoot = resolve(this.publicDir);
    const filePath = resolve(publicRoot, fileName);
    if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
      json(response, 403, { ok: false });
      return;
    }
    try {
      await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
        "Cache-Control": "no-store"
      });
      createReadStream(filePath).pipe(response);
    } catch {
      json(response, 404, { ok: false, message: "Not found" });
    }
  }
}
