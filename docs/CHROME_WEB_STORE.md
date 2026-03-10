# Chrome Web Store Reference

This file is the source of truth for Chrome Web Store listing copy, reviewer notes, and submission-safe positioning.

## Product Name

`YouTube Skip Assist`

## Short Description

`Provides supported YouTube playback skip assistance when available.`

## Detailed Description

`YouTube Skip Assist` helps reduce interruptions while watching YouTube.

It primarily automates YouTube's own supported skip actions when they are available, including Jump Ahead and related skip controls. It also includes an optional, best-effort chapter-based ad skip feature when YouTube exposes usable chapter metadata.

## Core Behaviors

- Performs supported YouTube skip actions when available.
- Includes optional chapter-based ad skipping when chapter metadata is available.
- Saves only local toggle preferences using `chrome.storage.sync`.
- Reads YouTube page content/metadata locally on-device to determine whether supported skip actions are available.

## Limitations

- Jump Ahead is not triggered during the first video chapter to avoid false positives on content intros.
- Behavior depends on YouTube UI availability and internal page data.
- Results may vary by region, account state, experiment bucket, and video type.
- Some videos do not expose a reproducible skip path.
- The extension does not guarantee skipping every sponsor read, ad mention, or interruptive segment.

## Do Not Use In Store Copy

- `skip in-video sponsored segments on YouTube`
- `always skips ads`
- `skips all sponsor segments`
- `works on every video`

## Reviewer Notes Template

This extension primarily automates YouTube-supported skip actions when available.

Expected behavior:

1. Open a YouTube watch page.
2. If YouTube exposes Jump Ahead or a supported skip control, the extension performs that action automatically.
3. If the page includes usable chapter metadata with clear ad labels such as `Ad Break` or `Paid Promotion`, the optional chapter-based feature may skip that chapter.

Known limitations:

- Behavior depends on YouTube UI/data availability.
- Results vary by video, account, region, and experiment state.

## Submission Checklist

- Store title matches current product name.
- Short description avoids broad sponsor/ad claims.
- Full description includes limitations.
- Chrome Web Store privacy answers match actual local on-device processing of YouTube page content.
- Screenshots and captions do not promise universal sponsor skipping.
- Privacy policy URL is included.
- Reviewer notes are short and reproducible.

## Important Links

- Privacy policy page: `https://jiahongc.github.io/youtube-skip-assist/privacy.html`
- Privacy markdown fallback: `https://github.com/jiahongc/youtube-skip-assist/blob/main/PRIVACY.md`
- Support/issues: `https://github.com/jiahongc/youtube-skip-assist/issues`
