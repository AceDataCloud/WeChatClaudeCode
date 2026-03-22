#!/bin/bash
set -euo pipefail

DATA_DIR="${HOME}/.wechat-claude-code"
PLIST_LABEL="com.wechat-claude-code.bridge"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

is_loaded() {
  launchctl print gui/$(id -u)/"${PLIST_LABEL}" &>/dev/null
}

case "$1" in
  start)
    if is_loaded; then
      echo "Already running (or plist loaded)"
      exit 0
    fi
    mkdir -p "$DATA_DIR/logs"
    # Find node binary, resolving nvm/fnm/volta paths
    NODE_BIN="$(command -v node || echo '/usr/local/bin/node')"
    cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${PROJECT_DIR}/dist/main.js</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${DATA_DIR}/logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/logs/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${NODE_BIN%/*}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST
    launchctl load "$PLIST_PATH"
    echo "Started wechat-claude-code daemon"
    ;;
  stop)
    launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "Stopped wechat-claude-code daemon"
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  status)
    if is_loaded; then
      pid=$(pgrep -f "dist/main.js start" 2>/dev/null | head -1)
      if [ -n "$pid" ]; then
        echo "Running (PID: $pid)"
      else
        echo "Loaded but not running"
      fi
    else
      echo "Not running"
    fi
    ;;
  logs)
    LOG_DIR="${DATA_DIR}/logs"
    if [ -d "$LOG_DIR" ]; then
      latest=$(ls -t "${LOG_DIR}"/bridge-*.log 2>/dev/null | head -1)
      if [ -n "$latest" ]; then
        tail -100 "$latest"
      else
        echo "No bridge logs found. Checking stdout/stderr:"
        for f in "${LOG_DIR}"/stdout.log "${LOG_DIR}"/stderr.log; do
          if [ -f "$f" ]; then
            echo "=== $(basename "$f") ==="
            tail -30 "$f"
          fi
        done
      fi
    else
      echo "No logs found"
    fi
    ;;
  *)
    echo "Usage: daemon.sh {start|stop|restart|status|logs}"
    ;;
esac
