const MAX_PULSES = 6;
const MAX_TOTAL_MS = 3000;

function exactKeys(value, allowed) {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

export function validateRumbleRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !exactKeys(value, ["pulses", "strength"])) {
    throw new Error("pulsesとstrengthだけを指定してください");
  }
  if (!Number.isInteger(value.strength) || value.strength < 1 || value.strength > 5) {
    throw new Error("strengthは1〜5の整数で指定してください");
  }
  if (!Array.isArray(value.pulses) || value.pulses.length < 1 || value.pulses.length > MAX_PULSES) {
    throw new Error(`pulsesは1〜${MAX_PULSES}件で指定してください`);
  }

  let totalMs = 0;
  const pulses = value.pulses.map((pulse) => {
    if (!pulse || typeof pulse !== "object" || Array.isArray(pulse) ||
        !exactKeys(pulse, ["onMs", "offMs"])) {
      throw new Error("各pulseにはonMsとoffMsだけを指定してください");
    }
    if (!Number.isInteger(pulse.onMs) || pulse.onMs < 40 || pulse.onMs > 500) {
      throw new Error("onMsは40〜500msの整数で指定してください");
    }
    if (!Number.isInteger(pulse.offMs) || pulse.offMs < 0 || pulse.offMs > 500) {
      throw new Error("offMsは0〜500msの整数で指定してください");
    }
    totalMs += pulse.onMs + pulse.offMs;
    return { onMs: pulse.onMs, offMs: pulse.offMs };
  });
  if (totalMs > MAX_TOTAL_MS) throw new Error(`振動時間は合計${MAX_TOTAL_MS}ms以内にしてください`);
  return { pulses, strength: value.strength };
}
