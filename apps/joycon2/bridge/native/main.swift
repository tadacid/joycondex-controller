import CoreBluetooth
import Foundation

private let serviceUUID = CBUUID(string: "AB7DE9BE-89FE-49AD-828F-118F09DF7FD0")
private let inputUUID = CBUUID(string: "AB7DE9BE-89FE-49AD-828F-118F09DF7FD2")
private let writeUUID = CBUUID(string: "649D4AC9-8EB7-4E6C-AF44-1EA54FE5F005")
private let rightVibrationUUID = CBUUID(string: "FA19B0FB-CD1F-46A7-84A1-BBB09E00C149")
private let standardInput = Data([0x0c, 0x91, 0x01, 0x02, 0x00, 0x04, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00])
private let motionInput = Data([0x0c, 0x91, 0x01, 0x04, 0x00, 0x04, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00])
private let rumbleRefreshMs = 12

private struct RumblePulse: Decodable {
  let onMs: Int
  let offMs: Int
}

private struct BridgeCommand: Decodable {
  let type: String
  let requestId: String?
  let pulses: [RumblePulse]?
  let strength: Int?
}

private final class DeviceContext {
  let peripheral: CBPeripheral
  var input: CBCharacteristic?
  var writer: CBCharacteristic?
  var vibration: CBCharacteristic?
  var initialized = false
  var hapticsReadyEmitted = false
  var rumbleGeneration = 0
  var rumbleRefreshGeneration = 0
  var vibrationPacketId: UInt8 = 0

  init(peripheral: CBPeripheral) {
    self.peripheral = peripheral
  }
}

private final class JoyConBridge: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  private var central: CBCentralManager!
  private var devices: [UUID: DeviceContext] = [:]

  override init() {
    super.init()
    central = CBCentralManager(delegate: self, queue: .main)
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central.state == .poweredOn else {
      emit(["type": "state", "state": stateName(central.state)])
      return
    }
    emit(["type": "ready"])
    scan()
  }

  private func scan() {
    central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    emit(["type": "scanning"])
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    let name = peripheral.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? ""
    guard name.contains("Joy-Con 2") else { return }
    if devices[peripheral.identifier] == nil {
      devices[peripheral.identifier] = DeviceContext(peripheral: peripheral)
      emit(["type": "found", "id": peripheral.identifier.uuidString, "name": name])
    }
    guard peripheral.state == .disconnected else { return }
    central.connect(peripheral, options: nil)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let context = devices[peripheral.identifier] ?? DeviceContext(peripheral: peripheral)
    devices[peripheral.identifier] = context
    peripheral.delegate = self
    peripheral.discoverServices(nil)
  }

  func centralManager(
    _ central: CBCentralManager,
    didFailToConnect peripheral: CBPeripheral,
    error: Error?
  ) {
    emitError("connect", peripheral, error)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.scan() }
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    if let context = devices[peripheral.identifier] {
      stopRumble(context)
      context.input = nil
      context.writer = nil
      context.vibration = nil
      context.hapticsReadyEmitted = false
    }
    devices[peripheral.identifier]?.initialized = false
    emit([
      "type": "disconnected",
      "id": peripheral.identifier.uuidString,
      "name": peripheral.name ?? "Joy-Con 2"
    ])
    if let error { emitError("disconnect", peripheral, error) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      central.connect(peripheral, options: nil)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    if let error {
      emitError("services", peripheral, error)
      return
    }
    peripheral.services?.forEach { service in
      peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    if let error {
      emitError("characteristics", peripheral, error)
      return
    }
    guard let context = devices[peripheral.identifier] else { return }
    for characteristic in service.characteristics ?? [] {
      if characteristic.uuid == inputUUID {
        context.input = characteristic
        peripheral.setNotifyValue(true, for: characteristic)
      } else if characteristic.uuid == writeUUID {
        context.writer = characteristic
      } else if characteristic.uuid == rightVibrationUUID {
        context.vibration = characteristic
        if !context.hapticsReadyEmitted {
          context.hapticsReadyEmitted = true
          emit([
            "type": "haptics",
            "id": peripheral.identifier.uuidString,
            "name": peripheral.name ?? "Joy-Con 2",
            "ready": true
          ])
        }
      }
    }
    initialize(context)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    if let error {
      emitError("notifications", peripheral, error)
      return
    }
    if let context = devices[peripheral.identifier] { initialize(context) }
  }

  private func initialize(_ context: DeviceContext) {
    guard !context.initialized, let input = context.input, input.isNotifying, let writer = context.writer else { return }
    context.initialized = true
    write(standardInput, to: writer, on: context.peripheral)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      self.write(motionInput, to: writer, on: context.peripheral)
      self.emit([
        "type": "connected",
        "id": context.peripheral.identifier.uuidString,
        "name": context.peripheral.name ?? "Joy-Con 2"
      ])
    }
  }

  private func write(_ data: Data, to characteristic: CBCharacteristic, on peripheral: CBPeripheral) {
    let kind: CBCharacteristicWriteType = characteristic.properties.contains(.writeWithoutResponse)
      ? .withoutResponse
      : .withResponse
    peripheral.writeValue(data, for: characteristic, type: kind)
  }

  func handleCommandLine(_ line: String) {
    guard let data = line.data(using: .utf8) else { return }
    do {
      let command = try JSONDecoder().decode(BridgeCommand.self, from: data)
      switch command.type {
      case "rumble":
        guard let pulses = command.pulses, let strength = command.strength else {
          emit(["type": "rumble", "status": "failed", "message": "振動データが不足しています"])
          return
        }
        playRumble(pulses: pulses, strength: strength, requestId: command.requestId ?? "unknown")
      case "rumbleStop":
        stopAllRumble(requestId: command.requestId ?? "stop")
      default:
        emit(["type": "error", "stage": "command", "message": "未対応の命令です"])
      }
    } catch {
      emit(["type": "error", "stage": "command", "message": error.localizedDescription])
    }
  }

  private func rightRumbleContext() -> DeviceContext? {
    devices.values.first {
      $0.peripheral.state == .connected &&
      ($0.peripheral.name ?? "").lowercased().contains("(r)") &&
      $0.vibration != nil
    }
  }

  private func playRumble(pulses: [RumblePulse], strength: Int, requestId: String) {
    guard let context = rightRumbleContext() else {
      emit(["type": "rumble", "status": "failed", "requestId": requestId, "message": "右Joy-Con 2の振動機能が未接続です"])
      return
    }
    stopRumble(context)
    context.rumbleGeneration += 1
    let generation = context.rumbleGeneration
    emit(["type": "rumble", "status": "accepted", "requestId": requestId])
    playPulse(pulses, index: 0, strength: strength, requestId: requestId, context: context, generation: generation)
  }

  private func playPulse(
    _ pulses: [RumblePulse],
    index: Int,
    strength: Int,
    requestId: String,
    context: DeviceContext,
    generation: Int
  ) {
    guard context.rumbleGeneration == generation else { return }
    guard index < pulses.count else {
      writeRumble(active: false, strength: strength, context: context)
      emit(["type": "rumble", "status": "completed", "requestId": requestId])
      return
    }
    let pulse = pulses[index]
    context.rumbleRefreshGeneration += 1
    let refreshGeneration = context.rumbleRefreshGeneration
    refreshRumble(strength: strength, context: context, generation: generation, refreshGeneration: refreshGeneration)
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(pulse.onMs)) {
      guard context.rumbleGeneration == generation else { return }
      context.rumbleRefreshGeneration += 1
      self.writeRumble(active: false, strength: strength, context: context)
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(pulse.offMs)) {
        self.playPulse(
          pulses,
          index: index + 1,
          strength: strength,
          requestId: requestId,
          context: context,
          generation: generation
        )
      }
    }
  }

  private func refreshRumble(
    strength: Int,
    context: DeviceContext,
    generation: Int,
    refreshGeneration: Int
  ) {
    guard context.rumbleGeneration == generation,
          context.rumbleRefreshGeneration == refreshGeneration else { return }
    writeRumble(active: true, strength: strength, context: context)
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(rumbleRefreshMs)) {
      self.refreshRumble(
        strength: strength,
        context: context,
        generation: generation,
        refreshGeneration: refreshGeneration
      )
    }
  }

  private func stopAllRumble(requestId: String) {
    for context in devices.values { stopRumble(context) }
    emit(["type": "rumble", "status": "stopped", "requestId": requestId])
  }

  private func stopRumble(_ context: DeviceContext) {
    context.rumbleGeneration += 1
    context.rumbleRefreshGeneration += 1
    if context.peripheral.state == .connected, context.vibration != nil {
      writeRumble(active: false, strength: 1, context: context)
    }
  }

  private func writeRumble(active: Bool, strength: Int, context: DeviceContext) {
    guard let vibration = context.vibration else { return }
    let packet = 0x50 | (context.vibrationPacketId & 0x0f)
    context.vibrationPacketId &+= 1
    var data = Data([0x00, packet])
    data.append(vibrationBytes(active: active, strength: strength))
    data.append(silentVibrationBytes())
    data.append(silentVibrationBytes())
    write(data, to: vibration, on: context.peripheral)
  }

  private func vibrationBytes(active: Bool, strength: Int) -> Data {
    guard active else { return silentVibrationBytes() }
    let levels: [UInt16] = [5_800, 11_600, 17_400, 23_200, 29_000]
    let amplitude = levels[max(0, min(4, strength - 1))]
    return encodeHDRumble(
      highFrequency: 0x187,
      highAmplitude: amplitude,
      lowFrequency: 0x112,
      lowAmplitude: amplitude
    )
  }

  private func silentVibrationBytes() -> Data {
    encodeHDRumble(highFrequency: 0x187, highAmplitude: 0, lowFrequency: 0x112, lowAmplitude: 0)
  }

  private func encodeHDRumble(
    highFrequency: UInt16,
    highAmplitude: UInt16,
    lowFrequency: UInt16,
    lowAmplitude: UInt16
  ) -> Data {
    Data([
      UInt8(highFrequency & 0xff),
      UInt8(((highAmplitude >> 4) & 0xfc) | ((highFrequency >> 8) & 0x03)),
      UInt8(((highAmplitude >> 12) | (lowFrequency << 4)) & 0xff),
      UInt8((lowAmplitude & 0xc0) | ((lowFrequency >> 4) & 0x3f)),
      UInt8((lowAmplitude >> 8) & 0xff)
    ])
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    if let error {
      emitError("input", peripheral, error)
      return
    }
    guard characteristic.uuid == inputUUID, let value = characteristic.value else { return }
    emit([
      "type": "frame",
      "id": peripheral.identifier.uuidString,
      "name": peripheral.name ?? "Joy-Con 2",
      "hex": value.map { String(format: "%02x", $0) }.joined()
    ])
  }

  private func stateName(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "powered-on"
    case .poweredOff: return "powered-off"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .resetting: return "resetting"
    default: return "unknown"
    }
  }

  private func emitError(_ stage: String, _ peripheral: CBPeripheral, _ error: Error?) {
    emit([
      "type": "error",
      "stage": stage,
      "id": peripheral.identifier.uuidString,
      "message": error?.localizedDescription ?? "unknown error"
    ])
  }

  private func emit(_ payload: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
  }
}

setbuf(stdout, nil)
private let bridge = JoyConBridge()
DispatchQueue.global(qos: .utility).async {
  while let line = readLine() {
    DispatchQueue.main.async { bridge.handleCommandLine(line) }
  }
  DispatchQueue.main.async { bridge.handleCommandLine("{\"type\":\"rumbleStop\",\"requestId\":\"stdin-closed\"}") }
}
withExtendedLifetime(bridge) {
  RunLoop.main.run()
}
