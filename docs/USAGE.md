# Usage Guide

This extension is positioned as supported skip assistance, not as a universal sponsor-blocking tool.

## Open Settings

1. Click the extension icon in Chrome.
2. You will see two toggles:
   - `YouTube Jump Ahead`
   - `Chapter-Based Ad Skips`

Both are enabled by default.

## How Skipping Works

### Jump Ahead

- Uses YouTube's own Jump Ahead/seek metadata.
- If present, playback seeks forward automatically.

### Chapter-Based Ad Skips

- Reads chapter metadata from YouTube page data.
- Best effort only.
- Skips chapters that are explicitly labeled like ad/promo sections.
- Does not skip generic intro chapters unless ad cues are present in the title.

### Music Video Rule

- Music videos are excluded by default.
- If a video is classified as music, skips are blocked.

### Where Preferences Are Saved

- Toggle values are stored in `chrome.storage.sync`.
- Stored keys:
  - `skipJumpAhead`
  - `skipAdChapter`
