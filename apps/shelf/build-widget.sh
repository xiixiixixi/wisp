#!/bin/zsh
# #82：组装收集架桌面小组件扩展（WispShelfWidget.appex）。
# 照 build.sh 组装 WispShelf.app 的先例：swiftc/SwiftPM 出可执行文件，
# 手工摆 Info.plist（NSExtension=com.apple.widgetkit-extension）再 codesign。
# 产物嵌进主 Wisp.app 的 Contents/PlugIns（由 tauri.macos.conf.json 的
# bundle.macOS.files 映射完成），不嵌进 WispShelf.app。
set -euo pipefail
cd "$(dirname "$0")"
if [[ "${SHELF_HOSTED_COMPONENT:-0}" != "1" || -z "${SHELF_BUILD_WIDGET_APP:-}" ]]; then
  print -u2 'The shelf widget is part of Wisp. It is built by scripts/prepare-shelf.mjs (release).'
  exit 1
fi
CONFIG="${SHELF_BUILD_CONFIGURATION:-release}"
if [[ -n "${SHELF_BUILD_BIN:-}" ]]; then
  BIN="$SHELF_BUILD_BIN"
else
  swift build -c "$CONFIG"
  BIN="$(swift build -c "$CONFIG" --show-bin-path)"
fi
APEX="$SHELF_BUILD_WIDGET_APP"
rm -rf "$APEX"
mkdir -p "$APEX/Contents/MacOS"
cp "$BIN/WispShelfWidget" "$APEX/Contents/MacOS/WispShelfWidget"
cp Resources/Widget-Info.plist "$APEX/Contents/Info.plist"
codesign --force --sign "${SHELF_SIGN_IDENTITY:--}" "$APEX"
printf 'Built shelf widget: %s\n' "$APEX"
