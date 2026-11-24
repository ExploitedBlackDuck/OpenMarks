# Changelog

## 0.2.11

- Parse page metadata without inserting remote HTML into a DOM. Use native Obsidian settings headings.

## 0.2.10

- After upgrading, bookmarks with previously cached SVG icons show initials until a raster icon is available. Clear favicon cache removes the old managed SVG files.

- Accept raster favicons with matching signatures. SVG-only sites use initials. Reject multicast IPv6 literals while allowing ordinary public names beginning with fc or fd.
- Name cached icons by origin digest, preserve apostrophes in fetched metadata, accept cleared optional properties and import CSV link columns.

- Remove the unused `validatePreviewBytes` preview validator and its test. Webpage preview retrieval stays disabled; existing cached previews remain viewable in Gallery mode.
- Stop exporting `preview_image` and `preview_source` in JSON exports. Those values are vault-local paths and previews can no longer be retrieved, so exports stay portable. A round-trip regression test covers the removal.
- Bump plugin and runtime version to 0.2.10 and update the README and INSTALLATION document references.

## 0.2.9

- Disable webpage metadata preview image downloads until OpenMarks can enforce destination and redirect restrictions. Existing cached previews remain available. Gallery cards use the favicon artwork and avoid presenting remote preview retrieval as an available option.
- Record closing the automatic favicon consent dialog as a saved choice to keep requests disabled. Users can opt in later from Settings.
- Retry failed favicon cache writes with bounded exponential backoff. Keep unsaved state dirty after failures and permit later explicit retries. Plugin unload attempts a final flush and stops future retry timers; completion remains best effort.
- Save exports with readable local-date names and collision suffixes. Add a confirmed export cleanup control that moves only files under `_openmarks/exports/` to the vault trash.
- Announce favorite actions and pressed states to assistive technology. Mark the active navigation item with `aria-current`.
- Increment runtime and package version to 0.2.9 and make release packaging verify version consistency in plugin, installer, and demo-vault archives.
- Add regression coverage for preview request suppression, consent dismissal, write retries, export names, and accessibility state.

## 0.2.8

- Recover automatic favicon retrieval after queue cancellation. Repeated cancellation is safe, and a fresh queue accepts new work.
- Keep deferred import favicons deferred for the current session, with explicit release on manual refresh or cache clear and automatic eligibility after restart.
- Move favicon validators, retry timing, failure counts, source URLs, and cache paths into Obsidian plugin data. Migrate legacy note metadata only after cache-index persistence succeeds, while retaining user fields and note bodies.
- Contain cache-state write failures and retain retry eligibility. Rate-limit routine error notices.
- Start network timeouts after host pacing rather than while a request waits in the queue. Keep bounded workers and per-host pacing.
- Serialize imports, show validation and import progress, and support cancellation between writes. Preserve browser `ADD_DATE` timestamps and only restore slash-based legacy collections from recognizable OpenMarks exports.
- Preserve expanded collection folders and synchronize sort controls after filter changes. Align sidebar items with Obsidian theme variables.
- Separate favicon and preview response-size limits and retain image validation. Allow validated public CDN hosts for optional preview images. Use a version-independent request User-Agent.
- Ask for consent before automatic favicon requests. Confirm cache clearing and delete only verified generated OpenMarks favicon paths.
- Replace invalid sample tag spaces with valid tag values. Add migration, retry failure, managed-cache path, deferred processing, cancellation, date import, and queue benchmarks to regression coverage.
- Automated verification: 69 tests pass on Node 25.9.0; production TypeScript/build succeeds. An independent reviewer reports that the earlier 63-test suite passed on Node 20. The expanded 69-test suite and current-build Obsidian application testing remain unverified in this environment.
- Coalesce favicon cache-index saves into two-second batches and flush pending metadata on plugin unload. Keep bookmark property saves and retry failures separate from the request operation.
- Preserve existing favicons when a bookmark URL changes within the same origin. Reload storage after legacy-field cleanup so vault edits suppressed during migration are picked up.
- Use the bookmark's local calendar date for imported browser `ADD_DATE` timestamps.
- Set `minAppVersion` to 1.1.0, the release that introduced the metadata API used by this plugin. The Settings heading call remains on the established imperative `Setting` API.
- Make sidebar rows and navigation native buttons for keyboard activation, disclose the 50-result cap, suggest existing collection paths, and save exports into the vault for desktop and mobile compatibility.

## 0.2.7

- Debounce vault-event bursts and ignore OpenMarks' own favicon-only modifications for full dashboard redraws. Patch favicon DOM elements in place.
- Preserve dashboard filters, search, scroll, selection, and focus through rerenders. Add collection and smart-filter counts and a 30-day Recently Added window.
- Detect stale note-body edits before writing, and recheck immediately before replacing the body. Preserve and report records when create read-back fails.
- Bundle the compressed sample library in the plugin JavaScript and decode it only when the user requests samples. The distributed plugin now needs only `main.js`, `manifest.json`, and `styles.css`.
- Make duplicate URL ownership deterministic, shorten new generated filenames while keeping IDs stable, and preserve nested browser HTML folders and tags on export/import.
- Cap bookmark imports at 10 MB, render Gallery cards without disabled-preview placeholders, keep card tags on one line, and use compact unread indicators.
- Compile test imports for Node compatibility instead of importing TypeScript source directly. Automated tests pass in the available Node 25 environment. Node 20 isn't installed here, so a direct Node 20 run remains unverified.
- Retrieve favicons automatically for new, imported, sample, missing, stale, and URL-changed bookmarks.
- Prioritize visible bookmarks, cap the queue at three concurrent requests, pace requests per host, deduplicate queued items, and share each origin's favicon result across bookmarks.
- Reuse locally cached icons for the configured refresh interval. Use ETag and Last-Modified validators when supported.
- Persist retry timestamps and exponential backoff. Failed refreshes retain the last usable cached icon.
- Add settings to disable automatic requests, set the refresh interval, control import retrieval, clear the local icon cache, and start a manual refresh.
- Add mock-network and queue tests for cache policy, validators, concurrency, prioritization, cancellation, and unsafe responses.
- Document that automatic retrieval contacts bookmarked sites and may reveal the user's IP address and access timing.
- Application verification and final archive checks are recorded in `OPENMARKS-TEST-REPORT.md` after the final package build.

## 0.2.6

- Added an indexed URL lookup while preserving fragments as part of bookmark identity.
- Generate random stable IDs for new bookmarks and allocate collision-safe note filenames. Existing IDs and note paths remain intact.
- Parse and validate bookmark frontmatter with Obsidian's YAML parser. Invalid notes remain on disk and appear in a recoverable issue list.
- Protect metadata updates from stale UI snapshots and concurrent changes. Track external creates, edits, renames, moves, and deletions.
- Added settings for default collection, default view, and Gallery previews.
- Moved sample data out of the production JavaScript bundle into a separate optional JSON asset.
- Added bounded favicon refresh workers, per-host pacing, progress, and cancellation.
- Added deterministic storage, concurrency, and 1,000/5,000/10,000-record benchmark coverage.
- Application-level verification of this build remains pending because the test Mac became locked.

## 0.2.4

- Replaced the demonstration library with 100 neutral bookmarks across eight categories and removed religiously themed examples.
- Added an explicit first-run choice to start empty, install the sample library, or import existing bookmarks.
- Kept Gallery preview retrieval disabled by default and preserved the local favicon fallback.
- Updated release packaging to produce plugin, source, demo-vault, and macOS installer archives.
- Maintained Markdown-based storage, import/export, search, nested collections, and four display modes.

## Earlier work

Previous release-candidate notes are retained in the source history. See `OPENMARKS-TEST-REPORT.md` for current verification and known limitations.
