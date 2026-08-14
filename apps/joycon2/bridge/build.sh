#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
SOURCE_FILE="$SCRIPT_DIR/native/main.swift"
BUILD_DIR="$SCRIPT_DIR/native/build"
BINARY_FILE="$BUILD_DIR/joycon2-bridge"
ENTITLEMENTS_FILE="$SCRIPT_DIR/native/entitlements.plist"
MODULE_CACHE_DIR="$BUILD_DIR/external-module-cache"

mkdir -p "$BUILD_DIR" "$MODULE_CACHE_DIR"
xcrun swiftc -module-cache-path "$MODULE_CACHE_DIR" "$SOURCE_FILE" -framework Foundation -framework CoreBluetooth -o "$BINARY_FILE"
codesign --force --sign - --entitlements "$ENTITLEMENTS_FILE" "$BINARY_FILE"
echo "$BINARY_FILE"
