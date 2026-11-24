#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/openmarks"
if [[ ! -f "$SOURCE_DIR/main.js" || ! -f "$SOURCE_DIR/manifest.json" || ! -f "$SOURCE_DIR/styles.css" ]]; then
  osascript -e 'display alert "OpenMarks files are missing" message "Keep this installer beside the openmarks folder from the installer archive."'
  exit 1
fi

VAULT="${1:-}"
if [[ -z "$VAULT" ]]; then
  VAULT="$(osascript -e 'POSIX path of (choose folder with prompt "Choose an Obsidian vault to install OpenMarks into")')"
fi
if [[ ! -d "$VAULT/.obsidian" ]]; then
  osascript -e 'display alert "This folder is not an Obsidian vault" message "Choose a folder containing the .obsidian configuration folder."'
  exit 1
fi

DEST="$VAULT/.obsidian/plugins/openmarks"
mkdir -p "$DEST"
cp "$SOURCE_DIR/main.js" "$SOURCE_DIR/manifest.json" "$SOURCE_DIR/styles.css" "$DEST/"
if (( $# )); then exit 0; fi
osascript -e 'display notification "OpenMarks is installed. Enable it under Settings → Community plugins." with title "OpenMarks"'
open -a Obsidian "$VAULT"
