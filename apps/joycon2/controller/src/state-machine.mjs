const ALL_BUTTON_NAMES = [
  "a", "b", "x", "y", "dpadDown", "dpadUp", "dpadRight", "dpadLeft",
  "l", "zl", "r", "zr", "stickLeft", "stickRight", "minus", "plus",
  "capture", "home", "chat", "railLeftSl", "railLeftSr", "railRightSl", "railRightSr"
];

function emptyButtons() {
  return Object.fromEntries(ALL_BUTTON_NAMES.map((name) => [name, false]));
}

function emptySensors() {
  return {
    acceleration: { x: null, y: null, z: null },
    gyroscope: { x: null, y: null, z: null },
    direction: { x: null, y: null, z: null },
    mouse: { positionX: null, positionY: null, surfaceQuality: null, liftOffDistance: null },
    imuTemperatureRaw: null,
    motionPower: null,
    batteryCurrentMilliamps: null,
    chargeStatus: null,
    packetId: null,
    receivedAt: null
  };
}

function finiteVector(value) {
  return {
    x: Number.isFinite(value?.x) ? value.x : null,
    y: Number.isFinite(value?.y) ? value.y : null,
    z: Number.isFinite(value?.z) ? value.z : null
  };
}

function buttonsNeutral(buttons, except = []) {
  const ignored = new Set(except);
  return ALL_BUTTON_NAMES.every((name) => ignored.has(name) || !buttons?.[name]);
}

function buttonNames(value) {
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

function signed16Delta(current, previous) {
  let delta = current - previous;
  if (delta > 32767) delta -= 65536;
  if (delta < -32768) delta += 65536;
  return delta;
}

export class ControllerStateMachine {
  constructor({ config, onAction, onPointerMove, onPointerButton, onState, now = () => Date.now() }) {
    this.config = config;
    this.onAction = onAction ?? (() => {});
    this.onPointerMove = onPointerMove ?? (() => {});
    this.onPointerButton = onPointerButton ?? (() => {});
    this.onState = onState ?? (() => {});
    this.now = now;
    this.state = {
      bridgeConnected: false,
      joyconConnected: false,
      deviceId: null,
      deviceName: null,
      deviceSide: config.deviceSide,
      armed: false,
      neutralReady: false,
      settingsUpdating: false,
      talkActive: false,
      draftArmed: false,
      draftArmedAt: null,
      stick: { x: 0, y: 0 },
      buttons: emptyButtons(),
      sensors: emptySensors(),
      mouseControl: {
        enabled: Boolean(config.mouse?.enabled),
        source: "off",
        onSurface: false,
        clickActive: false
      },
      batteryVoltage: null,
      lastInputAt: null,
      lastAction: null,
      disabledReason: "起動直後"
    };
    this.previousButtons = emptyButtons();
    this.masterHoldStartedAt = null;
    this.masterHoldConsumed = false;
    this.masterTapEligible = false;
    this.stickLatch = null;
    this.talkStartedAt = null;
    this.deleteHoldStartedAt = null;
    this.deleteHoldConsumed = false;
    this.escapeHoldStartedAt = null;
    this.escapeHoldConsumed = false;
    this.reasonRepeat = {
      reasonUp: { nextAt: null },
      reasonDown: { nextAt: null }
    };
    this.mouseOnSurface = false;
    this.mouseSurfaceFrames = 0;
    this.mouseLiftedFrames = 0;
    this.previousMousePosition = null;
    this.filteredMouseDelta = { x: 0, y: 0 };
  }

  snapshot() {
    return structuredClone(this.state);
  }

  setBridgeConnection(connected) {
    this.state.bridgeConnected = connected;
    if (!connected) {
      if (this.state.talkActive) this.#action("talkStop", { reason: "bridge-disconnect" });
      this.state.joyconConnected = false;
      this.state.deviceId = null;
      this.state.deviceName = null;
      this.state.neutralReady = false;
      this.state.sensors = emptySensors();
      this.#resetMouseControl();
      this.state.batteryVoltage = null;
      this.#disable("Bridge切断");
    }
    this.#emit();
  }

  handleBridgeEvent(event) {
    if (event.type === "connected" && this.#sideFromName(event.name) === this.config.deviceSide) {
      this.state.joyconConnected = true;
      this.state.deviceId = event.id;
      this.state.deviceName = event.name;
      this.state.neutralReady = false;
      this.previousButtons = emptyButtons();
      this.#disable("Joy-Con再接続後のニュートラル待ち");
      this.#emit();
      return;
    }
    if (event.type === "disconnected" && event.id === this.state.deviceId) {
      if (this.state.talkActive) this.#action("talkStop", { reason: "disconnect" });
      this.state.joyconConnected = false;
      this.state.neutralReady = false;
      this.state.sensors = emptySensors();
      this.#resetMouseControl();
      this.state.batteryVoltage = null;
      this.#disable("Joy-Con切断");
      this.#emit();
      return;
    }
    if (event.type !== "input" || event.side !== this.config.deviceSide) return;
    this.#handleInput(event);
  }

  armFromUi() {
    if (this.state.settingsUpdating) return { ok: false, message: "設定保存中です" };
    if (!this.state.bridgeConnected) return { ok: false, message: "Bridgeが未接続です" };
    if (!this.state.joyconConnected) return { ok: false, message: "Joy-Conが未接続です" };
    if (!this.state.neutralReady) return { ok: false, message: "全ボタンとStickを一度離してください" };
    this.state.armed = true;
    this.state.disabledReason = null;
    this.state.lastAction = { name: "ARMED_UI", at: this.now() };
    this.#emit();
    return { ok: true };
  }

  disarmFromUi() {
    if (this.state.talkActive) this.#action("talkStop", { reason: "ui-disarm" });
    this.#disable("UIから停止");
    this.#emit();
    return { ok: true };
  }

  beginBindingsUpdate() {
    if (this.state.armed || this.state.talkActive) {
      return { ok: false, message: "DISABLED中だけ設定を保存できます" };
    }
    if (this.state.settingsUpdating) {
      return { ok: false, message: "設定を保存中です" };
    }
    this.state.settingsUpdating = true;
    this.state.neutralReady = false;
    this.#disable("設定保存中");
    this.state.lastAction = { name: "SETTINGS_SAVING", at: this.now() };
    this.#emit();
    return { ok: true };
  }

  applyBindings(bindings) {
    if (!this.state.settingsUpdating) {
      return { ok: false, message: "設定保存が開始されていません" };
    }
    this.config.bindings = { ...bindings, master: "plus" };
    this.state.settingsUpdating = false;
    this.state.neutralReady = false;
    this.previousButtons = emptyButtons();
    this.#disable("設定変更後のニュートラル待ち");
    this.state.lastAction = { name: "BINDINGS_UPDATED", detail: { bindings }, at: this.now() };
    this.#emit();
    return { ok: true };
  }

  applySettings({ bindings, mouse }) {
    if (!this.state.settingsUpdating) {
      return { ok: false, message: "設定保存が開始されていません" };
    }
    this.config.bindings = { ...bindings, master: "plus" };
    this.config.mouse = { ...this.config.mouse, ...mouse };
    this.state.mouseControl.enabled = Boolean(this.config.mouse.enabled);
    this.state.settingsUpdating = false;
    this.state.neutralReady = false;
    this.previousButtons = emptyButtons();
    this.#resetMouseControl();
    this.#disable("設定変更後のニュートラル待ち");
    this.state.lastAction = { name: "SETTINGS_UPDATED", detail: { bindings, mouse }, at: this.now() };
    this.#emit();
    return { ok: true };
  }

  cancelBindingsUpdate(message) {
    this.state.settingsUpdating = false;
    this.state.neutralReady = false;
    this.previousButtons = emptyButtons();
    this.#disable(`設定保存失敗: ${message}`);
    this.state.lastAction = { name: "SETTINGS_SAVE_FAILED", detail: { message }, at: this.now() };
    this.#emit();
  }

  handleActionFailure(actionName, message) {
    const now = this.now();
    if (actionName === "send" || actionName === "clear") {
      this.state.draftArmed = true;
      this.state.draftArmedAt = now;
    } else if (actionName === "talkStart") {
      this.state.talkActive = false;
      this.talkStartedAt = null;
    } else if (actionName === "talkStop") {
      this.#disable(`音声操作失敗: ${message}`);
    }
    this.state.lastAction = { name: "ACTION_FAILED", detail: { actionName, message }, at: now };
    this.#emit();
  }

  tick() {
    const now = this.now();
    if (this.state.draftArmedAt && now - this.state.draftArmedAt > this.config.draftExpiryMs) {
      this.state.draftArmed = false;
      this.state.draftArmedAt = null;
      this.state.lastAction = { name: "DRAFT_EXPIRED", at: now };
      this.#emit();
    }
    if (
      this.state.armed &&
      this.state.lastInputAt &&
      now - this.state.lastInputAt > this.config.watchdogMs
    ) {
      if (this.state.talkActive) this.#action("talkStop", { reason: "watchdog" });
      this.#disable("入力Watchdog発火");
      this.state.neutralReady = false;
      this.#emit();
    }
  }

  #handleInput(event) {
    const now = this.now();
    this.state.joyconConnected = true;
    this.state.deviceId = event.id;
    this.state.deviceName = event.name;
    this.state.lastInputAt = now;
    this.state.stick = {
      x: Number(event.stick?.x ?? 0),
      y: Number(event.stick?.y ?? 0)
    };
    this.state.buttons = { ...emptyButtons(), ...(event.buttons ?? {}) };
    this.state.sensors = {
      acceleration: finiteVector(event.acceleration),
      gyroscope: finiteVector(event.gyroscope),
      direction: finiteVector(event.direction),
      mouse: {
        positionX: Number.isFinite(event.mouse?.positionX) ? event.mouse.positionX : null,
        positionY: Number.isFinite(event.mouse?.positionY) ? event.mouse.positionY : null,
        surfaceQuality: Number.isFinite(event.mouse?.surfaceQuality) ? event.mouse.surfaceQuality : null,
        liftOffDistance: Number.isFinite(event.mouse?.liftOffDistance) ? event.mouse.liftOffDistance : null
      },
      imuTemperatureRaw: Number.isFinite(event.imuTemperatureRaw) ? event.imuTemperatureRaw : null,
      motionPower: Number.isFinite(event.motionPower) ? event.motionPower : null,
      batteryCurrentMilliamps: Number.isFinite(event.batteryCurrentMilliamps) ? event.batteryCurrentMilliamps : null,
      chargeStatus: Number.isInteger(event.chargeStatus) ? event.chargeStatus : null,
      packetId: Number.isInteger(event.packetId) ? event.packetId : null,
      receivedAt: Number.isFinite(event.receivedAt) ? event.receivedAt : now
    };
    this.state.batteryVoltage = Number.isFinite(event.batteryVoltage) ? event.batteryVoltage : null;
    this.#updateMouseSurface();

    const stickNeutral = Math.abs(this.state.stick.x) <= this.config.stickRelease &&
      Math.abs(this.state.stick.y) <= this.config.stickRelease;
    if (!this.state.settingsUpdating && !this.state.neutralReady && buttonsNeutral(this.state.buttons) && stickNeutral) {
      this.state.neutralReady = true;
      this.state.disabledReason = this.state.armed ? null : "＋長押しで有効化";
    }

    this.#handleMasterHold(now, stickNeutral);

    if (this.state.armed && this.state.neutralReady) {
      this.#handleMappedButtons(now);
      if (this.config.mouse?.enabled) this.#handlePointer();
      else this.#handleStick();
    }

    this.previousButtons = { ...this.state.buttons };
    this.#emit();
  }

  #handleMasterHold(now, stickNeutral) {
    if (this.state.settingsUpdating) return;
    const master = this.config.bindings.master;
    const pressed = Boolean(this.state.buttons[master]);
    const otherButtonsNeutral = buttonsNeutral(this.state.buttons, [master]);
    if (pressed && this.state.neutralReady && otherButtonsNeutral && stickNeutral) {
      if (this.masterHoldStartedAt === null) {
        this.masterHoldStartedAt = now;
        this.masterTapEligible = this.state.armed;
      }
      if (!this.masterHoldConsumed && now - this.masterHoldStartedAt >= this.config.masterHoldMs) {
        this.masterHoldConsumed = true;
        if (this.state.armed) {
          if (this.state.talkActive) this.#action("talkStop", { reason: "master-disable" });
          this.#disable("＋長押しで停止", { preserveMasterHold: true });
          this.masterHoldConsumed = true;
          this.state.lastAction = { name: "DISARMED", at: now };
        } else {
          this.state.armed = true;
          this.state.disabledReason = null;
          this.state.lastAction = { name: "ARMED", at: now };
        }
      }
    } else if (!pressed) {
      if (
        this.masterHoldStartedAt !== null &&
        !this.masterHoldConsumed &&
        this.masterTapEligible &&
        this.state.armed &&
        buttonNames(this.config.bindings.voiceChat).includes(master)
      ) {
        this.#action("voiceChat");
      }
      this.masterHoldStartedAt = null;
      this.masterHoldConsumed = false;
      this.masterTapEligible = false;
    } else {
      this.masterHoldStartedAt = null;
      this.masterTapEligible = false;
    }
  }

  #handleMappedButtons(now) {
    const bindings = this.config.bindings;
    const pressed = (names, buttons) => buttonNames(names).some((name) => Boolean(buttons[name]));
    const rising = (names) => pressed(names, this.state.buttons) && !pressed(names, this.previousButtons);
    const falling = (names) => !pressed(names, this.state.buttons) && pressed(names, this.previousButtons);
    const voiceChatButtons = buttonNames(bindings.voiceChat).filter((name) => name !== bindings.master);
    const mouseClickButtons = buttonNames(bindings.mouseClick);
    const contextPrimaryButtons = buttonNames(bindings.contextPrimary);
    const regularClickHeld = (name, buttons) => Boolean(buttons[name]);
    const contextClickHeld = (name, buttons) => Boolean(buttons[name]) &&
      this.state.mouseControl.source === "sensor";
    const mouseClickRising = mouseClickButtons.some((name) =>
      regularClickHeld(name, this.state.buttons) && !this.previousButtons[name]
    ) || contextPrimaryButtons.some((name) =>
      contextClickHeld(name, this.state.buttons) && !this.previousButtons[name]
    );
    const mouseClickHeld = mouseClickButtons.some((name) => regularClickHeld(name, this.state.buttons)) ||
      contextPrimaryButtons.some((name) => contextClickHeld(name, this.state.buttons));

    if (this.config.mouse?.enabled && mouseClickRising && !this.state.mouseControl.clickActive) {
      this.state.mouseControl.clickActive = true;
      this.onPointerButton({ down: true, button: "left" });
    }
    if ((!this.config.mouse?.enabled || !mouseClickHeld) && this.state.mouseControl.clickActive) {
      this.#releaseMouseClick();
    }
    if (rising(bindings.contextPrimary) && this.state.mouseControl.source !== "sensor") {
      this.#action("focusComposer");
    }

    if (rising(bindings.cancel)) {
      this.deleteHoldStartedAt = now;
      this.deleteHoldConsumed = false;
      if (this.state.talkActive) {
        this.state.talkActive = false;
        this.talkStartedAt = null;
        this.state.draftArmed = true;
        this.state.draftArmedAt = now;
        this.#action("talkStop", { reason: "delete-button" });
      }
      return;
    }

    if (
      pressed(bindings.cancel, this.state.buttons) &&
      !this.deleteHoldConsumed &&
      this.deleteHoldStartedAt !== null &&
      now - this.deleteHoldStartedAt >= this.config.deleteHoldMs
    ) {
      this.deleteHoldConsumed = true;
      this.state.draftArmed = false;
      this.state.draftArmedAt = null;
      this.#action("clear");
      return;
    }

    if (falling(bindings.cancel)) {
      if (!this.deleteHoldConsumed && this.deleteHoldStartedAt !== null) {
        this.#action("deleteBackward");
      }
      this.deleteHoldStartedAt = null;
      this.deleteHoldConsumed = false;
      return;
    }

    if (rising(bindings.talk) && !this.state.talkActive) {
      this.state.talkActive = true;
      this.talkStartedAt = now;
      this.state.draftArmed = false;
      this.state.draftArmedAt = null;
      this.#action("talkStart");
    }
    if (falling(bindings.talk) && this.state.talkActive) {
      const elapsed = now - (this.talkStartedAt ?? now);
      const delayMs = Math.max(0, this.config.minimumTalkMs - elapsed);
      this.state.talkActive = false;
      this.talkStartedAt = null;
      this.state.draftArmed = true;
      this.state.draftArmedAt = now + delayMs;
      this.#action("talkStop", { delayMs });
    }

    if (rising(bindings.escape) && !this.state.talkActive) {
      this.escapeHoldStartedAt = now;
      this.escapeHoldConsumed = false;
    }
    if (
      pressed(bindings.escape, this.state.buttons) &&
      !this.state.talkActive &&
      !this.escapeHoldConsumed &&
      this.escapeHoldStartedAt !== null &&
      now - this.escapeHoldStartedAt >= this.config.escapeHoldMs
    ) {
      this.escapeHoldConsumed = true;
      this.#action("scrollLatest");
    }
    if (falling(bindings.escape)) {
      if (!this.escapeHoldConsumed && this.escapeHoldStartedAt !== null && !this.state.talkActive) {
        this.#action("escape");
      }
      this.escapeHoldStartedAt = null;
      this.escapeHoldConsumed = false;
    }

    if (rising(bindings.action) && !this.state.talkActive) {
      const draftReady = this.state.draftArmed && now >= (this.state.draftArmedAt ?? 0);
      if (!this.config.actionRequiresDraft || draftReady) {
        this.state.draftArmed = false;
        this.state.draftArmedAt = null;
        this.#action("send");
      } else {
        this.#action("blocked", { reason: "送信可能な音声入力がありません" });
      }
    }
    if (rising(bindings.newChat) && !this.state.talkActive) {
      this.#clearDraft();
      this.#action("newChat");
    }
    if (rising(bindings.focus)) {
      this.#action("focus");
    }
    if (rising(voiceChatButtons) && !this.state.talkActive) {
      this.#action("voiceChat");
    }
    if (rising(bindings.taskUp) && !this.state.talkActive) {
      this.#clearDraft();
      this.#action("taskUp");
    }
    if (rising(bindings.taskDown) && !this.state.talkActive) {
      this.#clearDraft();
      this.#action("taskDown");
    }
    this.#handleReasonRepeat("reasonUp", bindings.reasonUp, now, { pressed, rising, falling });
    this.#handleReasonRepeat("reasonDown", bindings.reasonDown, now, { pressed, rising, falling });
  }

  #handleReasonRepeat(actionName, buttonBinding, now, helpers) {
    const tracker = this.reasonRepeat[actionName];
    const isPressed = helpers.pressed(buttonBinding, this.state.buttons);
    if (this.state.talkActive || helpers.falling(buttonBinding) || !isPressed) {
      tracker.nextAt = null;
      return;
    }
    if (helpers.rising(buttonBinding)) {
      tracker.nextAt = now + this.config.reasonRepeatDelayMs;
      this.#action(actionName);
      return;
    }
    if (tracker.nextAt !== null && now >= tracker.nextAt) {
      tracker.nextAt = now + this.config.reasonRepeatIntervalMs;
      this.#action(actionName);
    }
  }

  #handleStick() {
    if (this.state.talkActive) return;
    const x = this.state.stick.x;
    if (this.stickLatch === null) {
      if (x >= this.config.stickTrigger) {
        this.stickLatch = "right";
        this.#clearDraft();
        this.#action("nextChat");
      } else if (x <= -this.config.stickTrigger) {
        this.stickLatch = "left";
        this.#clearDraft();
        this.#action("previousChat");
      }
    } else if (Math.abs(x) <= this.config.stickRelease) {
      this.stickLatch = null;
    }
  }

  #updateMouseSurface() {
    const distance = this.state.sensors.mouse.liftOffDistance;
    const maximum = this.config.mouse?.surfaceDistanceMax ?? 500;
    const release = this.config.mouse?.surfaceReleaseDistance ?? 650;
    const surfaceCandidate = Number.isFinite(distance) && distance <= maximum;
    const liftedCandidate = !Number.isFinite(distance) || distance >= release;

    if (surfaceCandidate) {
      this.mouseSurfaceFrames += 1;
      this.mouseLiftedFrames = 0;
      if (!this.mouseOnSurface && this.mouseSurfaceFrames >= 2) {
        this.mouseOnSurface = true;
        this.previousMousePosition = null;
        this.filteredMouseDelta = { x: 0, y: 0 };
      }
    } else if (liftedCandidate) {
      this.mouseLiftedFrames += 1;
      this.mouseSurfaceFrames = 0;
      if (this.mouseOnSurface && this.mouseLiftedFrames >= 2) {
        this.mouseOnSurface = false;
        this.previousMousePosition = null;
        this.filteredMouseDelta = { x: 0, y: 0 };
      }
    }

    this.state.mouseControl.enabled = Boolean(this.config.mouse?.enabled);
    this.state.mouseControl.onSurface = this.mouseOnSurface;
    this.state.mouseControl.source = !this.config.mouse?.enabled
      ? "off"
      : this.mouseOnSurface ? "sensor" : "stick";
  }

  #handlePointer() {
    if (this.mouseOnSurface) {
      this.stickLatch = null;
      this.#handleSensorPointer();
      return;
    }
    if (this.mouseSurfaceFrames > 0) {
      this.previousMousePosition = null;
      return;
    }
    this.previousMousePosition = null;
    this.filteredMouseDelta = { x: 0, y: 0 };
    this.#handleStickPointer();
  }

  #handleSensorPointer() {
    const mouse = this.state.sensors.mouse;
    if (!Number.isInteger(mouse.positionX) || !Number.isInteger(mouse.positionY)) {
      this.previousMousePosition = null;
      return;
    }
    if (!this.previousMousePosition) {
      this.previousMousePosition = { x: mouse.positionX, y: mouse.positionY };
      return;
    }

    let dx = signed16Delta(mouse.positionX, this.previousMousePosition.x);
    let dy = signed16Delta(mouse.positionY, this.previousMousePosition.y);
    this.previousMousePosition = { x: mouse.positionX, y: mouse.positionY };
    const deadzone = this.config.mouse?.sensorDeadzone ?? 2;
    const jump = this.config.mouse?.sensorJumpThreshold ?? 1200;
    if (Math.abs(dx) > jump || Math.abs(dy) > jump) {
      this.filteredMouseDelta = { x: 0, y: 0 };
      return;
    }
    if (Math.abs(dx) <= deadzone) dx = 0;
    if (Math.abs(dy) <= deadzone) dy = 0;
    if (dx === 0 && dy === 0) return;

    const sensitivity = this.config.mouse?.sensorSensitivity ?? 0.2;
    const smoothing = this.config.mouse?.sensorSmoothing ?? 0.35;
    this.filteredMouseDelta.x = smoothing * dx * sensitivity + (1 - smoothing) * this.filteredMouseDelta.x;
    this.filteredMouseDelta.y = smoothing * dy * sensitivity + (1 - smoothing) * this.filteredMouseDelta.y;
    this.onPointerMove({
      dx: this.filteredMouseDelta.x,
      dy: this.filteredMouseDelta.y,
      source: "sensor"
    });
  }

  #handleStickPointer() {
    const deadzone = this.config.mouse?.stickDeadzone ?? 0.2;
    const speed = this.config.mouse?.stickSpeed ?? 18;
    const curve = (value) => {
      const magnitude = Math.abs(value);
      if (magnitude <= deadzone) return 0;
      const normalized = (magnitude - deadzone) / (1 - deadzone);
      return Math.sign(value) * normalized * normalized * speed;
    };
    const dx = curve(this.state.stick.x);
    const dy = curve(this.state.stick.y);
    if (dx !== 0 || dy !== 0) this.onPointerMove({ dx, dy, source: "stick" });
  }

  #resetMouseControl() {
    this.mouseOnSurface = false;
    this.mouseSurfaceFrames = 0;
    this.mouseLiftedFrames = 0;
    this.previousMousePosition = null;
    this.filteredMouseDelta = { x: 0, y: 0 };
    this.state.mouseControl.onSurface = false;
    this.state.mouseControl.source = this.config.mouse?.enabled ? "stick" : "off";
  }

  #releaseMouseClick() {
    if (!this.state.mouseControl.clickActive) return;
    this.state.mouseControl.clickActive = false;
    this.onPointerButton({ down: false, button: "left" });
  }

  #clearDraft() {
    this.state.draftArmed = false;
    this.state.draftArmedAt = null;
  }

  #disable(reason, { preserveMasterHold = false } = {}) {
    this.#releaseMouseClick();
    this.state.armed = false;
    this.state.talkActive = false;
    this.#clearDraft();
    this.state.disabledReason = reason;
    this.stickLatch = null;
    this.deleteHoldStartedAt = null;
    this.deleteHoldConsumed = false;
    this.escapeHoldStartedAt = null;
    this.escapeHoldConsumed = false;
    this.reasonRepeat.reasonUp.nextAt = null;
    this.reasonRepeat.reasonDown.nextAt = null;
    this.previousMousePosition = null;
    this.filteredMouseDelta = { x: 0, y: 0 };
    if (!preserveMasterHold) {
      this.masterHoldStartedAt = null;
      this.masterHoldConsumed = false;
      this.masterTapEligible = false;
    }
  }

  #action(name, detail = {}) {
    const at = this.now();
    this.state.lastAction = { name, detail, at };
    this.onAction({ name, detail, at });
  }

  #emit() {
    this.onState(this.snapshot());
  }

  #sideFromName(name = "") {
    const lower = name.toLowerCase();
    if (lower.includes("(r)")) return "right";
    if (lower.includes("(l)")) return "left";
    return "unknown";
  }
}
