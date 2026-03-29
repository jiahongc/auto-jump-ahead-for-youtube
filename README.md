# YouTube Skip Assist

Chrome extension that provides supported YouTube playback skip assistance.

It also includes an optional, best-effort chapter-based ad skip feature when YouTube exposes usable chapter metadata.

## Quick Start

1. Clone the repo:
   ```bash
   git clone https://github.com/jiahongc/youtube-skip-assist.git
   ```
2. Open Chrome at `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose this folder.
5. Open any YouTube video.
6. Click the extension icon to configure toggles.

## What It Does

- Automatically clicks YouTube Jump Ahead and related skip controls when YouTube provides them.
- Optionally skips chapter-marked ad sections when chapter metadata is available.
- Shows a toast when a skip is performed.
- Saves toggle preferences using `chrome.storage.sync`.

## What It Does Not Do

- Does not use external tracking/analytics.
- Does not use third-party segment services.
- Does not guarantee skipping every sponsor read or embedded advertising mention.
- Does not skip videos when YouTube provides no usable Jump Ahead or chapter data.

## Default Behavior

- `YouTube Jump Ahead`: ON
- `Chapter-Based Ad Skips`: ON
- Music videos: blocked by default
- Intro chapters are not skipped unless the chapter title also contains clear ad cues.
- Jump Ahead fires in any chapter, including the first — YouTube's own data determines when to skip.

## Limitations

- Behavior depends on YouTube UI availability and internal page data.
- Results may vary by region, account state, experiment bucket, and video type.
- Some videos simply do not expose a reproducible skip path.

## Documentation

- Usage guide: [docs/USAGE.md](./docs/USAGE.md)
- Troubleshooting: [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)
- Chrome Web Store reference: [docs/CHROME_WEB_STORE.md](./docs/CHROME_WEB_STORE.md)
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Privacy policy page: https://jiahongc.github.io/youtube-skip-assist/privacy.html
- Privacy markdown fallback: [PRIVACY.md](./PRIVACY.md)

## Permissions

- `storage`: saves the two toggle preferences.

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension metadata (Manifest V3) |
| `content.js` | Fallback button detection + toast UI |
| `injected.js` | Main YouTube data parsing and seek logic |
| `popup.html` / `popup.js` / `popup.css` | Popup settings UI |
| `generate-icons.py` | Rebuilds `icon16/48/128.png` |

## License

MIT
