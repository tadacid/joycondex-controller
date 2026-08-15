import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`カーソル操作の準備に失敗しました (${signal ?? code}): ${stderr.trim()}`));
    });
  });
}

async function modifiedAt(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

export class CursorDriver {
  constructor({ sourcePath, binaryPath, dryRun = false, onLog = () => {}, spawnFn = spawn }) {
    this.sourcePath = sourcePath;
    this.binaryPath = binaryPath;
    this.dryRun = dryRun;
    this.onLog = onLog;
    this.spawnFn = spawnFn;
    this.child = null;
    this.startPromise = null;
    this.pendingX = 0;
    this.pendingY = 0;
    this.pendingDisplayWake = false;
    this.flushScheduled = false;
    this.buttonDown = false;
  }

  snapshot() {
    return { ready: this.dryRun || Boolean(this.child), dryRun: this.dryRun };
  }

  async start() {
    if (this.dryRun || this.child) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async #start() {
    await mkdir(dirname(this.binaryPath), { recursive: true });
    if (await modifiedAt(this.binaryPath) < await modifiedAt(this.sourcePath)) {
      this.onLog("info", "マウス操作を準備しています");
      await run("/usr/bin/xcrun", ["swiftc", this.sourcePath, "-o", this.binaryPath]);
    }
    const child = this.spawnFn(this.binaryPath, [], { stdio: ["pipe", "ignore", "pipe"] });
    this.child = child;
    child.stderr?.on("data", (chunk) => this.onLog("warn", String(chunk).trim()));
    child.once("error", (error) => {
      if (this.child === child) this.child = null;
      this.onLog("error", `マウス操作を開始できません: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      if (code !== 0) this.onLog("warn", `マウス操作が終了しました (${signal ?? code})`);
    });
    await new Promise((resolveStart, rejectStart) => {
      child.once("spawn", resolveStart);
      child.once("error", rejectStart);
    });
    this.onLog("info", "マウス操作の準備ができました");
  }

  move(dx, dy, { wakeDisplay = false } = {}) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return;
    if (this.dryRun) return;
    this.pendingX += dx;
    this.pendingY += dy;
    this.pendingDisplayWake ||= Boolean(wakeDisplay);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => this.#flush());
  }

  button(down) {
    const next = Boolean(down);
    if (this.buttonDown === next) return;
    this.buttonDown = next;
    if (this.dryRun || !this.child?.stdin?.writable) return;
    this.child.stdin.write(`button ${next ? 1 : 0}\n`);
  }

  focusComposer() {
    if (this.dryRun) {
      this.onLog("dry", "入力欄フォーカス切替");
      return;
    }
    if (!this.child?.stdin?.writable) {
      throw new Error("入力欄切替の準備ができていません");
    }
    this.child.stdin.write("focus-composer\n");
  }

  #flush() {
    this.flushScheduled = false;
    const dx = this.pendingX;
    const dy = this.pendingY;
    const wakeDisplay = this.pendingDisplayWake;
    this.pendingX = 0;
    this.pendingY = 0;
    this.pendingDisplayWake = false;
    if (!this.child?.stdin?.writable || (dx === 0 && dy === 0)) return;
    this.child.stdin.write(`move ${dx.toFixed(3)} ${dy.toFixed(3)} ${wakeDisplay ? "wake" : "passive"}\n`);
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.pendingX = 0;
    this.pendingY = 0;
    this.pendingDisplayWake = false;
    if (this.buttonDown && child?.stdin?.writable) child.stdin.write("button 0\n");
    this.buttonDown = false;
    if (!child || child.killed) return;
    child.stdin?.end();
    child.kill("SIGTERM");
    await new Promise((resolveStop) => child.once("exit", resolveStop)).catch(() => {});
  }
}
