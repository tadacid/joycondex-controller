export class BatteryMonitor {
  constructor({ lowVoltage = 3.55, recoveryVoltage = 3.7, onWarning } = {}) {
    this.lowVoltage = lowVoltage;
    this.recoveryVoltage = recoveryVoltage;
    this.onWarning = onWarning ?? (() => {});
    this.low = false;
    this.warningAt = null;
    this.voltage = null;
  }

  update({ connected, voltage }) {
    this.voltage = Number.isFinite(voltage) ? voltage : null;
    if (!connected || this.voltage === null) {
      this.low = false;
      return;
    }
    if (this.low) {
      if (this.voltage >= this.recoveryVoltage) this.low = false;
      return;
    }
    if (this.voltage > this.lowVoltage) return;

    this.low = true;
    this.warningAt = Date.now();
    Promise.resolve(this.onWarning({ voltage: this.voltage, warningAt: this.warningAt })).catch(() => {});
  }

  snapshot() {
    return {
      low: this.low,
      voltage: this.voltage,
      lowVoltage: this.lowVoltage,
      warningAt: this.warningAt
    };
  }
}
