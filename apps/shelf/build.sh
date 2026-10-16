#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
if [[ "${SHELF_HOSTED_COMPONENT:-0}" != "1" || -z "${SHELF_BUILD_APP:-}" ]]; then
  print -u2 'The shelf is part of Wisp. Build it with pnpm -w shelf:prepare --dev.'
  exit 1
fi
CONFIG="${SHELF_BUILD_CONFIGURATION:-release}"
if [[ -n "${SHELF_BUILD_BIN:-}" ]]; then
  BIN="$SHELF_BUILD_BIN"
else
  swift build -c "$CONFIG"
  BIN="$(swift build -c "$CONFIG" --show-bin-path)"
fi
APP="$SHELF_BUILD_APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN/WispShelf" "$APP/Contents/MacOS/WispShelf"
cp Resources/Info.plist "$APP/Contents/Info.plist"
if [[ "${SHELF_HOSTED_COMPONENT:-0}" == "1" ]]; then
  /usr/libexec/PlistBuddy -c 'Add :WispHostedComponent bool true' "$APP/Contents/Info.plist"
fi
cp -R Resources/Examples "$APP/Contents/Resources/"

# SwiftPM does not run Xcode's App Intents extraction step for this executable.
SDK="$(xcrun --show-sdk-path)"
SWIFTC="$(xcrun --find swiftc)"
TOOLCHAIN="$(dirname "$(dirname "$(dirname "$SWIFTC")")")"
XCODE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :ProductBuildVersion' "$(xcode-select -p)/../version.plist")"
ARCH="${SHELF_BUILD_ARCH:-$(uname -m)}"
TARGET="$ARCH-apple-macos13.0"
mkdir -p .build
METADATA_WORK="$(mktemp -d "$PWD/.build/app-intents.XXXXXX")"
trap 'rm -rf "$METADATA_WORK"' EXIT
xcrun swiftc -emit-object -emit-const-values -whole-module-optimization -parse-as-library Sources/WispShelf/AppIntents.swift \
  -o "$METADATA_WORK/AppIntents.o" \
  -module-name WispShelf -sdk "$SDK" -target "$TARGET" \
  -I "$BIN" -I "$BIN/Modules" \
  -const-gather-protocols-list "$PWD/Resources/AppIntentsProtocols.json" \
  -emit-const-values-path "$METADATA_WORK/WispShelf.swiftconstvalues"
printf '%s\n' "$PWD/Sources/WispShelf/AppIntents.swift" > "$METADATA_WORK/sources.list"
printf '%s\n' "$METADATA_WORK/WispShelf.swiftconstvalues" > "$METADATA_WORK/constants.list"
rm -rf "$APP/Contents/Resources/Metadata.appintents"
xcrun appintentsmetadataprocessor \
  --output "$APP/Contents/Resources" --toolchain-dir "$TOOLCHAIN" \
  --module-name WispShelf --sdk-root "$SDK" --xcode-version "$XCODE_VERSION" \
  --platform-family macOS --deployment-target 13.0 --target-triple "$TARGET" \
  --bundle-identifier com.wisp.shelf.dev --source-file-list "$METADATA_WORK/sources.list" \
  --swift-const-vals-list "$METADATA_WORK/constants.list" --compile-time-extraction --force
test -s "$APP/Contents/Resources/Metadata.appintents/extract.actionsdata"
xcrun swift -e '
import Foundation
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let data = try Data(contentsOf: url)
let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
let actions = root?["actions"] as? [String: Any]
let intent = actions?["AddFilesToShelfIntent"] as? [String: Any]
let parameters = intent?["parameters"] as? [[String: Any]]
guard intent?["isDiscoverable"] as? Bool == true,
      parameters?.first?["name"] as? String == "files" else {
    FileHandle.standardError.write(Data("Missing discoverable file-collection intent metadata.\n".utf8))
    exit(1)
}
' "$APP/Contents/Resources/Metadata.appintents/extract.actionsdata"
codesign --force --sign "${SHELF_SIGN_IDENTITY:--}" "$APP"
printf 'Built: %s\n' "$APP"
