// YouTube Auto Skip — content script (ISOLATED world).
// Receives skip notifications from injected.js (MAIN world), shows toast,
// and forwards toggle settings from extension storage to injected.js.

const DEFAULT_SETTINGS = {
  skipJumpAhead: true,
  skipAdChapter: true,
};

let settings = { ...DEFAULT_SETTINGS };
let musicVideoBlocked = false;
let skipInProgress = false;
let skipInProgressTimer = null;
let doneZones = []; // [{from, to}] — time ranges (seconds) already skipped

const SKIP_SELECTORS = [
  '.ytp-jump-ahead-button',
  '.ytp-ad-skip-button',
  '.ytp-skip-ad-button',
  'button.ytp-ad-skip-button-modern',
  'button[class*="ytp-skip"]',
];
const SKIP_LABEL_PATTERN = /\b(jump ahead|skip (ad|ads|sponsor|promotion))\b/i;

function hasSkipLikeClass(el) {
  const cls = (el.className || '').toString();
  return /ytp-(?:jump-ahead|ad-skip|skip-ad|skip)/i.test(cls) && !/skip-intro/i.test(cls);
}

function hasSkipLikeLabel(el) {
  const text = [
    el.innerText || '',
    el.textContent || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('title') || '',
    el.getAttribute('data-title-no-tooltip') || '',
  ].join(' ').replace(/\s+/g, ' ').trim();
  return SKIP_LABEL_PATTERN.test(text);
}

function isLikelyMusicVideoByDom() {
  const genre = document.querySelector('meta[itemprop="genre"]')?.getAttribute('content') || '';
  return /\bmusic\b/i.test(genre);
}

function postSettingsToPage() {
  window.postMessage({
    source: 'autoskip-config',
    type: 'settings',
    settings,
  }, '*');
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    settings = {
      skipJumpAhead: stored.skipJumpAhead !== false,
      skipAdChapter: stored.skipAdChapter !== false,
    };
  } catch (_) {
    settings = { ...DEFAULT_SETTINGS };
  }
  postSettingsToPage();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  let changed = false;

  if (changes.skipJumpAhead) {
    settings.skipJumpAhead = changes.skipJumpAhead.newValue !== false;
    changed = true;
  }
  if (changes.skipAdChapter) {
    settings.skipAdChapter = changes.skipAdChapter.newValue !== false;
    changed = true;
  }

  if (changed) postSettingsToPage();
});

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  const player = document.querySelector('#movie_player');
  if (!player) return;

  let t = document.getElementById('autoskip-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'autoskip-toast';
    Object.assign(t.style, {
      position: 'absolute', bottom: '64px', left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.78)', color: '#fff',
      padding: '7px 16px', borderRadius: '20px',
      fontSize: '16px', fontFamily: 'Roboto, sans-serif',
      fontWeight: '500', letterSpacing: '0.01em',
      zIndex: '9999', pointerEvents: 'none',
      opacity: '0', transition: 'opacity 0.15s ease', whiteSpace: 'nowrap',
    });
    player.appendChild(t);
  }
  // SECURITY: use textContent, never innerHTML — msg contains untrusted chapter titles
  t.textContent = `⏭  ${msg}`;
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.style.opacity = '0'), 5000);
}

// ── Listen for skip notifications from injected.js ───────────────────────

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (e.origin !== 'https://www.youtube.com') return;
  if (e.data?.source !== 'autoskip') return;

  if (e.data.type === 'skip-in-progress') {
    skipInProgress = true;
    clearTimeout(skipInProgressTimer);
    skipInProgressTimer = setTimeout(() => { skipInProgress = false; }, 2000);
    return;
  }

  if (e.data.type === 'skipped') {
    const { seconds: sec, label, fromSec, toSec } = e.data;
    if (fromSec != null && toSec != null) {
      doneZones.push({ from: fromSec, to: toSec });
    }
    showToast(sec > 0 ? `${label} · ${sec}s` : label);
    return;
  }

  if (e.data.type === 'music-video-state') {
    musicVideoBlocked = Boolean(e.data.isMusicVideo);
  }
});

// ── MutationObserver fallback — click skip/jump button ───────────────────

let lastClick = 0;

function isInDoneZone() {
  const video = document.querySelector('video');
  if (!video) return false;
  const t = video.currentTime;
  return doneZones.some(z => t >= z.from && t < z.to);
}

function tryClick() {
  if (!settings.skipJumpAhead) return;
  if (skipInProgress) return;
  if (musicVideoBlocked || isLikelyMusicVideoByDom()) return;
  if (Date.now() - lastClick < 800) return;
  if (isInDoneZone()) return;

  // Path 1: known selectors (no layout check needed)
  for (const sel of SKIP_SELECTORS) {
    const btn = document.querySelector(sel);
    if (!btn) continue;
    clickBtn(btn, 'Jumped ahead');
    return;
  }

  // Path 2: scan all buttons in player — click even without layout since
  // YouTube hides the overlay (0x0) when controls are not shown.
  const player = document.querySelector('#movie_player, .html5-video-player');
  if (!player) return;
  for (const el of player.querySelectorAll('button, [role="button"]')) {
    if (hasSkipLikeClass(el)) {
      clickBtn(el, 'Jumped ahead');
      return;
    }
    if (hasSkipLikeLabel(el)) {
      clickBtn(el, 'Jumped ahead');
      return;
    }
  }
}

function clickBtn(btn, label) {
  const video = document.querySelector('video');
  const before = video ? video.currentTime : null;
  btn.click();
  lastClick = Date.now();
  setTimeout(() => {
    if (video && before !== null) {
      const after = video.currentTime;
      const sec = Math.round(after - before);
      if (sec > 2) {
        doneZones.push({ from: before, to: after });
      }
      showToast(sec > 0 ? `${label} · ${sec}s` : label);
    } else {
      showToast(label);
    }
  }, 300);
}

let clickTimer = null;
const observer = new MutationObserver(() => {
  if (clickTimer) return;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    tryClick();
  }, 150);
});

function startObserver() {
  const target = document.body;
  if (!target) return;
  observer.observe(target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-label'],
  });
}

if (document.body) {
  startObserver();
} else {
  window.addEventListener('DOMContentLoaded', startObserver, { once: true });
}

// Periodic poll — catches skip buttons that appear without triggering
// a tracked DOM mutation (e.g. CSS transitions, opacity animations).
setInterval(tryClick, 1000);

// Clear done zones on navigation so they don't persist across videos.
document.addEventListener('yt-navigate-finish', () => { doneZones = []; });

loadSettings();
