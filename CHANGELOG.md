# Changelog

## 1.10

- Redesigned the Jump Ahead toast notification: shows `label · from → to · +duration` (e.g. `YouTube Jump Ahead · 2:14 → 2:36 · +22s`) instead of a flat one-line status.
- Added an Undo button on the toast that rewinds to the pre-skip timestamp and clears the matching done-zone so the segment is not immediately re-skipped.
- Added a second Jump Ahead data source: decode `SMART_SKIP` entity mutations from `frameworkUpdates` so we pick up segments that never surface in `timelyActionsOverlayViewModel`.
- Removed the global jump-ahead cache so late-arriving payloads can add new segments, and replaced the all-or-nothing stale-globals bail with per-source video-id staleness filtering.
- Relaxed jump-ahead acceptance thresholds (min delta 1s, max 15min, no 10s lead-in guard) and deduplicated segments across sources.
- Added a direct-seek path in the content script: when the DOM button exposes a duration in its aria-label (e.g. "Jump ahead 22 seconds"), seek the `<video>` directly instead of clicking a potentially hidden overlay button.
- Suppressed fullscreen-hidden DOM clicks; the data-driven heartbeat now handles those cases on the next tick.
- Improved skip labels: chapter skips now read `Skipped chapter: <title>` and jump-ahead reads `YouTube Jump Ahead` (pulled from the button's own title/accessibility text when available).
- Added a `window.__autoskipDebug` surface (`printJumpAhead()`, `printSnapshot()`, `reprocess()`) and structured debug logging under the `[AutoSkip]` prefix to make misfires diagnosable from the DevTools console.

## 1.9

- Fire the retry/slow-poll cadence on direct page loads (pasted URL, refresh, new tab), not only on SPA navigation — removes the last case where users had to move the mouse before Jump Ahead would trigger.
- Attach the video handler and heartbeat as soon as the `<video>` element exists, independent of segment availability, so the first skip after data arrives never waits on a DOM mutation.
- Suppress the misleading "Jumped ahead" toast in the DOM-click fallback when the click was a no-op against a hidden overlay; the data-driven path handles it on the next heartbeat tick.
- Removed first-chapter guard that was blocking Jump Ahead segments in the first chapter.
- Added heartbeat polling and extra event listeners for more reliable auto-skip timing.
- Added periodic button polling in content script to catch skip buttons without mouse interaction.
- Renamed the extension to `YouTube Skip Assist` for clearer, policy-safe positioning.
- Updated public-facing copy to emphasize supported skip assistance and metadata-dependent chapter skipping.
- Tightened chapter matching to avoid false positives.
- Improved YouTube SPA/navigation reliability.
- Improved payload interception across fetch/XHR variations.
- Added intro-chapter guard (do not skip intro unless ad cues exist).
- Added dedicated privacy policy page and markdown fallback.
- Refreshed README and user documentation.

## 1.4

- Added popup toggles for Jump Ahead and Ad Chapter behavior.
- Added music video guard.
- Improved chapter extraction robustness across YouTube payload shapes.
