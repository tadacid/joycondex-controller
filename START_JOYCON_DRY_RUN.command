#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h}"
BRIDGE="$ROOT/apps/joycon2/bridge"
CONTROLLER="$ROOT/apps/joycon2/controller"
BRIDGE_PID=""
CONTROLLER_PID=""

cleanup() {
  print "\nDRY RUNを終了します…"
  if [[ -n "$CONTROLLER_PID" ]]; then
    pkill -TERM -P "$CONTROLLER_PID" 2>/dev/null || true
    kill "$CONTROLLER_PID" 2>/dev/null || true
  fi
  if [[ -n "$BRIDGE_PID" ]]; then
    pkill -TERM -P "$BRIDGE_PID" 2>/dev/null || true
    kill "$BRIDGE_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

print "Joy-Con 2 Bridgeを起動します…"
(cd "$BRIDGE" && npm run start) &
BRIDGE_PID=$!

for _ in {1..40}; do
  if curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1; then break; fi
  sleep 0.25
done

if ! curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1; then
  print "Bridgeが起動しませんでした。上のログを確認してください。"
  exit 1
fi

print "Codex ControllerをDRY RUNで起動します…"
(cd "$CONTROLLER" && CODEX_CONTROLLER_DRY_RUN=1 npm run start) &
CONTROLLER_PID=$!
sleep 1
open http://127.0.0.1:8788/

print "\nDRY RUNです。Macへキー入力は送りません。"
print "終了する時は、このTerminalで Control+C。\n"
wait "$CONTROLLER_PID"
