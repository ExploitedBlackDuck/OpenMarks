# OpenMarks 0.2.10 native verification


- **First launch passed.** With no saved OpenMarks settings or bookmarks, Obsidian 1.15.1 displayed onboarding with automatic retrieval unchecked. Starting empty created no sample bookmarks.
- **Creation, refresh and reload passed.** A Python bookmark saved through the dashboard. Manual refresh reported success and wrote a 15,086-byte ICO file. The note referenced the local file. The bookmark survived reloading Obsidian, and automatic retrieval remained disabled.
- **Demo archive passed.** The complete extracted demo opened with 100 saved bookmarks in List mode.
- **Upgrade loaded successfully.** The 0.2.7 demo opened in 0.2.10 with all 100 original bookmark filenames and List mode. OpenMarks requested consent again. All note hashes changed during the run. Legacy favicon migration updates frontmatter. Only hashes were captured before the upgrade, so field-by-field preservation on this historical fixture remains unverified.

Tested main.js SHA-256: ac7665425ca12784443294242cdebc44dc475dd2932e657c3477d854fa7c820d
