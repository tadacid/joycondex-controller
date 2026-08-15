const PATTERNS = Object.freeze({
  complete: Object.freeze({ label: "作業完了", pulses: [{ onMs: 500, offMs: 250 }, { onMs: 500, offMs: 0 }] }),
  approval: Object.freeze({ label: "承認待ち", pulses: [{ onMs: 500, offMs: 250 }, { onMs: 500, offMs: 250 }, { onMs: 500, offMs: 0 }] }),
  error: Object.freeze({ label: "エラー", pulses: [{ onMs: 500, offMs: 0 }] }),
  test: Object.freeze({ label: "テスト", pulses: [{ onMs: 500, offMs: 250 }, { onMs: 500, offMs: 250 }, { onMs: 500, offMs: 0 }] })
});

export const FEEDBACK_EVENT_TYPES = Object.freeze(["complete", "approval"]);

export class FeedbackClient {
  constructor({ endpoint, enabled = true, strength = 5, fetchImpl = fetch, timeoutMs = 1000, onLog, onState }) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.onLog = onLog ?? (() => {});
    this.onState = onState ?? (() => {});
    this.enabled = Boolean(enabled);
    this.strength = strength;
    this.hapticsReady = false;
    this.hapticsDeviceId = null;
    this.last = null;
    this.seen = new Map();
  }

  configure({ enabled, strength }) {
    this.enabled = Boolean(enabled);
    this.strength = strength;
    this.#emit();
  }

  handleBridgeEvent(event) {
    if (event?.type === "haptics") {
      if (event.ready) {
        this.hapticsReady = true;
        this.hapticsDeviceId = event.id ?? null;
      } else if (!this.hapticsDeviceId || event.id === this.hapticsDeviceId) {
        this.hapticsReady = false;
        this.hapticsDeviceId = null;
      }
      this.#emit();
    } else if (event?.type === "disconnected" && (!this.hapticsDeviceId || event.id === this.hapticsDeviceId)) {
      this.hapticsReady = false;
      this.hapticsDeviceId = null;
      this.#emit();
    } else if (event?.type === "rumble" && event.status === "failed") {
      this.#record("error", "error", event.message ?? "振動に失敗しました");
    }
  }

  setBridgeConnection(connected) {
    if (!connected) {
      this.hapticsReady = false;
      this.hapticsDeviceId = null;
      this.#emit();
    }
  }

  snapshot() {
    return {
      enabled: this.enabled,
      strength: this.strength,
      hapticsReady: this.hapticsReady,
      last: this.last ? { ...this.last } : null
    };
  }

  async notify(type, { eventId } = {}) {
    if (!FEEDBACK_EVENT_TYPES.includes(type)) {
      return { ok: false, status: 400, message: "未対応のCodex通知です" };
    }
    if (typeof eventId !== "string" || eventId.length < 1 || eventId.length > 160) {
      return { ok: false, status: 400, message: "eventIdが不正です" };
    }
    this.#pruneSeen();
    if (this.seen.has(eventId)) return { ok: true, duplicate: true };
    this.seen.set(eventId, Date.now());
    if (!this.enabled) {
      this.#record(type, "disabled", "振動通知はOFFです");
      return { ok: true, skipped: true };
    }
    return this.#send(type);
  }

  test() {
    return this.#send("test");
  }

  async stop() {
    try {
      const endpoint = new URL("/feedback/stop", this.endpoint).href;
      await this.fetchImpl(endpoint, { method: "POST", signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      // 終了処理を振動停止の失敗だけで止めない。
    }
  }

  async #send(type) {
    const pattern = PATTERNS[type];
    if (!pattern) return { ok: false, status: 400, message: "未対応の振動パターンです" };
    if (!this.hapticsReady) {
      this.#record(type, "missed", "右Joy-Con 2が未接続です");
      return { ok: false, status: 409, message: "右Joy-Con 2の振動機能が未接続です" };
    }
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pulses: pattern.pulses, strength: this.strength }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(result.message ?? `Bridge HTTP ${response.status}`), { status: response.status });
      this.#record(type, "sent", `${pattern.label}を振動へ送信`);
      this.onLog("info", `${pattern.label}の振動通知を送信しました`);
      return { ok: true, status: 202, requestId: result.requestId };
    } catch (error) {
      const message = error.name === "TimeoutError" ? "振動送信がtimeoutしました" : error.message;
      this.#record(type, "error", message);
      this.onLog("warn", `${pattern.label}の振動通知失敗: ${message}`);
      return { ok: false, status: error.status ?? 503, message };
    }
  }

  #record(type, status, message) {
    this.last = { type, status, message, at: Date.now() };
    this.#emit();
  }

  #pruneSeen() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, at] of this.seen) {
      if (at < cutoff) this.seen.delete(key);
    }
    while (this.seen.size > 200) this.seen.delete(this.seen.keys().next().value);
  }

  #emit() {
    this.onState(this.snapshot());
  }
}
