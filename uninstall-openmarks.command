#!/bin/zsh
set -euo pipefail

VAULT="$(osascript -e 'POSIX path of (choose folder with prompt "Choose the Obsidian vault to remove OpenMarks from")')"
DEST="$VAULT/.obsidian/plugins/openmarks"
if [[ ! -d "$DEST" ]]; then
  osascript -e 'display alert "OpenMarks is not installed in this vault"'
  exit 0
fi
STAMP="$(date +%Y%m%d-%H%M%S)"
mv "$DEST" "$HOME/.Trash/OpenMarks-$STAMP"
osascript -e 'display notification "The plugin folder was moved to Trash. Bookmark notes were left in your vault." with title "OpenMarks removed"'
