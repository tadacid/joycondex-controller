import CoreBluetooth
import Foundation

private let serviceUUID = CBUUID(string: "AB7DE9BE-89FE-49AD-828F-118F09DF7FD0")
private let inputUUID = CBUUID(string: "AB7DE9BE-89FE-49AD-828F-118F09DF7FD2")
private let writeUUID = CBUUID(string: "649D4AC9-8EB7-4E6C-AF44-1EA54FE5F005")
private let standardInput = Data([0x0c, 0x91, 0x01, 0x02, 0x00, 0x04, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00])
private let motionInput = Data([0x0c, 0x91, 0x01, 0x04, 0x00, 0x04, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00])

private final class DeviceContext {
  let peripheral: CBPeripheral
  var input: CBCharacteristic?
  var writer: CBCharacteristic?
  var initialized = false

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
    peripheral.discoverServices([serviceUUID])
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
    peripheral.services?.filter { $0.uuid == serviceUUID }.forEach {
      peripheral.discoverCharacteristics([inputUUID, writeUUID], for: $0)
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
withExtendedLifetime(bridge) {
  RunLoop.main.run()
}
