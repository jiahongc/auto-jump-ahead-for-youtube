// Runs in YouTube's page context (world: "MAIN", document_start).
// 1. Skips Jump ahead segments from timelyActionsOverlayViewModel
// 2. Skips chapters whose titles match ad/break/sponsor patterns

(function () {
  'use strict';

  console.log('[AutoSkip] injected.js loaded');
  const settings = {
    skipJumpAhead: true,
    skipAdChapter: true,
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  function findDeep(obj, key, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 20) return null;
    if (obj[key] !== undefined) return obj[key];
    for (const v of Object.values(obj)) {
      const r = findDeep(v, key, (depth || 0) + 1);
      if (r !== null) return r;
    }
    return null;
  }

  function getPageData() {
    if (window.ytInitialData) return window.ytInitialData;
    try { return window.ytcfg?.get?.('INITIAL_DATA'); } catch (_) {}
    return null;
  }

  function getPlayerResponse() {
    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
    try { return window.ytcfg?.get?.('PLAYER_RESPONSE'); } catch (_) {}
    return null;
  }

  function collectChapterLists(node, out, depth, seen) {
    if (!node || typeof node !== 'object' || (depth || 0) > 20) return;
    if (!seen) seen = new WeakSet();
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node) && node.length) {
      const chapterItems = node
        .map(item => item?.chapterRenderer || item?.macroMarkersListItemRenderer?.chapterRenderer)
        .filter(Boolean);
      if (chapterItems.length === node.length) {
        out.push(chapterItems);
        return;
      }
    }

    if (node.chapterRenderer && typeof node.chapterRenderer === 'object') {
      out.push([node.chapterRenderer]);
      return;
    }

    for (const v of Object.values(node)) collectChapterLists(v, out, (depth || 0) + 1, seen);
  }

  function chapterPointFromRenderer(c) {
    if (!c || typeof c !== 'object') return null;
    const title = c.title?.simpleText || c.title?.runs?.[0]?.text || '';
    const startMs = parseInt(c.timeRangeStartMillis, 10);
    if (!Number.isFinite(startMs)) return null;
    return { title, startMs };
  }

  function parseTimestampToMs(value) {
    if (!value || typeof value !== 'string') return null;
    const parts = value.trim().split(':').map(part => parseInt(part, 10));
    if (!parts.length || parts.some(n => !Number.isFinite(n))) return null;
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + part;
    return seconds * 1000;
  }

  function collectDomChapterPoints() {
    const selectors = [
      '.ytp-chapter-title-content',
      '.ytp-chapter-hover-container',
      'ytd-macro-markers-list-item-renderer',
      '[class*="chapter"]',
    ];

    const candidates = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;

        const timeMatch = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/);
        const titleMatch = text.match(/[A-Za-z][A-Za-z0-9 '&/-]{2,}/);
        if (!timeMatch || !titleMatch) continue;

        const startMs = parseTimestampToMs(timeMatch[0]);
        const title = titleMatch[0].trim();
        if (!Number.isFinite(startMs) || !title) continue;
        candidates.push({ title, startMs });
      }
    }

    return Array.from(new Map(
      candidates.map(ch => [`${ch.startMs}|${ch.title.toLowerCase()}`, ch])
    ).values()).sort((a, b) => a.startMs - b.startMs);
  }

  function collectChapterFallbackPoints(node, out, depth, seen) {
    if (!node || typeof node !== 'object' || (depth || 0) > 20) return;
    if (!seen) seen = new WeakSet();
    if (seen.has(node)) return;
    seen.add(node);

    const direct = chapterPointFromRenderer(node.chapterRenderer) ||
      chapterPointFromRenderer(node.macroMarkersListItemRenderer?.chapterRenderer);
    if (direct) out.push(direct);

    for (const v of Object.values(node)) collectChapterFallbackPoints(v, out, (depth || 0) + 1, seen);
  }

  const MUSIC_TITLE_PATTERN = /\b(official music video|music video|lyric video|official audio|visualizer)\b/i;
  const MUSIC_CHANNEL_PATTERN = /\bofficial artist channel\b/i;
  let isMusicVideo = false;
  let hasSentMusicState = false;

  function isLikelyMusicVideoByMetadata() {
    const player = getPlayerResponse();
    if (!player || typeof player !== 'object') return false;

    const category = player?.microformat?.playerMicroformatRenderer?.category || '';
    if (typeof category === 'string' && category.toLowerCase() === 'music') return true;

    const title = player?.videoDetails?.title || '';
    const owner = player?.videoDetails?.author || '';
    const keywords = Array.isArray(player?.videoDetails?.keywords) ? player.videoDetails.keywords.join(' ') : '';

    let weakSignals = 0;
    if (MUSIC_TITLE_PATTERN.test(title)) weakSignals++;
    if (MUSIC_CHANNEL_PATTERN.test(owner)) weakSignals++;
    if (/\b(lyrics?|official audio|visualizer)\b/i.test(keywords)) weakSignals++;
    return weakSignals >= 2;
  }

  function isLikelyMusicVideoByDom() {
    const genre = document.querySelector('meta[itemprop="genre"]')?.getAttribute('content') || '';
    return /\bmusic\b/i.test(genre);
  }

  function refreshMusicGuard() {
    const nextIsMusic = isLikelyMusicVideoByMetadata() || isLikelyMusicVideoByDom();
    const changed = nextIsMusic !== isMusicVideo;
    isMusicVideo = nextIsMusic;

    if (changed || !hasSentMusicState) {
      hasSentMusicState = true;
      window.postMessage({ source: 'autoskip', type: 'music-video-state', isMusicVideo }, '*');
      console.log('[AutoSkip] Music guard:', isMusicVideo ? 'blocking skips for music video' : 'skip eligible');
    }

    if (changed && isMusicVideo) reset();
  }

  // Chapter title matching: strong ad signals + weak signals with context,
  // while excluding common non-ad uses of "break".
  const AD_STRONG_PATTERN = /\b(ad(?:vert(?:isement)?)?\s*break|commercial(?:\s*break)?|sponsor(?:ed|ship)?(?:\s*(?:segment|section|message))?|paid\s*(?:promotion|partnership)|brought to you by|in partnership with|brand deal|promo(?:tion)?|ad read)\b/i;
  const AD_WEAK_PATTERN = /\b(partner(?:ship)?|message from|word from|thanks to)\b/i;
  const AD_CONTEXT_PATTERN = /\b(sponsor|promo|paid|commercial|advert(?:isement)?)\b/i;
  const AD_EXCLUDE_PATTERN = /\b(spring break|coffee break|breakdown|adventure)\b/i;
  const INTRO_CHAPTER_PATTERN = /\b(intro|introduction|opening|cold open|welcome)\b/i;
  const INTRO_AD_ALLOW_PATTERN = /\b(ad|sponsor|sponsored|promo|promotion|paid|commercial|partner(?:ship)?|brought to you by)\b/i;

  function isAdChapterTitle(title) {
    if (!title) return false;
    if (INTRO_CHAPTER_PATTERN.test(title) && !INTRO_AD_ALLOW_PATTERN.test(title)) return false;
    if (AD_EXCLUDE_PATTERN.test(title)) return false;
    if (AD_STRONG_PATTERN.test(title)) return true;
    return AD_WEAK_PATTERN.test(title) && AD_CONTEXT_PATTERN.test(title);
  }

  function isIntroChapterTitle(title) {
    if (!title) return false;
    return INTRO_CHAPTER_PATTERN.test(title) && !INTRO_AD_ALLOW_PATTERN.test(title);
  }

  function applySettings(next) {
    const normalized = {
      skipJumpAhead: next?.skipJumpAhead !== false,
      skipAdChapter: next?.skipAdChapter !== false,
    };
    const changed = normalized.skipJumpAhead !== settings.skipJumpAhead ||
      normalized.skipAdChapter !== settings.skipAdChapter;

    settings.skipJumpAhead = normalized.skipJumpAhead;
    settings.skipAdChapter = normalized.skipAdChapter;
    if (!changed) return;

    console.log('[AutoSkip] Settings updated:', settings);
    reset();
    processAllSources();
    attachHandlerIfReady();
  }

  // ── Extract Jump ahead segments ──────────────────────────────────────────

  function extractJumpAheadSegments(data) {
    const timelyVm = findDeep(data, 'timelyActionsOverlayViewModel');
    const timelyActions = timelyVm?.timelyActions || timelyVm?.timelyActionsOverlayViewModel?.timelyActions;
    if (!Array.isArray(timelyActions)) return [];

    const segments = [];
    for (const action of timelyActions) {
      const vm = action?.timelyActionViewModel;
      if (!vm) continue;
      const label = vm.content?.buttonViewModel?.title || vm.content?.buttonViewModel?.accessibilityText || 'Auto skip segment';

      const triggerMs = parseInt(vm.startTimeMilliseconds, 10);
      if (isNaN(triggerMs)) continue;

      let seekTargetMs = null;
      const commands = vm.rendererContext?.commandContext?.onTap?.serialCommand?.commands;
      if (commands) {
        for (const cmd of commands) {
          const seek = cmd?.innertubeCommand?.seekToVideoTimestampCommand;
          if (seek?.offsetFromVideoStartMilliseconds) {
            seekTargetMs = parseInt(seek.offsetFromVideoStartMilliseconds, 10);
            break;
          }
        }
      }

      const delta = seekTargetMs ? seekTargetMs - triggerMs : 0;
      if (seekTargetMs && delta >= 2000 && delta <= 600000) {
        segments.push({ label, triggerMs, seekTargetMs });
        console.log('[AutoSkip] Jump segment: trigger', (triggerMs / 1000).toFixed(1) + 's ->',
          (seekTargetMs / 1000).toFixed(1) + 's (' + Math.round(delta / 1000) + 's)');
      }
    }
    return segments;
  }

  // ── Extract chapter-break segments ──────────────────────────────────────

  function extractChapterSegments(data) {
    const segments = [];

    // Keep chapter collections separate so "next chapter" stays in the same list.
    const chapterLists = [];
    collectChapterLists(data, chapterLists, 0, new WeakSet());
    const normalizedLists = chapterLists
      .map(rawList => rawList.map(chapterPointFromRenderer).filter(Boolean).sort((a, b) => a.startMs - b.startMs))
      .filter(list => list.length >= 2);

    // Fallback when chapter data isn't in expected list shapes.
    if (!normalizedLists.length) {
      const fallbackPoints = [];
      collectChapterFallbackPoints(data, fallbackPoints, 0, new WeakSet());
      const deduped = Array.from(new Map(
        fallbackPoints.map(ch => [`${ch.startMs}|${ch.title}`, ch])
      ).values()).sort((a, b) => a.startMs - b.startMs);
      if (deduped.length >= 2) normalizedLists.push(deduped);
    }
    if (!normalizedLists.length) return segments;

    for (const chapters of normalizedLists) {
      if (!chapters.length) continue;

      console.log('[AutoSkip] Chapters found:', chapters.map(c => '"' + c.title + '" @' + (c.startMs / 1000).toFixed(0) + 's').join(', '));

      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        if (!isAdChapterTitle(ch.title)) continue;

        const nextChapter = chapters[i + 1];
        if (!nextChapter) continue;

        segments.push({
          label: '"' + ch.title + '"',
          triggerMs: ch.startMs,
          seekTargetMs: nextChapter.startMs,
        });
        console.log('[AutoSkip] Break chapter:', '"' + ch.title + '"',
          (ch.startMs / 1000).toFixed(1) + 's ->', (nextChapter.startMs / 1000).toFixed(1) + 's');
      }
    }

    return segments;
  }

  function extractChapterSegmentsFromPoints(points) {
    const segments = [];
    if (!Array.isArray(points) || points.length < 2) return segments;

    console.log('[AutoSkip] DOM chapters found:', points.map(c => '"' + c.title + '" @' + (c.startMs / 1000).toFixed(0) + 's').join(', '));

    for (let i = 0; i < points.length - 1; i++) {
      const ch = points[i];
      const nextChapter = points[i + 1];
      if (!isAdChapterTitle(ch.title)) continue;
      if (nextChapter.startMs <= ch.startMs) continue;

      segments.push({
        label: '"' + ch.title + '"',
        triggerMs: ch.startMs,
        seekTargetMs: nextChapter.startMs,
      });
      console.log('[AutoSkip] DOM break chapter:', '"' + ch.title + '"',
        (ch.startMs / 1000).toFixed(1) + 's ->', (nextChapter.startMs / 1000).toFixed(1) + 's');
    }

    return segments;
  }

  function extractIntroSegmentsFromPoints(points) {
    const segments = [];
    if (!Array.isArray(points) || points.length < 2) return segments;

    for (let i = 0; i < points.length - 1; i++) {
      const ch = points[i];
      const nextChapter = points[i + 1];
      if (!isIntroChapterTitle(ch.title)) continue;
      if (nextChapter.startMs <= ch.startMs) continue;
      segments.push({
        label: '"' + ch.title + '"',
        triggerMs: ch.startMs,
        seekTargetMs: nextChapter.startMs,
      });
    }

    return segments;
  }

  // ── First-chapter boundary helper ───────────────────────────────────────

  function getFirstChapterEndMs(...dataSources) {
    // Only use structured YouTube API data — DOM chapter selectors can
    // produce false positives on videos that have no real chapters.
    const chapterLists = [];
    for (const data of dataSources) {
      if (data) collectChapterLists(data, chapterLists, 0, new WeakSet());
    }
    const allPoints = chapterLists
      .flatMap(rawList => rawList.map(chapterPointFromRenderer).filter(Boolean))
      .sort((a, b) => a.startMs - b.startMs);

    // Deduplicate by startMs
    const deduped = [];
    let lastMs = -1;
    for (const p of allPoints) {
      if (p.startMs !== lastMs) { deduped.push(p); lastMs = p.startMs; }
    }

    // Need at least 2 chapters to define a first-chapter boundary
    if (deduped.length < 2) return null;
    return deduped[1].startMs;
  }

  // ── Arm the auto-skip handler ────────────────────────────────────────────

  let activeSegments = [];
  let handler = null;
  let attachedVideo = null;
  let lastLogTime = -99999;
  let pendingRetryTimers = [];

  function attachHandlerIfReady() {
    const video = document.querySelector('video');
    if (!video) return false;

    if (handler && attachedVideo === video) return true;

    if (handler && attachedVideo) {
      attachedVideo.removeEventListener('timeupdate', handler);
    }

    handler = () => {
      if (isMusicVideo) return;
      const ms = video.currentTime * 1000;

      // Re-arm if user seeked back before a segment's trigger
      for (const seg of activeSegments) {
        if (seg.done && ms < seg.triggerMs) seg.done = false;
      }

      // Status log every 30s
      if (ms - lastLogTime > 30000) {
        lastLogTime = ms;
        const pending = activeSegments.filter(s => !s.done);
        if (pending.length) {
          console.log('[AutoSkip] At', (ms / 1000).toFixed(1) + 's |',
            pending.map(s => s.label + ' @' + (s.triggerMs / 1000).toFixed(1) + 's').join(', '));
        }
      }

      for (const seg of activeSegments) {
        if (seg.done) continue;
        // Trigger anywhere between start and end of the skip zone
        if (ms >= seg.triggerMs && ms < seg.seekTargetMs - 500) {
          console.log('[AutoSkip] Skipping', seg.label, 'at',
            (ms / 1000).toFixed(1) + 's -> ' + (seg.seekTargetMs / 1000).toFixed(1) + 's');

          const player = document.querySelector('#movie_player');
          if (player && typeof player.seekTo === 'function') {
            player.seekTo(seg.seekTargetMs / 1000, true);
          } else {
            video.currentTime = seg.seekTargetMs / 1000;
          }

          setTimeout(() => {
            const after = video.currentTime * 1000;
            if (after >= seg.seekTargetMs - 2000) {
              seg.done = true;
              const skipSec = Math.round((seg.seekTargetMs - seg.triggerMs) / 1000);
              console.log('[AutoSkip] Confirmed at', (after / 1000).toFixed(1) + 's');
              window.postMessage({ source: 'autoskip', type: 'skipped', seconds: skipSec, label: seg.label }, '*');
            } else {
              console.log('[AutoSkip] Seek failed, retrying...');
            }
          }, 500);
          break;
        }
      }
    };

    video.addEventListener('timeupdate', handler);
    attachedVideo = video;
    console.log('[AutoSkip] Handler attached |', activeSegments.length, 'segment(s)');
    return true;
  }

  function armSkip(newSegments) {
    if (!newSegments.length) return;

    // Merge, avoiding duplicates by full skip window and label.
    for (const seg of newSegments) {
      if (!activeSegments.some(s => s.triggerMs === seg.triggerMs && s.seekTargetMs === seg.seekTargetMs && s.label === seg.label)) {
        activeSegments.push({ ...seg, done: false });
      }
    }

    if (!attachHandlerIfReady()) {
      console.log('[AutoSkip] No <video> found yet; will attach when ready');
    }
  }

  function clearPendingRetryTimers() {
    for (const t of pendingRetryTimers) clearTimeout(t);
    pendingRetryTimers = [];
  }

  function scheduleProcessRetries() {
    clearPendingRetryTimers();
    const delays = [0, 400, 1000, 2000, 3500, 5500, 8000, 11000];
    for (const delay of delays) {
      const timer = setTimeout(() => {
        processAllSources();
        attachHandlerIfReady();
      }, delay);
      pendingRetryTimers.push(timer);
    }
  }

  function shouldInspectNetworkUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    if (!rawUrl.includes('/youtubei/v1/')) return false;
    return /\/youtubei\/v1\/(?:next|player|browse|updated_metadata|reel\/reel_item_watch)/.test(rawUrl);
  }

  function parseJsonPayload(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.replace(/^\uFEFF/, '').trimStart();
    if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;
    try { return JSON.parse(trimmed); } catch (_) { return null; }
  }

  function processNetworkPayload(url, payload) {
    if (!payload || typeof payload !== 'object') return;
    process(payload);
    attachHandlerIfReady();
  }

  function processAllSources() {
    const pageData = getPageData();
    const playerResponse = getPlayerResponse();
    const chapterPoints = collectDomChapterPoints();

    let jumpAhead = [];
    let chapters = [];
    let introSegments = [];

    refreshMusicGuard();
    if (isMusicVideo) return;

    if (settings.skipJumpAhead) {
      jumpAhead = [
        ...extractJumpAheadSegments(pageData),
        ...extractJumpAheadSegments(playerResponse),
      ];
    }

    if (settings.skipAdChapter) {
      const chapterSources = [
        ...extractChapterSegments(pageData),
        ...extractChapterSegments(playerResponse),
        ...extractChapterSegmentsFromPoints(chapterPoints),
      ];
      chapters = chapterSources;
    }

    introSegments = extractIntroSegmentsFromPoints(chapterPoints);

    if (jumpAhead.length && introSegments.length) {
      jumpAhead = jumpAhead.filter(seg => !introSegments.some(intro =>
        seg.triggerMs >= intro.triggerMs && seg.triggerMs < intro.seekTargetMs
      ));
    }

    // Ignore jump-ahead segments that trigger during the first video chapter
    const firstChapterEndAll = getFirstChapterEndMs(pageData, playerResponse);
    if (firstChapterEndAll != null && jumpAhead.length) {
      jumpAhead = jumpAhead.filter(seg => {
        if (seg.triggerMs < firstChapterEndAll) {
          console.log('[AutoSkip] Ignoring jump-ahead in first chapter:',
            seg.label, 'at', (seg.triggerMs / 1000).toFixed(1) + 's');
          return false;
        }
        return true;
      });
    }

    const all = [...jumpAhead, ...chapters];
    if (all.length) armSkip(all);
  }

  // ── Process a data payload ───────────────────────────────────────────────

  function process(data) {
    refreshMusicGuard();
    if (isMusicVideo) return;

    let jumpAhead = settings.skipJumpAhead ? extractJumpAheadSegments(data) : [];
    let chapters = [];
    try {
      chapters = settings.skipAdChapter ? extractChapterSegments(data) : [];
    } catch (e) {
      console.log('[AutoSkip] Chapter extraction error:', e);
    }

    // Ignore jump-ahead segments that trigger during the first video chapter
    const firstChapterEndNet = getFirstChapterEndMs(data, getPageData(), getPlayerResponse());
    if (firstChapterEndNet != null && jumpAhead.length) {
      jumpAhead = jumpAhead.filter(seg => {
        if (seg.triggerMs < firstChapterEndNet) {
          console.log('[AutoSkip] Ignoring jump-ahead in first chapter:',
            seg.label, 'at', (seg.triggerMs / 1000).toFixed(1) + 's');
          return false;
        }
        return true;
      });
    }

    const all = [...jumpAhead, ...chapters];
    if (all.length) armSkip(all);
  }

  // ── Reset on video change ────────────────────────────────────────────────

  function reset() {
    activeSegments = [];
    lastLogTime = -99999;
    clearPendingRetryTimers();
    if (handler && attachedVideo) {
      attachedVideo.removeEventListener('timeupdate', handler);
    }
    handler = null;
    attachedVideo = null;
  }

  // ── Triggers ─────────────────────────────────────────────────────────────

  // Publish initial music guard state as soon as possible.
  refreshMusicGuard();

  // 1. Initial page load — poll for ytInitialData
  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    const data = getPageData();
    const player = getPlayerResponse();
    if (data || player) {
      clearInterval(poll);
      console.log('[AutoSkip] Page data found (attempt ' + attempts + ')');
      processAllSources();
      attachHandlerIfReady();
    } else if (attempts > 50) {
      clearInterval(poll);
    }
  }, 200);

  // 2. SPA navigation — try immediately, then retry at 500ms + 1500ms
  document.addEventListener('yt-navigate-finish', () => {
    console.log('[AutoSkip] Navigation - resetting');
    reset();
    refreshMusicGuard();
    scheduleProcessRetries();
  });

  // Keep trying to attach if segments are known but the video element appears later.
  const rootObserver = new MutationObserver(() => {
    if (!activeSegments.length) return;
    const currentVideo = document.querySelector('video');
    if (!currentVideo) return;
    if (!handler || attachedVideo !== currentVideo) attachHandlerIfReady();
  });
  rootObserver.observe(document.documentElement || document, { childList: true, subtree: true });

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.source !== 'autoskip-config') return;
    if (e.data?.type !== 'settings') return;
    applySettings(e.data.settings);
  });

  // 3. Intercept /next API responses
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (shouldInspectNetworkUrl(url)) {
        resp.clone().text().then(raw => {
          const payload = parseJsonPayload(raw);
          if (payload) processNetworkPayload(url, payload);
        }).catch(() => {});
      }
    } catch (_) {}
    return resp;
  };

  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__autoskipUrl = typeof url === 'string' ? url : (url?.toString?.() || '');
    return origXHROpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        const url = this.__autoskipUrl || '';
        if (!shouldInspectNetworkUrl(url)) return;
        if (this.responseType === 'json' && this.response && typeof this.response === 'object') {
          processNetworkPayload(url, this.response);
          return;
        }
        if (this.responseType && this.responseType !== '' && this.responseType !== 'text') return;
        const payload = parseJsonPayload(typeof this.responseText === 'string' ? this.responseText : '');
        if (payload) processNetworkPayload(url, payload);
      } catch (_) {}
    });
    return origXHRSend.apply(this, args);
  };
})();
