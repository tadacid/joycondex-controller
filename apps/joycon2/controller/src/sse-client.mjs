const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dispatchEventBlock(block, onMessage) {
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return;
  onMessage(data.join("\n"));
}

export class SSEClient {
  constructor(url, { onMessage, onStatus, onError } = {}) {
    this.url = url;
    this.onMessage = onMessage ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.onError = onError ?? (() => {});
    this.stopped = true;
    this.abortController = null;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.loopPromise = this.#loop();
  }

  async stop() {
    this.stopped = true;
    this.abortController?.abort();
    await this.loopPromise?.catch(() => {});
  }

  async #loop() {
    let retryMs = 500;
    while (!this.stopped) {
      this.abortController = new AbortController();
      try {
        this.onStatus({ phase: "connecting", connected: false });
        const response = await fetch(this.url, {
          headers: { Accept: "text/event-stream" },
          cache: "no-store",
          signal: this.abortController.signal
        });
        if (!response.ok || !response.body) {
          throw new Error(`SSE接続失敗: HTTP ${response.status}`);
        }
        this.onStatus({ phase: "connected", connected: true });
        retryMs = 500;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!this.stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          while (true) {
            const index = buffer.search(/\r?\n\r?\n/);
            if (index < 0) break;
            const separator = buffer.slice(index).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + separator.length);
            dispatchEventBlock(block, this.onMessage);
          }
        }
        if (!this.stopped) throw new Error("SSE接続が終了しました");
      } catch (error) {
        if (this.stopped || error?.name === "AbortError") break;
        this.onStatus({ phase: "disconnected", connected: false });
        this.onError(error);
        await sleep(retryMs);
        retryMs = Math.min(5000, Math.round(retryMs * 1.7));
      }
    }
  }
}
