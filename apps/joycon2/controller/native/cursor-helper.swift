import ApplicationServices
import AppKit
import Foundation

if !CGPreflightPostEventAccess() {
    _ = CGRequestPostEventAccess()
}

var leftButtonDown = false

func copyAttribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String {
    copyAttribute(element, name) as? String ?? ""
}

func boolAttribute(_ element: AXUIElement, _ name: CFString) -> Bool {
    copyAttribute(element, name) as? Bool ?? false
}

func writeWarning(_ message: String) {
    FileHandle.standardError.write(Data("入力欄切替: \(message)\n".utf8))
}

func collectComposers(_ element: AXUIElement, depth: Int, visited: inout Int, result: inout [AXUIElement]) {
    guard depth <= 40, visited < 4000 else { return }
    visited += 1

    let role = stringAttribute(element, kAXRoleAttribute as CFString)
    let classes = copyAttribute(element, "AXDOMClassList" as CFString) as? [String] ?? []
    if role == "AXTextArea", classes.contains("ProseMirror"), boolAttribute(element, kAXEnabledAttribute as CFString) {
        result.append(element)
    }

    guard let children = copyAttribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] else { return }
    for child in children {
        collectComposers(child, depth: depth + 1, visited: &visited, result: &result)
    }
}

func focusNextComposer() {
    guard AXIsProcessTrusted() else {
        writeWarning("アクセシビリティ権限がありません")
        return
    }
    let bundleIdentifiers = Set(["com.openai.codex", "com.openai.chat"])
    guard let app = NSWorkspace.shared.runningApplications.first(where: {
        guard let identifier = $0.bundleIdentifier else { return false }
        return bundleIdentifiers.contains(identifier) && !$0.isTerminated
    }) else {
        writeWarning("Codexが起動していません")
        return
    }

    let application = AXUIElementCreateApplication(app.processIdentifier)
    guard let windowValue = copyAttribute(application, kAXFocusedWindowAttribute as CFString),
          CFGetTypeID(windowValue) == AXUIElementGetTypeID() else {
        writeWarning("前面ウインドウを取得できません")
        return
    }
    let focusedWindow = windowValue as! AXUIElement
    var composers: [AXUIElement] = []
    var visited = 0
    collectComposers(focusedWindow, depth: 0, visited: &visited, result: &composers)
    guard composers.count == 1 || composers.count == 2 else {
        writeWarning("入力欄を安全に特定できません（\(composers.count)個）")
        return
    }

    let focusedIndex = composers.firstIndex(where: { boolAttribute($0, kAXFocusedAttribute as CFString) })
    let target = focusedIndex.map { composers[($0 + 1) % composers.count] } ?? composers[0]
    let result = AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    if result != .success {
        writeWarning("フォーカスを変更できませんでした（\(result.rawValue)）")
    }
}

while let line = readLine() {
    let parts = line.split(separator: " ")

    if parts.count == 1, parts[0] == "focus-composer" {
        focusNextComposer()
        continue
    }

    guard let currentEvent = CGEvent(source: nil) else { continue }
    let current = currentEvent.location

    if parts.count == 2, parts[0] == "button", let value = Int(parts[1]) {
        leftButtonDown = value != 0
        let type: CGEventType = value == 0 ? .leftMouseUp : .leftMouseDown
        guard let click = CGEvent(
            mouseEventSource: nil,
            mouseType: type,
            mouseCursorPosition: current,
            mouseButton: .left
        ) else { continue }
        click.post(tap: .cghidEventTap)
        continue
    }

    guard parts.count == 3,
          parts[0] == "move",
          let dx = Double(parts[1]),
          let dy = Double(parts[2]),
          dx.isFinite,
          dy.isFinite else { continue }

    let destination = CGPoint(
        x: current.x + dx,
        y: current.y + dy
    )
    guard let move = CGEvent(
        mouseEventSource: nil,
        mouseType: leftButtonDown ? .leftMouseDragged : .mouseMoved,
        mouseCursorPosition: destination,
        mouseButton: .left
    ) else { continue }
    move.post(tap: .cghidEventTap)
}
