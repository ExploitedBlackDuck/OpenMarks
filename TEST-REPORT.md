# OpenMarks 0.2.10 verification

November 24, 2026

| Check | Result |
| --- | --- |
| Automated suite on Node 20.19.5, 22.20.0 and 24.22.3 | PASS, 83 tests on each |
| TypeScript and production bundle on Node 22 | PASS |
| HTML metadata parsing and manual favicon refresh with mocked networking | PASS |
| macOS installer and disk-backed compiled plugin lifecycle | PASS |
| ZIP integrity, version consistency and 100 demo records | PASS |
| Native load in Obsidian 1.15.1 | PASS, the disposable vault reloaded with 100 bookmarks in Comfortable mode |
| Compact, Comfortable, Gallery and List on desktop | PASS for search, selection and favorite toggling in each mode |
| Mobile | NOT TESTED |

IPv6 multicast literals are rejected. Favicon downloads accept raster signatures and compatible media types. SVG-only icons fall back to initials. Existing managed SVG files are still eligible for confirmed cache cleanup.

Preview security tests exercise suppression of remote preview requests. They don't establish DNS pinning or redirect control for the separate favicon and metadata request paths. The DOM test used the locally available linkedom installation through OPENMARKS_DOM.

The scripted validator records native testing separately. The native result above comes from reloading the archived runtime inside the disposable vault.

## Final native checks

- **First launch passed.** With no saved OpenMarks settings or bookmarks, Obsidian 1.15.1 displayed onboarding with automatic retrieval unchecked. Starting empty created no sample bookmarks.
- **Creation, refresh and reload passed.** A Python bookmark saved through the dashboard. Manual refresh reported success and wrote a 15,086-byte ICO file. The note referenced the local file. The bookmark survived reloading Obsidian, and automatic retrieval remained disabled.
- **Demo archive passed.** The complete extracted demo opened with 100 saved bookmarks in List mode.
- **Upgrade loaded successfully.** The 0.2.7 demo opened in 0.2.10 with all 100 original bookmark filenames and List mode. OpenMarks requested consent again. All note hashes changed during the run. Legacy favicon migration updates frontmatter. Only hashes were captured before the upgrade, so field-by-field preservation on this historical fixture remains unverified.


## Controlled upgrade verification

Obsidian 1.15.1 loaded 100 fixture notes under OpenMarks 0.2.7. The test saved a full pre-upgrade copy of the Markdown and installed the runtime from the 0.2.10 ZIP. All filenames and all body bytes matched immediately after migration. Parsed YAML matched field by field except for the three seeded operational fields. The comparison included custom text, a list, an empty property, a wiki link and a fenced code block. The favicon source, ETag and failure count matched the migrated cache records for all 100 bookmarks across 99 origins.

The initial List mode, default collection and import setting survived. Automatic favicon retrieval stayed disabled after selecting Keep disabled. The obsolete galleryPreviewsEnabled setting was dropped. In each display mode a Python Documentation search returned one matching result, selection reported one bookmark, and toggling the favorite on and off updated its state. The packaged plugin was unchanged by these tests.
