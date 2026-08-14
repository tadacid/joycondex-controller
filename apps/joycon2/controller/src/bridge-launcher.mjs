import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BridgeLauncher {
  constructor({
    bridgeDir,
    healthUrl = "http://127.0.0.1:8787/health",
    startTimeoutMs = 12_000,
    fetchFn = fetch,
    spawnFn = spawn,
    onLog = () => {}
  }) {
    this.bridgeDir = bridgeDir;
    this.healthUrl = healthUrl;
    this.startTimeoutMs = startTimeoutMs;
    this.fetchFn = fetchFn;
    this.spawnFn = spawnFn;
    this.onLog = onLog;
    this.child = null;
    this.startPromise = null;
    this.phase = "idle";
  }

  snapshot() {
    return { phase: this.phase, owned: Boolean(this.child) };
  }

  async isHealthy() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    try {
      const response = await this.fetchFn(this.healthUrl, {
        cache: "no-store",
        signal: controller.signal
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  ensureStarted() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#ensureStarted().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async #ensureStarted() {
    if (await this.isHealthy()) {
      this.phase = "running";
      return { ok: true, alreadyRunning: true, message: "接続待ちです。Joy-ConのSYNCボタンを長押ししてください" };
    }

    this.phase = "starting";
    this.onLog("info", "Joy-Con Bridgeを画面から起動します");
    const child = this.spawnFn("/bin/zsh", ["-c", "zsh build.sh && exec node server.mjs"], {
      cwd: this.bridgeDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    child.stdout?.on("data", (chunk) => this.onLog("bridge", String(chunk).trim()));
    child.stderr?.on("data", (chunk) => this.onLog("warn", String(chunk).trim()));
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.phase = "idle";
      this.onLog("warn", `Joy-Con Bridgeが終了しました (${signal ?? code})`);
    });

    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.isHealthy()) {
        this.phase = "running";
        return { ok: true, alreadyRunning: false, message: "接続待ちを開始しました。Joy-ConのSYNCボタンを長押ししてください" };
      }
      if (this.child !== child) break;
      await sleep(250);
    }

    await this.stop();
    throw new Error("Joy-Con Bridgeを起動できませんでした。画面下のログを確認してください");
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.phase = "idle";
    if (!child || child.killed) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
