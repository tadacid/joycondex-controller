import type {
  ControllerAdapter,
  ControllerDevice,
  ControllerFrame,
  ControllerSide,
  PlayerId
} from "@kirari/shared-types";
import {
  WebBluetoothJoyConAdapter,
  detectJoyCon2Side,
  type JoyCon2InputReport
} from "./web-bluetooth";

const BRIDGE_ORIGIN = "http://127.0.0.1:8787";
type FrameListener = (frame: ControllerFrame) => void;
type BridgeMessage = {
  type: "ready" | "scanning" | "found" | "connected" | "disconnected" | "frame" | "input" | "error";
  id?: string;
  name?: string;
  hex?: string;
  message?: string;
  buttons?: Record<string, boolean>;
  stick?: { x: number; y: number };
  acceleration?: { x: number; y: number; z: number };
  gyroscope?: { x: number; y: number; z: number };
  motionPower?: number;
  direction?: { x: number; y: number; z: number };
  batteryVoltage?: number;
  packetId?: number;
};
type SwingState = "IDLE" | "RISING" | "ACTIVE" | "COOLDOWN";

export interface JoyCon2Adapter extends ControllerAdapter {
  isSupported(): boolean;
  addDevice(): Promise<ControllerDevice>;
  readonly connectionMode: "mac-bridge" | "web-bluetooth" | "selecting";
}

function cloneFrame(frame: ControllerFrame): ControllerFrame {
  return structuredClone(frame);
}

class BridgeSwingGate {
  state: SwingState = "IDLE";
  cooldownAt = 0;

  update(power: number, timestamp: number): boolean {
    if (this.state === "COOLDOWN") {
      if (timestamp - this.cooldownAt < 180) return false;
      this.state = "IDLE";
    }
    if (this.state === "IDLE" && power >= 0.24) this.state = "RISING";
    if (this.state === "RISING") {
      if (power >= 0.48) {
        this.state = "ACTIVE";
        return true;
      }
      if (power < 0.18) this.state = "IDLE";
    } else if (this.state === "ACTIVE" && power < 0.18) {
      this.state = "COOLDOWN";
      this.cooldownAt = timestamp;
    }
    return false;
  }
}

export class LocalJoyConBridgeAdapter implements ControllerAdapter {
  readonly type = "local-joycon2-bridge";
  private source: EventSource | null = null;
  private readonly listeners = new Set<FrameListener>();
  private readonly devicePlayers = new Map<string, PlayerId>();
  private readonly gates = new Map<string, BridgeSwingGate>();
  private readonly frames: Record<PlayerId, ControllerFrame>;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.frames = {
      "player-1": this.emptyFrame("player-1", "left"),
      "player-2": this.emptyFrame("player-2", "right")
    };
  }

  async connect(): Promise<void> {
    if (this.source || typeof EventSource === "undefined") return;
    this.source = new EventSource(`${BRIDGE_ORIGIN}/events`);
    this.source.addEventListener("message", this.handleMessage);
  }

  async disconnect(): Promise<void> {
    this.source?.removeEventListener("message", this.handleMessage);
    this.source?.close();
    this.source = null;
  }

  getDevices(): ControllerDevice[] {
    return (["player-1", "player-2"] as const).map((playerId) => {
      const frame = this.frames[playerId];
      return {
        id: frame.controllerId,
        label: playerId === "player-1" ? "Joy-Con 2 (L)" : "Joy-Con 2 (R)",
        side: frame.side,
        playerId,
        connected: frame.connected
      };
    });
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async waitForDevice(previousCount: number): Promise<ControllerDevice> {
    const existing = this.getDevices().find((device) => device.connected);
    if (previousCount === 0 && existing) return existing;
    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        unsubscribe();
        reject(new Error("Joy-Con 2が見つかりません。SYNCを長押ししてください"));
      }, 12_000);
      const unsubscribe = this.subscribe(() => {
        const connected = this.getDevices().filter((device) => device.connected);
        if (connected.length <= previousCount) return;
        globalThis.clearTimeout(timeout);
        unsubscribe();
        resolve(connected.at(-1)!);
      });
    });
  }

  private readonly handleMessage = (event: MessageEvent<string>): void => {
    let message: BridgeMessage;
    try {
      message = JSON.parse(event.data) as BridgeMessage;
    } catch {
      return;
    }
    if (!message.id || !message.name) return;
    const side = detectJoyCon2Side(message.name);
    const playerId = this.playerFor(message.id, side);
    if (message.type === "connected") {
      const frame = this.frames[playerId];
      frame.connected = true;
      frame.controllerId = message.id;
      frame.side = side === "unknown" ? frame.side : side;
      frame.timestamp = this.now();
      this.emit(playerId);
    } else if (message.type === "disconnected") {
      const frame = this.frames[playerId];
      frame.connected = false;
      frame.buttons = { attack: false, charge: false };
      frame.swing = { active: false, power: 0 };
      frame.timestamp = this.now();
      this.emit(playerId);
    } else if (
      message.type === "input" &&
      message.buttons &&
      message.stick &&
      message.acceleration &&
      message.gyroscope &&
      message.direction &&
      message.motionPower !== undefined
    ) {
      this.receiveInput(message.id, playerId, side, {
        packetId: message.packetId ?? 0,
        buttons: message.buttons,
        stick: message.stick,
        acceleration: message.acceleration,
        gyroscope: message.gyroscope,
        motionPower: message.motionPower,
        direction: message.direction,
        batteryVoltage: message.batteryVoltage ?? 0
      });
    }
  };

  private playerFor(id: string, side: ControllerSide): PlayerId {
    const existing = this.devicePlayers.get(id);
    if (existing) return existing;
    const playerId: PlayerId = side === "right" ? "player-2" : "player-1";
    this.devicePlayers.set(id, playerId);
    return playerId;
  }

  private receiveInput(
    id: string,
    playerId: PlayerId,
    side: ControllerSide,
    report: JoyCon2InputReport
  ): void {
    const timestamp = this.now();
    const gate = this.gates.get(id) ?? new BridgeSwingGate();
    this.gates.set(id, gate);
    const swingStarted = gate.update(report.motionPower, timestamp);
    const frame = this.frames[playerId];
    frame.controllerId = id;
    frame.side = side === "unknown" ? frame.side : side;
    frame.connected = true;
    frame.timestamp = timestamp;
    frame.buttons = report.buttons;
    frame.stick = report.stick;
    frame.acceleration = report.acceleration;
    frame.gyroscope = report.gyroscope;
    frame.swing = {
      active: swingStarted,
      power: swingStarted ? Math.max(0.48, report.motionPower) : 0,
      ...(swingStarted ? { direction: report.direction } : {})
    };
    this.emit(playerId);
  }

  private emptyFrame(playerId: PlayerId, side: ControllerSide): ControllerFrame {
    return {
      controllerId: `joycon2-${side}`,
      playerId,
      side,
      connected: false,
      timestamp: this.now(),
      buttons: { attack: false, charge: false },
      stick: { x: 0, y: 0 },
      swing: { active: false, power: 0 }
    };
  }

  private emit(playerId: PlayerId): void {
    const frame = cloneFrame(this.frames[playerId]);
    this.listeners.forEach((listener) => listener(frame));
  }
}

export class PersistentJoyCon2Adapter implements JoyCon2Adapter {
  readonly type = "persistent-joycon2";
  private readonly local = new LocalJoyConBridgeAdapter();
  private readonly web = new WebBluetoothJoyConAdapter();
  private active: LocalJoyConBridgeAdapter | WebBluetoothJoyConAdapter | null = null;
  private activeUnsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<FrameListener>();

  get connectionMode(): "mac-bridge" | "web-bluetooth" | "selecting" {
    if (this.active === this.local) return "mac-bridge";
    if (this.active === this.web) return "web-bluetooth";
    return "selecting";
  }

  isSupported(): boolean {
    return typeof EventSource !== "undefined" || this.web.isSupported();
  }

  async connect(): Promise<void> {
    if (this.active) return;
    const useLocal = await this.bridgeIsRunning();
    this.active = useLocal ? this.local : this.web;
    this.activeUnsubscribe = this.active.subscribe((frame) => {
      this.listeners.forEach((listener) => listener(frame));
    });
    await this.active.connect();
  }

  async addDevice(): Promise<ControllerDevice> {
    await this.connect();
    if (this.active === this.local) {
      const count = this.local.getDevices().filter((device) => device.connected).length;
      return this.local.waitForDevice(count);
    }
    return this.web.addDevice();
  }

  async disconnect(): Promise<void> {
    this.activeUnsubscribe?.();
    this.activeUnsubscribe = null;
    await this.active?.disconnect();
    this.active = null;
  }

  getDevices(): ControllerDevice[] {
    return this.active?.getDevices() ?? this.local.getDevices();
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async bridgeIsRunning(): Promise<boolean> {
    if (typeof fetch === "undefined" || typeof EventSource === "undefined") return false;
    try {
      const response = await fetch(`${BRIDGE_ORIGIN}/health`, { signal: AbortSignal.timeout(800) });
      return response.ok;
    } catch {
      return false;
    }
  }
}

type KirariRuntime = typeof globalThis & {
  __kirariJoyCon2Adapter?: PersistentJoyCon2Adapter;
};

export function getSharedJoyCon2Adapter(): PersistentJoyCon2Adapter {
  const runtime = globalThis as KirariRuntime;
  if (!(runtime.__kirariJoyCon2Adapter instanceof PersistentJoyCon2Adapter)) {
    runtime.__kirariJoyCon2Adapter = new PersistentJoyCon2Adapter();
  }
  return runtime.__kirariJoyCon2Adapter;
}

export function isJoyCon2Adapter(adapter: ControllerAdapter): adapter is JoyCon2Adapter {
  return (
    adapter instanceof PersistentJoyCon2Adapter || adapter instanceof WebBluetoothJoyConAdapter
  );
}
