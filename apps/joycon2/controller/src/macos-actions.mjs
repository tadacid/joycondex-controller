import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runProcess(command, args, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command}が${timeoutMs}ms以内に終了しませんでした`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command}失敗 (${signal ?? code}): ${stderr.trim()}`));
    });
  });
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export class MacOSActions {
  constructor({ appNames, focusDelayMs = 220, actionCooldownMs = 140, dryRun = false, onLog }) {
    this.appNames = appNames;
    this.focusDelayMs = focusDelayMs;
    this.actionCooldownMs = actionCooldownMs;
    this.dryRun = dryRun;
    this.onLog = onLog ?? (() => {});
    this.queue = Promise.resolve();
  }

  enqueue(label, operation) {
    const task = this.queue.then(async () => {
      this.onLog("debug", `実行: ${label}`);
      const result = await operation();
      await sleep(this.actionCooldownMs);
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async drain() {
    await this.queue;
  }

  async #run(command, args) {
    if (this.dryRun) {
      this.onLog("dry", `${command} ${args.join(" ")}`);
      return "";
    }
    if (process.platform !== "darwin") {
      throw new Error("macOS操作はmacOS上でのみ実行できます。検証時はCODEX_CONTROLLER_DRY_RUN=1を使ってください");
    }
    return runProcess(command, args);
  }

  async #osascript(lines) {
    const args = lines.flatMap((line) => ["-e", line]);
    return this.#run("osascript", args);
  }

  async activateTarget() {
    try {
      const frontmost = await this.frontmostApp();
      const activeTarget = this.appNames.find(
        (name) => name.toLowerCase() === frontmost.toLowerCase()
      );
      if (activeTarget) return activeTarget;
    } catch {}

    let lastError = null;
    for (const appName of this.appNames) {
      try {
        await this.#run("open", ["-a", appName]);
        await sleep(this.focusDelayMs);
        return appName;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("対象アプリを起動できませんでした");
  }

  async frontmostApp() {
    if (this.dryRun) return this.appNames[0];
    return this.#osascript([
      'tell application "System Events"',
      'name of first application process whose frontmost is true',
      "end tell"
    ]);
  }

  async targetIsFrontmost() {
    const frontmost = await this.frontmostApp();
    return this.appNames.some((name) => name.toLowerCase() === frontmost.toLowerCase());
  }

  async requireTargetFrontmost() {
    const frontmost = await this.frontmostApp();
    const matches = this.appNames.some((name) => name.toLowerCase() === frontmost.toLowerCase());
    if (!matches) throw new Error(`対象外アプリが前面です: ${frontmost || "不明"}`);
    return frontmost;
  }

  async keyCode(code, modifiers = []) {
    const using = modifiers.length > 0 ? ` using {${modifiers.map((m) => `${m} down`).join(", ")}}` : "";
    return this.#osascript([
      'tell application "System Events"',
      `key code ${Number(code)}${using}`,
      "end tell"
    ]);
  }

  async keystroke(key, modifiers = []) {
    const using = modifiers.length > 0 ? ` using {${modifiers.map((m) => `${m} down`).join(", ")}}` : "";
    return this.#osascript([
      'tell application "System Events"',
      `keystroke ${appleScriptString(key)}${using}`,
      "end tell"
    ]);
  }

  async sendComposer() {
    return this.keyCode(36);
  }

  async clearComposer() {
    await this.keystroke("a", ["command"]);
    await sleep(80);
    return this.keyCode(51);
  }

  async deleteBackward() {
    return this.keyCode(51);
  }

  async escape() {
    return this.keyCode(53);
  }

  async scrollLatest() {
    return this.keyCode(125, ["command"]);
  }

  async toggleVoiceChat() {
    return this.keystroke("v", ["control", "option"]);
  }

  async previousChat() {
    return this.keystroke("[", ["command", "shift"]);
  }

  async nextChat() {
    return this.keystroke("]", ["command", "shift"]);
  }

  async previousRecentChat() {
    return this.keyCode(126, ["control", "option", "shift"]);
  }

  async nextRecentChat() {
    return this.keyCode(125, ["control", "option", "shift"]);
  }

  async increaseReasoningEffort() {
    return this.keyCode(124, ["control", "option", "shift"]);
  }

  async decreaseReasoningEffort() {
    return this.keyCode(123, ["control", "option", "shift"]);
  }

  async openNewChat() {
    return this.#run("open", ["codex://threads/new"]);
  }

  async notifyLowBattery(voltage) {
    const detail = Number.isFinite(voltage) ? `（${voltage.toFixed(2)} V）` : "";
    return this.#osascript([
      `display notification ${appleScriptString(`Joy-Conを充電してください${detail}`)} with title "JoyCondex" subtitle "バッテリー残量が少なくなっています"`
    ]);
  }
}
