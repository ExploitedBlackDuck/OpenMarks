# OpenMarks 0.2.11

OpenMarks is a local-first bookmark manager for Obsidian. Bookmarks are ordinary Markdown notes stored in the vault. The plugin has no account, telemetry, remote database, or separately installed runtime dependencies. The HTML parser is bundled.

## Start OpenMarks

On first launch, choose one of three options:

- **Start with an empty library** to create your own collection.
- **Explore 100 sample bookmarks** to add the demonstration library to the current vault.
- **Import existing bookmarks** from a browser export or another supported file.

The sample library is never added automatically. Choosing the empty library keeps sample content out of your vault. The demo-vault archive is an isolated sample vault for evaluation.

## Install

The easiest way to evaluate OpenMarks is to open `openmarks-demo-vault-0.2.11.zip` as a separate Obsidian vault. To install the plugin into another vault, use the macOS installer or copy `main.js`, `manifest.json`, and `styles.css` from `openmarks-0.2.11.zip` into `<vault>/.obsidian/plugins/openmarks/`.

The installer and Community plugin package contain only `main.js`, `manifest.json`, and `styles.css`. Compressed sample data is bundled inside `main.js` and decoded only when you choose the sample library. It does not add sample notes at startup.

## Library features

- Search titles, URLs, domains, descriptions, collections, tags, and notes.
- Navigate nested collections and built-in Favorites, Unread, Recently added, and Recently opened views.
- Use Compact, Comfortable, Gallery, or List mode.
- Import browser HTML, CSV, JSON, Markdown notes, or text URL lists with a preview of new, duplicate, and invalid entries.
- Export browser HTML, JSON, or CSV into `_openmarks/exports` for access on desktop and mobile.
- Cache favicons locally in the vault. Gallery mode can display preview images already cached in the vault. OpenMarks does not download webpage previews because Obsidian's network API does not let the plugin enforce redirect and final-destination restrictions. Missing favicons use a local fallback.
- Retrieve favicons in the background after choosing the network preference. OpenMarks prioritizes visible bookmarks, limits concurrency, shares work for bookmarks on the same origin, reuses fresh cache entries, and retries failures with backoff. Automatic retrieval can be disabled in Settings.
- Edit and move bookmarks without changing the portable Markdown storage format.
- Review malformed or duplicate bookmark notes in the manager. OpenMarks leaves invalid notes intact and reports their file locations.
- Configure the default collection, display mode, favicon privacy choice, and cache behavior in the OpenMarks Settings tab. Manage exports there and move them to the vault trash after confirmation.
- Refresh all favicons with bounded concurrency, per-host pacing, progress, and cancellation. Cancellation stops queued work. A request already in flight can finish or time out.

OpenMarks accepts lawful HTTP and HTTPS bookmarks. The neutral sample content does not limit what users can save.

## Privacy and network behavior

Bookmarks, notes, cached icons, and any existing cached previews remain in the Obsidian vault. Search and import processing run locally. OpenMarks asks before making automatic favicon requests. Retrieving icons contacts bookmarked websites and may disclose the user's IP address and access timing. You can disable automatic requests in Settings. Webpage preview downloads are disabled until a network path can reliably restrict redirects and verify destination addresses. Obsidian's `requestUrl` API makes HTTP/HTTPS requests without CORS restrictions but does not expose the redirect and DNS controls OpenMarks would need for that policy. This release does not claim complete SSRF protection for metadata or favicon requests. Avoid network metadata retrieval for untrusted URLs in security-sensitive environments. Favicon operational metadata is stored in plugin data and may sync according to your Obsidian sync setup.

## Development

Requires Node.js 20 or newer and npm.

The plugin requires Obsidian 1.1.0 or newer for the metadata APIs used to update bookmark properties safely.

```sh
npm install
npm test
npm run build
npm run package
```

`npm run package` builds the plugin and assembles the four release ZIPs in `release/`, with integrity and required-file checks.

OpenMarks accepts PNG, JPEG, GIF, ICO and WebP favicon downloads. SVG-only sites use initials. Existing SVG cache files remain eligible for manual cache cleanup.
