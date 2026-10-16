#!/bin/zsh
# #25：组装收集架分享扩展（WispShelfShare.appex）。
# 照 build-widget.sh 组装小组件的先例：SwiftPM 出可执行文件，手工摆
# Info.plist（NSExtension=com.apple.share-services-manager）再 codesign。
# 产物嵌进主 Wisp.app 的 Contents/PlugIns（tauri.macos.conf.json 的
# bundle.macOS.files 映射），与 WispShelfWidget.appex 并列。
set -euo pipefail
cd "$(dirname "$0")"
if [[ "${SHELF_HOSTED_COMPONENT:-0}" != "1" || -z "${SHELF_BUILD_SHARE_APP:-}" ]]; then
  print -u2 'The shelf share extension is part of Wisp. It is built by scripts/prepare-shelf.mjs (release).'
  exit 1
fi
CONFIG="${SHELF_BUILD_CONFIGURATION:-release}"
if [[ -n "${SHELF_BUILD_BIN:-}" ]]; then
  BIN="$SHELF_BUILD_BIN"
else
  swift build -c "$CONFIG"
  BIN="$(swift build -c "$CONFIG" --show-bin-path)"
fi
APEX="$SHELF_BUILD_SHARE_APP"
rm -rf "$APEX"
mkdir -p "$APEX/Contents/MacOS"
cp "$BIN/WispShelfShare" "$APEX/Contents/MacOS/WispShelfShare"
cp Resources/Share-Info.plist "$APEX/Contents/Info.plist"
codesign --force --sign "${SHELF_SIGN_IDENTITY:--}" "$APEX"
printf 'Built shelf share extension: %s\n' "$APEX"
