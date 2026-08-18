#!/bin/bash
# Wisp CLI wrapper — installed to /usr/local/bin/wisp
# Delegates to the Node.js CLI bundled with the app or runs commands directly.

APP_PATH="/Applications/Wisp.app"
CLI_SCRIPT="$APP_PATH/Contents/Resources/cli/wisp.mjs"

# If the app has a bundled CLI, use it
if [ -f "$CLI_SCRIPT" ] && command -v node &>/dev/null; then
    exec node "$CLI_SCRIPT" "$@"
fi

# Fallback: if no args or a path, open with the app
if [ $# -eq 0 ]; then
    open "$APP_PATH"
elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Wisp CLI"
    echo ""
    echo "Usage:"
    echo "  wisp [folder]        Open folder in Wisp"
    echo "  wisp login           Login to xplorer.space"
    echo "  wisp publish         Publish extension to marketplace"
    echo "  wisp extensions      List your published extensions"
    echo "  wisp whoami          Show current user"
    echo "  wisp create [name]   Create new extension"
    echo ""
    echo "Requires: Node.js (for login/publish commands)"
elif [ -d "$1" ] || [ -f "$1" ]; then
    open -a Wisp "$1"
else
    echo "Error: Node.js not found. Install Node.js for full CLI features."
    echo "For now, you can open folders: wisp /path/to/folder"
    exit 1
fi
