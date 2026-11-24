# OpenMarks 0.2.10 installation

Requires Obsidian 1.1.0 or newer.

## Try the isolated demo vault

1. Unzip `openmarks-demo-vault-0.2.10.zip`.
2. In Obsidian, choose **Open another vault** and then **Open folder as vault**.
3. Select the `OpenMarks Demo Vault` folder.
4. Trust and enable the included OpenMarks community plugin when Obsidian asks.
5. Open OpenMarks from the ribbon or run **Open bookmark manager**.

The demo vault contains 100 sample records across eight top-level collections. It is a separate vault and does not alter another vault's bookmarks.

## Install into an existing vault

### macOS installer

1. Unzip `openmarks-macos-installer-0.2.10.zip`.
2. Run `install-openmarks.command` and select the target vault.
3. In Obsidian, open **Settings → Community plugins** and enable OpenMarks.

The installer copies `main.js`, `manifest.json`, and `styles.css`. Compressed sample data is bundled inside `main.js` and decoded only after you choose the sample library. It does not install demo bookmarks at startup.

### Manual install

1. Unzip `openmarks-0.2.10.zip`.
2. Copy the `openmarks` folder into `<vault>/.obsidian/plugins/`.
3. Enable OpenMarks under **Settings → Community plugins**.

## First launch

Choose **Start with an empty library**, **Explore 100 sample bookmarks**, or **Import existing bookmarks**. OpenMarks does not add samples unless you select that option. If the vault already contains OpenMarks bookmarks, the sample-library choice is skipped. OpenMarks still asks before automatic favicon requests if no prior network preference exists.

## Storage and uninstall

Bookmark notes are stored in `_openmarks/bookmarks/`. Cached favicons, optional previews, and exported files are stored under `_openmarks/`. They are ordinary vault files. Exports are saved in `_openmarks/exports/`. Disable OpenMarks and remove `.obsidian/plugins/openmarks/` to uninstall the plugin. The macOS uninstaller moves the plugin folder to Trash and leaves bookmark data in place.

## Troubleshooting

- If OpenMarks does not appear, check that `.obsidian/plugins/openmarks/` contains `main.js` and `manifest.json`.
- If the plugin is disabled, enable it in Community plugins.
- Unsupported or unavailable favicons use the built-in fallback. Webpage preview downloads are disabled because Obsidian does not expose controls to restrict redirect destinations. Existing local preview files remain usable.
- OpenMarks asks whether it may retrieve favicons automatically. This contacts bookmarked websites and may disclose your IP address and access timing. Change the choice under **Settings → OpenMarks → Automatically retrieve favicons**. Cached icons remain available when automatic requests are disabled.
- Closing the favicon privacy prompt keeps automatic retrieval disabled and records that choice. You can enable retrieval later in Settings.
- Manage generated exports under **Settings → OpenMarks → Exports**. Cleanup requires confirmation and moves the export files to the vault trash.
- HTTP and HTTPS are the only accepted bookmark schemes.
