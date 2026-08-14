/* global console, process */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Buffer } from "node:buffer";
import { parseAdditionalSensorValues } from "./input-sensors.mjs";

const projectDir = dirname(fileURLToPath(import.meta.url));
const nativeBinary = resolve(projectDir, "native/build/joycon2-bridge");
const port = Number(process.env.JOYCON_BRIDGE_PORT ?? 8787);
const clients = new Set();
const latestByDevice = new Map();
let bridgeState = "starting";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeVector(vector) {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  if (magnitude < 0.0001) return { x: 0, y: -1, z: 0 };
  return { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude };
}

function readStick(bytes, offset) {
  const packed = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  return {
    x: clamp(((packed & 0x0fff) - 2047.5) / 2047.5, -1, 1),
    y: -clamp((((packed >> 12) & 0x0fff) - 2047.5) / 2047.5, -1, 1)
  };
}

function buttonMap(raw) {
  return {
    a: Boolean(raw & 0x00000800),
    b: Boolean(raw & 0x00000400),
    x: Boolean(raw & 0x00000200),
    y: Boolean(raw & 0x00000100),
    dpadDown: Boolean(raw & 0x01000000),
    dpadUp: Boolean(raw & 0x02000000),
    dpadRight: Boolean(raw & 0x04000000),
    dpadLeft: Boolean(raw & 0x08000000),
    l: Boolean(raw & 0x40000000),
    zl: Boolean(raw & 0x80000000),
    r: Boolean(raw & 0x00004000),
    zr: Boolean(raw & 0x00008000),
    stickLeft: Boolean(raw & 0x00080000),
    stickRight: Boolean(raw & 0x00040000),
    minus: Boolean(raw & 0x00010000),
    plus: Boolean(raw & 0x00020000),
    capture: Boolean(raw & 0x00200000),
    home: Boolean(raw & 0x00100000),
    chat: Boolean(raw & 0x00400000),
    railLeftSl: Boolean(raw & 0x20000000),
    railLeftSr: Boolean(raw & 0x10000000),
    railRightSl: Boolean(raw & 0x00002000),
    railRightSr: Boolean(raw & 0x00001000)
  };
}

function normalizedInput(payload) {
  const bytes = Buffer.from(payload.hex, "hex");
  if (bytes.length < 62) return null;
  const side = payload.name.toLowerCase().includes("(r)") ? "right" : "left";
  const acceleration = {
    x: bytes.readInt16LE(0x30) / 4096,
    y: bytes.readInt16LE(0x32) / 4096,
    z: bytes.readInt16LE(0x34) / 4096
  };
  const gyroscope = {
    x: bytes.readInt16LE(0x36),
    y: bytes.readInt16LE(0x38),
    z: bytes.readInt16LE(0x3a)
  };
  const accelerationMagnitude = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
  const gyroscopeMagnitude = Math.hypot(gyroscope.x, gyroscope.y, gyroscope.z);
  const motionPower = clamp(
    Math.max(Math.abs(accelerationMagnitude - 1) * 1.4, gyroscopeMagnitude / 1200),
    0,
    1
  );
  const buttons = buttonMap(bytes.readUInt32LE(3));
  const additionalSensors = parseAdditionalSensorValues(bytes);
  return {
    type: "input",
    id: payload.id,
    name: payload.name,
    side,
    receivedAt: Date.now(),
    packetId: bytes[0] | (bytes[1] << 8) | (bytes[2] << 16),
    buttons,
    stick: readStick(bytes, side === "right" ? 0x0d : 0x0a),
    acceleration,
    gyroscope,
    motionPower,
    direction: normalizeVector(gyroscopeMagnitude > 20 ? gyroscope : acceleration),
    batteryVoltage: bytes.readUInt16LE(0x1f) / 1000,
    ...additionalSensors
  };
}

function send(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(payload) {
  if (payload.type === "ready" || payload.type === "scanning" || payload.type === "state") {
    bridgeState = payload.state ?? payload.type;
  }
  if (payload.id && ["connected", "disconnected", "frame", "input"].includes(payload.type)) {
    const previous = latestByDevice.get(payload.id) ?? {};
    latestByDevice.set(payload.id, {
      ...previous,
      connected:
        payload.type === "connected"
          ? true
          : payload.type === "disconnected"
            ? false
            : previous.connected,
      ...(payload.type === "connected" ? { connectedEvent: payload } : { [payload.type]: payload })
    });
  }
  for (const client of clients) send(client, payload);
}

const helper = spawn(nativeBinary, [], { cwd: projectDir, stdio: ["ignore", "pipe", "pipe"] });
createInterface({ input: helper.stdout }).on("line", (line) => {
  try {
    const payload = JSON.parse(line);
    broadcast(payload);
    if (payload.type === "frame") {
      const input = normalizedInput(payload);
      if (input) broadcast(input);
    } else if (payload.type !== "ready" && payload.type !== "scanning") {
      console.log(`[joycon] ${payload.type}: ${payload.name ?? payload.message ?? ""}`);
    }
  } catch {
    console.warn(`[joycon] 読み取れない出力: ${line}`);
  }
});
helper.stderr.on("data", (chunk) => process.stderr.write(`[joycon] ${chunk}`));
helper.on("exit", (code, signal) => {
  broadcast({ type: "error", message: `Mac接続役が終了しました (${signal ?? code})` });
  if (!stopping) process.exitCode = 1;
});

const server = createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/health") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, state: bridgeState, devices: latestByDevice.size }));
    return;
  }
  if (request.url !== "/events") {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write("retry: 1000\n\n");
  clients.add(response);
  for (const cached of latestByDevice.values()) {
    if (cached.connected) {
      if (cached.connectedEvent) send(response, cached.connectedEvent);
      if (cached.frame) send(response, cached.frame);
      if (cached.input) send(response, cached.input);
    } else if (cached.disconnected) {
      send(response, cached.disconnected);
    }
  }
  request.on("close", () => clients.delete(response));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[joycon] Mac接続役: http://127.0.0.1:${port}`);
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const client of clients) client.end();
  clients.clear();
  server.close(() => process.exit(0));
  helper.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
