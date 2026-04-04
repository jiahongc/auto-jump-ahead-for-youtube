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

const SKIP_SELECTORS = [
  '.ytp-jump-ahead-button',
  '.ytp-ad-skip-button',
  '.ytp-skip-ad-button',
  'button.ytp-ad-skip-button-modern',
  'button[class*="ytp-skip"]',
];
const SKIP_LABEL_PATTERN = /\b(jump ahead|skip (ad|ads|sponsor|promotion))\b/i;

function hasLayout(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

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

  if (e.data.type === 'skipped') {
    const { seconds: sec, label } = e.data;
    showToast(sec > 0 ? `${label} · ${sec}s skipped` : label);
    return;
  }

  if (e.data.type === 'skip-in-progress') {
    // Data-driven skip is happening in injected.js — suppress button
    // clicks for 2s to avoid double-skipping the same segment.
    skipInProgress = true;
    clearTimeout(skipInProgressTimer);
    skipInProgressTimer = setTimeout(() => { skipInProgress = false; }, 2000);
    return;
  }

  if (e.data.type === 'music-video-state') {
    musicVideoBlocked = Boolean(e.data.isMusicVideo);
  }

});

// ── MutationObserver fallback — click skip/jump button ───────────────────

let lastClick = 0;
let tryClickCount = 0;

function tryClick(source) {
  tryClickCount++;
  const dbg = tryClickCount % 5 === 1; // log every 5th call (~5s)

  if (!settings.skipJumpAhead) {
    if (dbg) console.log('[AutoSkip][content] tryClick BLOCKED: skipJumpAhead=false');
    return;
  }
  if (skipInProgress) {
    if (dbg) console.log('[AutoSkip][content] tryClick BLOCKED: skipInProgress');
    return;
  }
  if (musicVideoBlocked || isLikelyMusicVideoByDom()) {
    if (dbg) console.log('[AutoSkip][content] tryClick BLOCKED: music video');
    return;
  }
  if (Date.now() - lastClick < 800) return;

  // Path 1: known selectors (no layout check)
  for (const sel of SKIP_SELECTORS) {
    const btn = document.querySelector(sel);
    if (!btn) continue;
    const r = btn.getBoundingClientRect();
    console.log('[AutoSkip][content] FOUND via selector', sel,
      '| rect:', r.width.toFixed(0) + 'x' + r.height.toFixed(0),
      '| source:', source);
    clickBtn(btn, btn.getAttribute('aria-label') || btn.innerText || 'Jumped ahead');
    return;
  }

  // Path 2: scan all buttons in player
  const player = document.querySelector('#movie_player, .html5-video-player');
  if (!player) return;

  const candidates = []; // track skip-like elements we find but can't click
  for (const el of player.querySelectorAll('button, [role="button"]')) {
    const isClass = hasSkipLikeClass(el);
    const isLabel = hasSkipLikeLabel(el);
    const layout = hasLayout(el);

    if (isClass || isLabel) {
      const r = el.getBoundingClientRect();
      candidates.push({
        tag: el.tagName,
        cls: (el.className || '').toString().substring(0, 80),
        text: (el.innerText || '').substring(0, 40),
        aria: el.getAttribute('aria-label') || '',
        w: r.width.toFixed(0),
        h: r.height.toFixed(0),
        layout,
        isClass,
        isLabel,
      });

      // Click even without layout — the button may be functionally clickable
      // but YouTube hides the overlay (0x0) when controls are not shown.
      if (isClass) {
        console.log('[AutoSkip][content] CLICKING skip-class button',
          '| class:', (el.className || '').toString().substring(0, 80),
          '| layout:', layout, '| source:', source);
        clickBtn(el, el.getAttribute('aria-label') || el.innerText || 'Auto skipped');
        return;
      }
      if (isLabel) {
        console.log('[AutoSkip][content] CLICKING skip-label button',
          '| text:', (el.innerText || '').substring(0, 40),
          '| layout:', layout, '| source:', source);
        const label = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim() || 'Auto skipped';
        clickBtn(el, label);
        return;
      }
    }
  }

  if (dbg && candidates.length) {
    console.log('[AutoSkip][content] tryClick: found candidates but did not click:', JSON.stringify(candidates));
  }
}

function clickBtn(btn, label) {
  const video = document.querySelector('video');
  const before = video ? video.currentTime : null;
  btn.click();
  lastClick = Date.now();
  setTimeout(() => {
    if (video && before !== null) {
      const sec = Math.round(video.currentTime - before);
      showToast(sec > 0 ? `${label} · ${sec}s skipped` : label);
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
    tryClick('mutation');
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
setInterval(() => tryClick('poll'), 1000);

// Periodic DOM scan for debugging — logs any skip-like elements present
// in the player, even if tryClick wouldn't normally log them.
setInterval(() => {
  const player = document.querySelector('#movie_player, .html5-video-player');
  if (!player) return;
  const found = [];
  // Check known selectors
  for (const sel of SKIP_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      const r = el.getBoundingClientRect();
      found.push({ sel, w: r.width.toFixed(0), h: r.height.toFixed(0), text: (el.innerText || '').substring(0, 30) });
    }
  }
  // Check for any element with "jump" or "skip" in class/aria
  for (const el of player.querySelectorAll('[class*="jump"], [class*="skip"], [aria-label*="Jump"], [aria-label*="skip"]')) {
    const r = el.getBoundingClientRect();
    found.push({
      tag: el.tagName,
      cls: (el.className || '').toString().substring(0, 60),
      aria: el.getAttribute('aria-label') || '',
      w: r.width.toFixed(0),
      h: r.height.toFixed(0),
    });
  }
  if (found.length) {
    console.log('[AutoSkip][content] DOM scan — skip-like elements:', JSON.stringify(found));
  }
}, 3000);

loadSettings();
