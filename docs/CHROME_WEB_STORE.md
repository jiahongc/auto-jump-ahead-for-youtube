# Chrome Web Store — Submission Sheet

Fill in every `‹FILL: …›`, then copy each block straight into the matching
field in the Chrome Web Store developer dashboard. Pre-written copy is already
worded to be accurate and policy-safe — change the meaning only if the
extension's behavior changes.

> Why this matters: most rejections for a YouTube helper come from (1) a name
> that implies affiliation with YouTube/Google, (2) over-claiming ("blocks
> ads", "skips all sponsors"), or (3) a reviewer not seeing it work. This sheet
> is built to avoid all three.

---

## 0. Decisions to make first

| Decision | Recommended | Your choice |
|---|---|---|
| Product name (store + manifest) | `Auto Jump Ahead for YouTube` | **Auto Jump Ahead for YouTube** ✓ |
| Category | `Productivity` | ‹FILL› |
| Support email | `jiahong1996@gmail.com` | ‹FILL› |
| Reviewer test video (has a clearly ad/sponsor-labeled chapter) | — | ‹FILL: paste a current YouTube URL› |

**Name rule:** use `<Something> for YouTube`, never `YouTube <Something>`.
"for YouTube" reads as describing compatibility; leading with "YouTube" reads
as an official YouTube product and is a common rejection cause. Whatever you
pick here must match `manifest.json` → `name`, the README title, the popup
heading, and the privacy page.

---

## 1. Product name

```
Auto Jump Ahead for YouTube
```

Max 75 characters; keep it short. Do not include "official", "best", or emoji.

---

## 2. Summary (short description — max 132 characters)

```
Automatically uses YouTube's built-in Jump Ahead and skips video chapters creators label as sponsor or ad segments.
```

Accurate, concrete, no ad-blocker implication. (Count before submitting; trim
if over 132.)

---

## 3. Detailed description

```
Auto Jump Ahead for YouTube automates skip actions that YouTube already provides, so you spend less time reaching for the skip button.

WHAT IT DOES
• Auto Jump Ahead — When YouTube shows its own built-in "Jump Ahead" control on a video, the extension activates it for you automatically.
• Sponsor / ad chapter skipping (optional) — When a video has chapters and one is clearly labeled as an ad or paid promotion (for example "Ad Break", "Sponsor", "Paid Promotion"), the extension can skip that chapter. This relies on the video's own chapter markers.
• A small on-screen notice appears whenever a skip happens, with an Undo button.
• Two simple on/off toggles in the popup. Music videos are left alone by default.

WHAT IT DOES NOT DO
• It is not an ad blocker. It does not block, remove, or skip the video ads YouTube plays before or during a video.
• It does not skip every sponsor mention. It only acts on information YouTube already provides: whether Jump Ahead is available, and chapters that are explicitly labeled.
• It does nothing on videos that have no Jump Ahead and no labeled chapters.
• Jump Ahead is a YouTube feature and only appears where YouTube chooses to offer it.

PRIVACY
• No account, no sign-in, no tracking, no analytics.
• The only thing stored is your two on/off settings, saved locally through Chrome.
• Nothing is sent to the developer. Privacy policy: ‹FILL: https://jiahongc.github.io/auto-jump-ahead-for-youtube/privacy.html›

Not affiliated with, endorsed by, or sponsored by YouTube or Google LLC. "YouTube" is a trademark of Google LLC, used here only to describe what this extension works with.
```

---

## 4. Single purpose (dashboard → Privacy practices)

```
Reduce viewing interruptions on YouTube by automating skip actions YouTube already exposes: activating YouTube's built-in Jump Ahead control, and optionally skipping video chapters that are explicitly labeled as ads or paid promotions.
```

One sentence, one purpose — this is what the "single purpose" field wants.

---

## 5. Permission justifications (dashboard → Privacy practices)

**`storage`**
```
Stores the user's two on/off preferences (Jump Ahead automation and chapter-based skipping) so they persist between sessions. No other data is stored.
```

**Host access to `www.youtube.com`** (from the content scripts)
```
The extension reads the YouTube watch page — the video player, chapter markers, and YouTube's own skip controls — to detect when a supported skip is available and to perform it. It runs only on www.youtube.com and accesses no other site.
```

**Remote code**
```
No. All code is bundled in the package. The extension executes no remotely hosted code.
```

---

## 6. Data collection disclosures (dashboard → Privacy practices)

Answer the data-type checkboxes as **not collected** — nothing leaves the
device. The extension *reads* YouTube page content but processes it locally and
transmits nothing, so it does not "collect" data in the dashboard's sense.

Certify all three:
- [x] I do not sell or transfer user data to third parties (outside approved use cases).
- [x] I do not use or transfer user data for purposes unrelated to the item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending.

Privacy policy URL (required):
```
‹FILL: https://jiahongc.github.io/auto-jump-ahead-for-youtube/privacy.html›
```

---

## 7. Reviewer notes (dashboard → "Notes for reviewer")

A reviewer who opens a random video may see nothing skip — that is expected,
and it gets extensions wrongly rejected as non-functional. Give them a
guaranteed repro:

```
This extension automates skip actions YouTube already provides.

Quickest way to verify (no Premium needed):
1. Open this video, which has a chapter explicitly labeled as an ad/sponsor: ‹FILL: test video URL›
2. Open the extension popup and make sure "Chapter-Based Ad Skips" is ON.
3. Start playback. When the labeled ad/sponsor chapter begins, playback automatically seeks past it and an on-screen notice with an Undo button appears.

Jump Ahead:
• On videos where YouTube shows its own "Jump Ahead" control, the extension activates it automatically. Jump Ahead only appears where YouTube offers it, so it may not be present on every video.

The extension only runs on www.youtube.com, stores only two on/off toggle settings locally, and sends no data anywhere.
```

---

## 8. Screenshots (1280×800 or 640×400; 1–5, at least 1 required)

Suggested set with non-overpromising captions:

1. Popup with the two toggles — caption: `Two simple toggles. Music videos left alone by default.`
2. The on-screen skip notice with Undo — caption: `A quick notice (with Undo) whenever a skip happens.`
3. A video with an ad-labeled chapter being skipped — caption: `Skips chapters creators label as ads or paid promotions.`

Caption rules: no "block ads", no "skip all sponsors", no "works on every
video".

Optional images: store icon 128×128 (have it), small promo tile 440×280.

---

## 9. Do NOT use in any store copy, caption, or screenshot

- `ad blocker` / `block ads` / `remove ads`
- `skip in-video sponsored segments on YouTube`
- `always skips ads` / `skips all sponsor segments`
- `works on every video`
- anything implying this is official YouTube software

---

## 10. Pre-submission self-check

- [ ] Product name uses `… for YouTube`, not `YouTube …`.
- [ ] Name matches across: `manifest.json`, README, popup heading, privacy page.
- [ ] Summary ≤ 132 chars and makes no ad-blocker claim.
- [ ] Description states plainly that it is not an ad blocker.
- [ ] Affiliation disclaimer present in the description.
- [ ] Single-purpose sentence filled in.
- [ ] Each permission justified; remote code = No.
- [ ] Data disclosures = nothing collected; 3 certifications checked.
- [ ] Privacy policy URL live and reachable.
- [ ] Reviewer notes include a real, reproducible test video.
- [ ] Screenshots + captions avoid every phrase in section 9.
- [ ] `manifest.json` version bumped for this submission.

---

## Links

- Privacy policy: `https://jiahongc.github.io/auto-jump-ahead-for-youtube/privacy.html`
- Privacy markdown fallback: `https://github.com/jiahongc/auto-jump-ahead-for-youtube/blob/main/PRIVACY.md`
- Support / issues: `https://github.com/jiahongc/auto-jump-ahead-for-youtube/issues`
