#!/bin/bash
# install-launchd.sh — installs the siyuan-mcp launchd agent on macOS
# Run once after building the project.

set -e

PLIST_SRC="$(dirname "$0")/com.siyuan-mcp.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.siyuan-mcp.plist"
LABEL="com.siyuan-mcp"

echo "=== siyuan-mcp launchd installer ==="
echo ""

# Detect node path
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
  echo "ERROR: node not found in PATH. Install Node.js first."
  exit 1
fi
echo "Node.js: $NODE_PATH"

# Detect repo root (parent of scripts/)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_INDEX="$REPO_ROOT/dist/index.js"
echo "Repo:    $REPO_ROOT"
echo "Binary:  $DIST_INDEX"

if [ ! -f "$DIST_INDEX" ]; then
  echo ""
  echo "ERROR: dist/index.js not found. Build first with: npm run build"
  exit 1
fi

# Prompt for token
echo ""
read -rsp "Enter your SiYuan API token (input hidden): " TOKEN
echo ""

if [ -z "$TOKEN" ]; then
  echo "ERROR: Token cannot be empty."
  exit 1
fi

# Write the plist with actual values substituted
sed \
  -e "s|/usr/local/bin/node|$NODE_PATH|g" \
  -e "s|/Users/YOUR_USERNAME/siyuan-mcp/dist/index.js|$DIST_INDEX|g" \
  -e "s|YOUR_SIYUAN_TOKEN_HERE|$TOKEN|g" \
  "$PLIST_SRC" > "$PLIST_DEST"

echo "Plist written to: $PLIST_DEST"

# Unload if already loaded
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# Load the agent
launchctl load "$PLIST_DEST"
echo ""
echo "✅ siyuan-mcp loaded and will run at every login."
echo ""
echo "Useful commands:"
echo "  Check status:  launchctl list | grep siyuan-mcp"
echo "  View logs:     tail -f /tmp/siyuan-mcp.log"
echo "  View errors:   tail -f /tmp/siyuan-mcp.error.log"
echo "  Stop:          launchctl unload ~/Library/LaunchAgents/com.siyuan-mcp.plist"
echo "  Restart:       launchctl kickstart -k gui/\$(id -u)/com.siyuan-mcp"
