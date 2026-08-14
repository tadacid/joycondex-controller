import test from "node:test";
import assert from "node:assert/strict";
import { ControllerStateMachine } from "../src/state-machine.mjs";

function setup() {
  let now = 1000;
  const actions = [];
  const pointerMoves = [];
  const pointerButtons = [];
  const config = {
    deviceSide: "right",
    masterHoldMs: 800,
    watchdogMs: 2200,
    stickTrigger: 0.68,
    stickRelease: 0.34,
    minimumTalkMs: 250,
    deleteHoldMs: 700,
    escapeHoldMs: 700,
    reasonRepeatDelayMs: 420,
    reasonRepeatIntervalMs: 180,
    draftExpiryMs: 30_000,
    actionRequiresDraft: true,
    mouse: {
      enabled:false, surfaceDistanceMax:500, surfaceReleaseDistance:650,
      sensorSensitivity:0.2, sensorSmoothing:0.35, sensorDeadzone:2,
      sensorJumpThreshold:1200, stickDeadzone:0.2, stickSpeed:18
    },
    bindings: {
      talk:["zr"], voiceChat:["plus"], action:["a"], cancel:["b"], newChat:["y"], focus:[], escape:["x"],
      taskUp:[], taskDown:[], reasonUp:[], reasonDown:[], contextPrimary:[], mouseClick:[], master:"plus"
    }
  };
  const machine = new ControllerStateMachine({
    config,
    onAction: action => actions.push(action),
    onPointerMove: move => pointerMoves.push(move),
    onPointerButton: event => pointerButtons.push(event),
    now: () => now
  });
  const buttons = {};
  const input = (patch = {}, stick = { x:0, y:0 }, extra = {}) => machine.handleBridgeEvent({
    type:"input", id:"R1", name:"Joy-Con 2 (R)", side:"right", buttons:{ ...buttons, ...patch }, stick, batteryVoltage:4.0, ...extra
  });
  const setNow = value => { now = value; };
  return { machine, actions, pointerMoves, pointerButtons, input, setNow, buttons };
}

function connectAndNeutral(ctx) {
  ctx.machine.handleBridgeEvent({ type:"connected", id:"R1", name:"Joy-Con 2 (R)" });
  ctx.input();
  assert.equal(ctx.machine.snapshot().neutralReady, true);
}

function arm(ctx) {
  ctx.input({ plus:true });
  ctx.setNow(1900);
  ctx.input({ plus:true });
  assert.equal(ctx.machine.snapshot().armed, true);
  ctx.input({ plus:false });
}

test("再接続直後はニュートラル入力まで操作を受け付けない", () => {
  const ctx = setup();
  ctx.machine.handleBridgeEvent({ type:"connected", id:"R1", name:"Joy-Con 2 (R)" });
  ctx.input({ a:true });
  assert.equal(ctx.machine.snapshot().neutralReady, false);
  assert.equal(ctx.actions.length, 0);
  ctx.input();
  assert.equal(ctx.machine.snapshot().neutralReady, true);
});

test("Bridgeの全センサー値を状態へ保持し、切断時に消去する", () => {
  const ctx = setup();
  ctx.machine.setBridgeConnection(true);
  ctx.machine.handleBridgeEvent({ type:"connected", id:"R1", name:"Joy-Con 2 (R)" });
  ctx.machine.handleBridgeEvent({
    type:"input", id:"R1", name:"Joy-Con 2 (R)", side:"right", buttons:{}, stick:{ x:0.1, y:-0.2 },
    acceleration:{ x:0.1, y:0.2, z:0.9 }, gyroscope:{ x:12, y:-34, z:56 },
    direction:{ x:0.2, y:-0.3, z:0.93 }, mouse:{ positionX:100, positionY:200, surfaceQuality:30, liftOffDistance:4 },
    imuTemperatureRaw:321, motionPower:0.42, batteryVoltage:4.05, batteryCurrentMilliamps:1.25, chargeStatus:2,
    packetId:1234, receivedAt:999
  });
  const state = ctx.machine.snapshot();
  assert.deepEqual(state.sensors.acceleration, { x:0.1, y:0.2, z:0.9 });
  assert.deepEqual(state.sensors.gyroscope, { x:12, y:-34, z:56 });
  assert.deepEqual(state.sensors.direction, { x:0.2, y:-0.3, z:0.93 });
  assert.deepEqual(state.sensors.mouse, { positionX:100, positionY:200, surfaceQuality:30, liftOffDistance:4 });
  assert.equal(state.sensors.imuTemperatureRaw, 321);
  assert.equal(state.sensors.motionPower, 0.42);
  assert.equal(state.sensors.batteryCurrentMilliamps, 1.25);
  assert.equal(state.sensors.chargeStatus, 2);
  assert.equal(state.sensors.packetId, 1234);
  assert.equal(state.sensors.receivedAt, 999);
  assert.equal(state.batteryVoltage, 4.05);
  ctx.machine.setBridgeConnection(false);
  assert.equal(ctx.machine.snapshot().sensors.motionPower, null);
  assert.equal(ctx.machine.snapshot().batteryVoltage, null);
});

test("＋長押しでARMEDになり、長押し連打しない", () => {
  const ctx = setup();
  connectAndNeutral(ctx);
  ctx.input({ plus:true });
  ctx.setNow(1801);
  ctx.input({ plus:true });
  assert.equal(ctx.machine.snapshot().armed, true);
  ctx.setNow(3000);
  ctx.input({ plus:true });
  assert.equal(ctx.machine.snapshot().armed, true);
  ctx.input({ plus:false });
});

test("＋短押しはボイスモード、長押しは従来どおりMASTER", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ plus:true });
  ctx.setNow(2200); ctx.input({ plus:false });
  assert.deepEqual(ctx.actions.map((action) => action.name), ["voiceChat"]);

  ctx.setNow(3000); ctx.input({ plus:true });
  ctx.setNow(3900); ctx.input({ plus:true });
  ctx.input({ plus:false });
  assert.equal(ctx.machine.snapshot().armed, false);
  assert.deepEqual(ctx.actions.map((action) => action.name), ["voiceChat"]);
});

test("ZR押下と解放でTALK開始・終了し、Aで一度だけ送信", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ zr:true });
  ctx.setNow(2600); ctx.input({ zr:false });
  ctx.input({ a:true });
  ctx.input({ a:true });
  assert.deepEqual(ctx.actions.map(a => a.name), ["talkStart", "talkStop", "send"]);
});

test("複数のTALKボタンは最初の押下で開始し最後の解放で停止する", () => {
  const ctx = setup();
  ctx.machine.config.bindings.talk = ["zr", "railRightSl"];
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ zr:true });
  ctx.setNow(2100); ctx.input({ zr:true, railRightSl:true });
  ctx.setNow(2300); ctx.input({ zr:false, railRightSl:true });
  ctx.setNow(2600); ctx.input({ zr:false, railRightSl:false });
  assert.deepEqual(ctx.actions.map(a => a.name), ["talkStart", "talkStop"]);
});

test("Bは音声入力後も通常時もDELETEを1回だけ送る", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ zr:true });
  ctx.setNow(2400); ctx.input({ zr:false });
  ctx.input({ b:true });
  ctx.input({ b:false });
  ctx.input({ b:true });
  ctx.input({ b:false });
  assert.deepEqual(ctx.actions.map(a => a.name), ["talkStart", "talkStop", "deleteBackward", "deleteBackward"]);
});

test("音声入力中のBは録音停止後にDELETEを1回送る", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ zr:true });
  ctx.setNow(2300); ctx.input({ zr:false, b:true });
  ctx.setNow(2400); ctx.input({ b:false });
  assert.deepEqual(ctx.actions.map(a => a.name), ["talkStart", "talkStop", "deleteBackward"]);
});

test("B長押しは全文削除を1回だけ送り、解放時に1文字削除しない", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ b:true });
  ctx.setNow(2701); ctx.input({ b:true });
  ctx.setNow(3500); ctx.input({ b:true });
  ctx.input({ b:false });
  assert.deepEqual(ctx.actions.map(a => a.name), ["clear"]);
});

test("X短押しはEscape、長押しは最新メッセージへ移動する", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);

  ctx.setNow(2000); ctx.input({ x:true });
  ctx.setNow(2300); ctx.input({ x:false });
  ctx.setNow(3000); ctx.input({ x:true });
  ctx.setNow(3699); ctx.input({ x:true });
  ctx.setNow(3700); ctx.input({ x:true });
  ctx.setNow(3800); ctx.input({ x:false });

  assert.deepEqual(ctx.actions.map((action) => action.name), ["escape", "scrollLatest"]);
});

test("Stickは閾値を超えても中央へ戻るまで一度しか発火しない", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.input({}, { x:0.8, y:0 });
  ctx.input({}, { x:0.9, y:0 });
  ctx.input({}, { x:0.1, y:0 });
  ctx.input({}, { x:0.8, y:0 });
  assert.deepEqual(ctx.actions.map(a => a.name), ["nextChat", "nextChat"]);
});

test("机上では光学センサーで動き、Stick入力を混ぜない", () => {
  const ctx = setup();
  ctx.machine.config.mouse.enabled = true;
  connectAndNeutral(ctx); arm(ctx);
  const sensor = (x, y, distance = 120, stick = { x:0.9, y:0 }) =>
    ctx.input({}, stick, { mouse:{ positionX:x, positionY:y, surfaceQuality:2000, liftOffDistance:distance } });
  sensor(1000, 2000);
  sensor(1010, 2010);
  sensor(1030, 2020);
  assert.equal(ctx.machine.snapshot().mouseControl.source, "sensor");
  assert.equal(ctx.actions.length, 0);
  assert.equal(ctx.pointerMoves.length, 1);
  assert.equal(ctx.pointerMoves[0].source, "sensor");
  assert.ok(ctx.pointerMoves[0].dx > 0);
});

test("持ち上げるとStickでカーソルを動かし、センサー移動を止める", () => {
  const ctx = setup();
  ctx.machine.config.mouse.enabled = true;
  connectAndNeutral(ctx); arm(ctx);
  const mouse = (distance) => ({ mouse:{ positionX:1000, positionY:2000, surfaceQuality:0, liftOffDistance:distance } });
  ctx.input({}, { x:0.8, y:-0.7 }, mouse(900));
  ctx.input({}, { x:0.8, y:-0.7 }, mouse(900));
  assert.equal(ctx.machine.snapshot().mouseControl.source, "stick");
  assert.equal(ctx.pointerMoves.length, 2);
  assert.ok(ctx.pointerMoves.every((move) => move.source === "stick"));
  assert.ok(ctx.pointerMoves.at(-1).dx > 0);
  assert.ok(ctx.pointerMoves.at(-1).dy < 0);
});

test("マウスOFFまたはDISABLED中はカーソルを動かさない", () => {
  const ctx = setup();
  connectAndNeutral(ctx);
  ctx.input({}, { x:1, y:0 }, { mouse:{ positionX:10, positionY:20, liftOffDistance:900 } });
  assert.equal(ctx.pointerMoves.length, 0);
  ctx.machine.config.mouse.enabled = true;
  ctx.input({}, { x:1, y:0 }, { mouse:{ positionX:10, positionY:20, liftOffDistance:900 } });
  assert.equal(ctx.pointerMoves.length, 0);
});

test("HOMEで上、Cで下のタスクを1つずつ選ぶ", () => {
  const ctx = setup();
  ctx.machine.config.bindings.taskUp = ["home"];
  ctx.machine.config.bindings.taskDown = ["chat"];
  connectAndNeutral(ctx); arm(ctx);
  ctx.input({ home:true }); ctx.input({ home:false });
  ctx.input({ chat:true }); ctx.input({ chat:false });
  assert.deepEqual(ctx.actions.map((action) => action.name), ["taskUp", "taskDown"]);
});

test("タスク移動はその場で確定し、続くAは通常どおり送信する", () => {
  const ctx = setup();
  ctx.machine.config.actionRequiresDraft = false;
  ctx.machine.config.bindings.taskUp = ["home"];
  connectAndNeutral(ctx); arm(ctx);

  ctx.input({ home:true }); ctx.input({ home:false });
  ctx.input({ a:true }); ctx.input({ a:false });
  ctx.input({ a:true }); ctx.input({ a:false });

  assert.deepEqual(ctx.actions.map((action) => action.name), ["taskUp", "send", "send"]);
});

test("SR/SLの連打は押した回数分だけ推論レベルを動かす", () => {
  const ctx = setup();
  ctx.machine.config.bindings.reasonUp = ["railRightSr"];
  ctx.machine.config.bindings.reasonDown = ["railRightSl"];
  connectAndNeutral(ctx); arm(ctx);

  ctx.input({ railRightSr:true }); ctx.input({ railRightSr:false });
  ctx.input({ railRightSr:true }); ctx.input({ railRightSr:false });
  ctx.input({ railRightSl:true }); ctx.input({ railRightSl:false });
  ctx.input({ railRightSl:true }); ctx.input({ railRightSl:false });

  assert.deepEqual(ctx.actions.map((action) => action.name), ["reasonUp", "reasonUp", "reasonDown", "reasonDown"]);
});

test("SR/SLの長押しは待ち時間後に一定間隔で繰り返す", () => {
  const ctx = setup();
  ctx.machine.config.bindings.reasonUp = ["railRightSr"];
  ctx.machine.config.bindings.reasonDown = ["railRightSl"];
  connectAndNeutral(ctx); arm(ctx);

  ctx.input({ railRightSr:true });
  ctx.setNow(2319); ctx.input({ railRightSr:true });
  ctx.setNow(2320); ctx.input({ railRightSr:true });
  ctx.setNow(2499); ctx.input({ railRightSr:true });
  ctx.setNow(2500); ctx.input({ railRightSr:true });
  ctx.input({ railRightSr:false });

  assert.deepEqual(ctx.actions.map((action) => action.name), ["reasonUp", "reasonUp", "reasonUp"]);
});

test("ZRは机上で左クリック、持ち上げ中は入力欄切替、Stick押込は常にクリックする", () => {
  const ctx = setup();
  ctx.machine.config.mouse.enabled = true;
  ctx.machine.config.bindings.talk = [];
  ctx.machine.config.bindings.contextPrimary = ["zr"];
  ctx.machine.config.bindings.mouseClick = ["stickRight"];
  connectAndNeutral(ctx); arm(ctx);
  const mouse = (distance) => ({ mouse:{ positionX:1000, positionY:2000, surfaceQuality:2000, liftOffDistance:distance } });

  ctx.input({}, { x:0, y:0 }, mouse(120));
  ctx.input({}, { x:0, y:0 }, mouse(120));
  assert.equal(ctx.machine.snapshot().mouseControl.source, "sensor");
  ctx.input({ zr:true }, { x:0, y:0 }, mouse(120));

  ctx.input({ zr:true }, { x:0, y:0 }, mouse(900));
  ctx.input({ zr:true }, { x:0, y:0 }, mouse(900));
  assert.equal(ctx.machine.snapshot().mouseControl.source, "stick");
  ctx.input({ zr:false }, { x:0, y:0 }, mouse(900));
  ctx.input({ zr:true }, { x:0, y:0 }, mouse(900));
  ctx.input({ zr:false }, { x:0, y:0 }, mouse(900));

  ctx.input({ stickRight:true }, { x:0, y:0 }, mouse(900));
  ctx.input({ stickRight:false }, { x:0, y:0 }, mouse(900));
  assert.deepEqual(ctx.pointerButtons, [
    { down:true, button:"left" },
    { down:false, button:"left" },
    { down:true, button:"left" },
    { down:false, button:"left" }
  ]);
  assert.deepEqual(ctx.actions.map((action) => action.name), ["focusComposer"]);
});

test("クリック保持中のDISARMは必ずマウスボタンを解放する", () => {
  const ctx = setup();
  ctx.machine.config.mouse.enabled = true;
  ctx.machine.config.bindings.talk = [];
  ctx.machine.config.bindings.contextPrimary = ["zr"];
  ctx.machine.config.bindings.mouseClick = [];
  connectAndNeutral(ctx); arm(ctx);
  const sensor = { mouse:{ positionX:1000, positionY:2000, surfaceQuality:2000, liftOffDistance:120 } };
  ctx.input({}, { x:0, y:0 }, sensor);
  ctx.input({}, { x:0, y:0 }, sensor);
  ctx.input({ zr:true }, { x:0, y:0 }, sensor);
  ctx.machine.disarmFromUi();
  assert.deepEqual(ctx.pointerButtons.map(({ down }) => down), [true, false]);
  assert.equal(ctx.machine.snapshot().mouseControl.clickActive, false);
});

test("切断すると必ずDISABLEDへ戻る", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.machine.handleBridgeEvent({ type:"disconnected", id:"R1", name:"Joy-Con 2 (R)" });
  assert.equal(ctx.machine.snapshot().armed, false);
  assert.equal(ctx.machine.snapshot().joyconConnected, false);
});

test("＋を押しっぱなしにしてもDISARM後に勝手に再ARMしない", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(3000); ctx.input({ plus:true });
  ctx.setNow(3900); ctx.input({ plus:true });
  assert.equal(ctx.machine.snapshot().armed, false);
  ctx.setNow(5000); ctx.input({ plus:true });
  assert.equal(ctx.machine.snapshot().armed, false);
  ctx.input({ plus:false });
});

test("短すぎるTALK直後はACTIONをブロックする", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ zr:true });
  ctx.setNow(2050); ctx.input({ zr:false });
  ctx.input({ a:true });
  assert.deepEqual(ctx.actions.map(a => a.name), ["talkStart", "talkStop", "blocked"]);
});

test("通常送信モードでは音声入力なしでもAで送信する", () => {
  const ctx = setup();
  ctx.machine.config.actionRequiresDraft = false;
  connectAndNeutral(ctx); arm(ctx);
  ctx.input({ a:true });
  ctx.input({ a:false });
  assert.deepEqual(ctx.actions.map((action) => action.name), ["send"]);
});

test("送信に失敗した場合はdraftを復元する", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ zr:true });
  ctx.setNow(2400); ctx.input({ zr:false });
  ctx.input({ a:true });
  assert.equal(ctx.machine.snapshot().draftArmed, false);
  ctx.machine.handleActionFailure("send", "frontmost mismatch");
  assert.equal(ctx.machine.snapshot().draftArmed, true);
});

test("Bridge切断時は録音を停止し、接続状態とニュートラルを解除する", () => {
  const ctx = setup();
  ctx.machine.setBridgeConnection(true);
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ zr:true });
  ctx.machine.setBridgeConnection(false);
  assert.deepEqual(ctx.actions.map(action => action.name), ["talkStart", "talkStop"]);
  const state = ctx.machine.snapshot();
  assert.equal(state.armed, false);
  assert.equal(state.joyconConnected, false);
  assert.equal(state.neutralReady, false);
});

test("watchdog発火時も録音を停止してDISABLEDへ戻る", () => {
  const ctx = setup();
  ctx.machine.setBridgeConnection(true);
  connectAndNeutral(ctx); arm(ctx);
  ctx.setNow(2000); ctx.input({ zr:true });
  ctx.setNow(5001); ctx.machine.tick();
  assert.deepEqual(ctx.actions.map(action => action.name), ["talkStart", "talkStop"]);
  assert.equal(ctx.machine.snapshot().armed, false);
});

test("UIからのARMはBridge接続中だけ許可する", () => {
  const ctx = setup();
  connectAndNeutral(ctx);
  assert.equal(ctx.machine.armFromUi().ok, false);
  ctx.machine.setBridgeConnection(true);
  assert.equal(ctx.machine.armFromUi().ok, true);
});

test("設定変更は即時反映され、次のニュートラル入力までARMできない", () => {
  const ctx = setup();
  ctx.machine.setBridgeConnection(true);
  connectAndNeutral(ctx);
  assert.equal(ctx.machine.beginBindingsUpdate().ok, true);
  assert.equal(ctx.machine.applyBindings({
    talk:["railRightSl"], voiceChat:["plus"], action:["a"], cancel:["b"], newChat:["y"], focus:[], escape:["x"],
    taskUp:[], taskDown:[], reasonUp:[], reasonDown:[], contextPrimary:[], mouseClick:[]
  }).ok, true);
  assert.equal(ctx.machine.snapshot().neutralReady, false);
  assert.equal(ctx.machine.armFromUi().ok, false);

  ctx.input({ railRightSl:true });
  assert.equal(ctx.machine.snapshot().neutralReady, false);
  assert.equal(ctx.actions.length, 0);
  ctx.input({ railRightSl:false });
  assert.equal(ctx.machine.snapshot().neutralReady, true);
  assert.equal(ctx.machine.armFromUi().ok, true);

  ctx.input({ zr:true });
  ctx.input({ zr:false });
  assert.equal(ctx.actions.length, 0);
  ctx.setNow(2200); ctx.input({ railRightSl:true });
  ctx.setNow(2700); ctx.input({ railRightSl:false });
  assert.deepEqual(ctx.actions.map(action => action.name), ["talkStart", "talkStop"]);
});

test("ARMED中は設定保存を開始できない", () => {
  const ctx = setup();
  connectAndNeutral(ctx); arm(ctx);
  const result = ctx.machine.beginBindingsUpdate();
  assert.equal(result.ok, false);
  assert.equal(ctx.machine.snapshot().settingsUpdating, false);
});
