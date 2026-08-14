import { Buffer } from "node:buffer";

export function parseAdditionalSensorValues(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 62) {
    throw new Error("Joy-Con 2の入力データが短すぎます");
  }
  const batteryCurrentRaw = bytes.readUInt16LE(0x22);
  return {
    mouse: {
      positionX: bytes.readUInt16LE(0x10),
      positionY: bytes.readUInt16LE(0x12),
      surfaceQuality: bytes.readUInt16LE(0x14),
      liftOffDistance: bytes.readUInt16LE(0x16)
    },
    imuTemperatureRaw: bytes.readInt16LE(0x2e),
    batteryCurrentMilliamps: batteryCurrentRaw > 0 ? batteryCurrentRaw / 100 : null,
    chargeStatus: bytes[0x21]
  };
}
