// Runs in YouTube's page context (world: "MAIN", document_start).
// 1. Skips Jump ahead segments from timelyActionsOverlayViewModel
// 2. Skips chapters whose titles match ad/break/sponsor patterns

(function () {
  'use strict';

  const settings = {
    skipJumpAhead: true,
    skipAdChapter: true,
  };

  // ── Watch YouTube globals ─────────────────────────────────────────────
  // YouTube assigns ytInitialPlayerResponse / ytInitialData on page load
  // but may NOT update them during SPA navigation.  By installing property
  // setters BEFORE YouTube's code runs (we execute at document_start), we
  // can detect the exact moment a fresh value is assigned and immediately
  // trigger processing — no polling delay, no stale-data race.

  let _globalUpdateTimer = null;

  function onGlobalDataUpdated() {
    clearTimeout(_globalUpdateTimer);
    _globalUpdateTimer = setTimeout(() => {
      processAllSources();
      attachHandlerIfReady();
    }, 50);
  }

  function watchGlobal(prop) {
    let value = window[prop];
    try {
      Object.defineProperty(window, prop, {
        get() { return value; },
        set(newValue) {
          value = newValue;
          if (newValue && typeof newValue === 'object') onGlobalDataUpdated();
        },
        configurable: true,
        enumerable: true,
      });
    } catch (_) {}
  }

  watchGlobal('ytInitialData');
  watchGlobal('ytInitialPlayerResponse');

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
        const titleMatch = text.match(/[\p{L}][\p{L}\p{N}\s'&/\-]{1,}/u);
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
    }

    if (changed && isMusicVideo) reset();
  }

  // ── Language & Pattern Detection ────────────────────────────────────────

  const INTRO_CHAPTER_PATTERN = /\b(intro|introduction|opening|cold open|welcome)\b/i;
  const INTRO_AD_ALLOW_PATTERN = /\b(ad|sponsor|sponsored|promo|promotion|paid|commercial|partner(?:ship)?|brought to you by)\b/i;

  const LANG_PATTERNS = Object.freeze({
    en: {
      strong:  /\b(ad(?:vert(?:isement)?)?\s*break|commercial(?:\s*break)?|sponsor(?:ed|ship)?(?:\s*(?:segment|section|message))?|paid\s*(?:promotion|partnership)|brought to you by|in partnership with|brand deal|promo(?:tion)?|ad read|product placement)\b/i,
      weak:    /\b(partner(?:ship)?|message from|word from|thanks to)\b/i,
      context: /\b(sponsor|promo|paid|commercial|advert(?:isement)?)\b/i,
      exclude: /\b(spring break|coffee break|breakdown|adventure)\b/i,
    },
    es: {
      strong:  /\b(pausa\s*publicitaria|patrocinado|patrocinio|publicidad|segmento\s*patrocinado|promoci[oó]n\s*pagada|cortes[ií]a\s*de)\b/i,
      weak:    /\b(colaboraci[oó]n|anuncio|mensaje\s*de|gracias\s*a)\b/i,
      context: /\b(patrocin|promoci[oó]n|pagad[oa]|publicidad)\b/i,
      exclude: /\b(descanso|aventura|an[aá]lisis)\b/i,
    },
    pt: {
      strong:  /\b(intervalo\s*comercial|patrocinado|patroc[ií]nio|publicidade|publi|promo[cç][aã]o\s*paga|oferecimento)\b/i,
      weak:    /\b(parceria|an[uú]ncio|mensagem\s*de|apoio\s*de)\b/i,
      context: /\b(patroc[ií]n|promo[cç]|pag[oa]|comercial|publicidade)\b/i,
      exclude: /\b(descanso|aventura|an[aá]lise)\b/i,
    },
    de: {
      strong:  /\b(werbepause|werbung|gesponsert|bezahlte\s*werbung|anzeige|pr[aä]sentiert\s*von|in\s*zusammenarbeit\s*mit|dauerwerbesendung)\b/i,
      weak:    /\b(partnerschaft|nachricht\s*von|dank\s*an)\b/i,
      context: /\b(sponsor|werbung|bezahlt|anzeige)\b/i,
      exclude: /\b(abenteuer|zusammenbruch)\b/i,
    },
    fr: {
      strong:  /\b(coupure\s*pub|publicit[eé]|sponsoris[eé]|partenariat\s*pay[eé]|pr[eé]sent[eé]\s*par|placement\s*de\s*produit)\b/i,
      weak:    /\b(partenariat|message\s*de|merci\s*[aà])\b/i,
      context: /\b(sponsor|promo|pay[eé]|pub(?:licit[eé])?)\b/i,
      exclude: /\b(aventure|panne)\b/i,
    },
    ja: {
      strong:  /(広告|スポンサー|(?:^|[\s【「])CM(?:$|[\s】」])|プロモーション|タイアップ|案件)/,
      weak:    /(提供|協賛|提供元|協力|(?:^|[\s【「])PR(?:$|[\s】」]))/,
      context: /(広告|宣伝|プロモ|スポンサー)/,
      exclude: /(休憩|冒険)/,
    },
    ko: {
      strong:  /(광고|스폰서|협찬|유료\s*광고|프로모션|PPL|브랜드\s*콘텐츠)/,
      weak:    /(협력|제공)/,
      context: /(광고|홍보|프로모|스폰서|PPL)/,
      exclude: /(휴식|모험)/,
    },
  });

  let cachedLang = null;

  function detectVideoLanguage(playerResponse) {
    if (cachedLang) return cachedLang;

    const audioLang = playerResponse?.microformat?.playerMicroformatRenderer?.defaultAudioLanguage;
    if (audioLang) {
      const code = audioLang.substring(0, 2);
      if (LANG_PATTERNS[code]) { cachedLang = code; return code; }
    }

    const defaultLang = playerResponse?.microformat?.playerMicroformatRenderer?.defaultLanguage;
    if (defaultLang) {
      const code = defaultLang.substring(0, 2);
      if (LANG_PATTERNS[code]) { cachedLang = code; return code; }
    }

    cachedLang = 'en';
    return 'en';
  }

  // Exclude blocks weak matches only, not strong
  function matchesAdPatterns(t, p) {
    if (p.exclude.test(t)) return p.strong.test(t);
    return p.strong.test(t) || (p.weak.test(t) && p.context.test(t));
  }

  function isAdChapterTitle(title, lang) {
    if (!title || title.length > 200) return false;
    const t = title.trim();
    if (INTRO_CHAPTER_PATTERN.test(t) && !INTRO_AD_ALLOW_PATTERN.test(t)) return false;
    const patterns = LANG_PATTERNS[lang] || LANG_PATTERNS['en'];
    if (matchesAdPatterns(t, patterns)) return true;
    return lang !== 'en' && matchesAdPatterns(t, LANG_PATTERNS['en']);
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

    reset();
    processAllSources();
    attachHandlerIfReady();
  }

  // ── Extract Jump ahead segments ──────────────────────────────────────────

  // Caches keyed by data object; reset on navigation to prevent stale data.
  let jumpAheadCache = new WeakMap();
  let chapterCache = new WeakMap();

  function extractJumpAheadSegments(data) {
    if (!data || typeof data !== 'object') return [];
    if (jumpAheadCache.has(data)) return jumpAheadCache.get(data);
    const timelyVm = findDeep(data, 'timelyActionsOverlayViewModel');
    const timelyActions = timelyVm?.timelyActions || timelyVm?.timelyActionsOverlayViewModel?.timelyActions;
    if (!Array.isArray(timelyActions)) return [];

    const segments = [];
    for (const action of timelyActions) {
      const vm = action?.timelyActionViewModel;
      if (!vm) continue;
      const label = 'Jumped ahead';

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
      if (seekTargetMs && delta >= 2000 && delta <= 600000 && triggerMs >= 10000) {
        segments.push({ label, triggerMs, seekTargetMs });
      }
    }
    jumpAheadCache.set(data, segments);
    return segments;
  }

  // ── Extract chapter-break segments ──────────────────────────────────────

  function extractChapterSegments(data, lang) {
    if (!data || typeof data !== 'object') return [];
    if (chapterCache.has(data)) return chapterCache.get(data);
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

      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        if (!isAdChapterTitle(ch.title, lang)) continue;

        const nextChapter = chapters[i + 1];
        if (!nextChapter) continue;

        segments.push({
          label: 'Skipped ' + ch.title,
          triggerMs: ch.startMs,
          seekTargetMs: nextChapter.startMs,
        });
      }
    }

    chapterCache.set(data, segments);
    return segments;
  }

  function extractChapterSegmentsFromPoints(points, lang) {
    const segments = [];
    if (!Array.isArray(points) || points.length < 2) return segments;

    for (let i = 0; i < points.length - 1; i++) {
      const ch = points[i];
      const nextChapter = points[i + 1];
      if (!isAdChapterTitle(ch.title, lang)) continue;
      if (nextChapter.startMs <= ch.startMs) continue;

      segments.push({
        label: 'Skipped ' + ch.title,
        triggerMs: ch.startMs,
        seekTargetMs: nextChapter.startMs,
      });
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
        label: ch.title,
        triggerMs: ch.startMs,
        seekTargetMs: nextChapter.startMs,
      });
    }

    return segments;
  }

  // ── Arm the auto-skip handler ────────────────────────────────────────────

  let activeSegments = [];
  let handler = null;
  let attachedVideo = null;
  let pendingRetryTimers = [];
  let heartbeatInterval = null;
  let currentVideoId = null;

  function getCurrentVideoId() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('v') || null;
    } catch (_) { return null; }
  }

  const LISTEN_EVENTS = ['timeupdate', 'playing', 'seeked'];

  // Standalone skip-check — called by event listeners AND heartbeat
  function checkSkipPoints(video) {
    if (isMusicVideo || !video || video.paused || !activeSegments.length) return;
    const ms = video.currentTime * 1000;

    // Segments stay done once skipped — if the user seeks back, they
    // intentionally want to watch that section.  Segments only reset
    // on video navigation (reset() clears activeSegments entirely).

    for (const seg of activeSegments) {
      if (seg.done) continue;
      // Trigger anywhere between start and end of the skip zone
      if (ms >= seg.triggerMs && ms < seg.seekTargetMs - 500) {
        const fromSec = seg.triggerMs / 1000;
        const toSec = seg.seekTargetMs / 1000;

        // Tell content.js a data-driven skip is in progress so it doesn't
        // also click the DOM button for the same segment.
        window.postMessage({ source: 'autoskip', type: 'skip-in-progress', fromSec, toSec }, '*');

        const player = document.getElementById('movie_player');
        if (player && typeof player.seekTo === 'function') {
          player.seekTo(toSec, true);
        } else {
          video.currentTime = toSec;
        }

        setTimeout(() => {
          const after = video.currentTime * 1000;
          if (after >= seg.seekTargetMs - 2000) {
            seg.done = true;
            const skipSec = Math.round((after - ms) / 1000);
            window.postMessage({ source: 'autoskip', type: 'skipped', seconds: skipSec, label: seg.label, fromSec, toSec }, '*');
          }
        }, 500);
        break;
      }
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
      if (attachedVideo) checkSkipPoints(attachedVideo);
    }, 500);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  function detachHandler() {
    if (handler && attachedVideo) {
      for (const evt of LISTEN_EVENTS) attachedVideo.removeEventListener(evt, handler);
    }
  }

  function attachHandlerIfReady() {
    const video = document.querySelector('video');
    if (!video) return false;

    if (handler && attachedVideo === video) return true;

    detachHandler();

    handler = () => checkSkipPoints(video);

    for (const evt of LISTEN_EVENTS) video.addEventListener(evt, handler);
    startHeartbeat();
    attachedVideo = video;
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

    attachHandlerIfReady();
  }

  function clearPendingRetryTimers() {
    for (const t of pendingRetryTimers) clearTimeout(t);
    pendingRetryTimers = [];
  }

  let backgroundPoll = null;
  let backgroundPollStart = 0;

  function scheduleProcessRetries() {
    clearPendingRetryTimers();
    stopBackgroundPoll();

    // Fast burst for the first 20s after navigation
    const delays = [0, 300, 600, 1000, 1500, 2000, 3000, 5000, 8000, 11000, 15000, 20000];
    for (const delay of delays) {
      const timer = setTimeout(() => {
        processAllSources();
        attachHandlerIfReady();
      }, delay);
      pendingRetryTimers.push(timer);
    }

    // Background poll for 60s — catches data that arrives late.
    // processAllSources() uses WeakMap caches so re-processing is free.
    backgroundPollStart = Date.now();
    backgroundPoll = setInterval(() => {
      if (Date.now() - backgroundPollStart > 60000) { stopBackgroundPoll(); return; }
      processAllSources();
      attachHandlerIfReady();
    }, 3000);
  }

  function stopBackgroundPoll() {
    if (backgroundPoll) { clearInterval(backgroundPoll); backgroundPoll = null; }
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
    const lang = detectVideoLanguage(playerResponse);

    // Check if the global data objects belong to the current video.
    // If stale, skip the globals but STILL process DOM chapters —
    // those always reflect the current video.
    const urlVideoId = getCurrentVideoId();
    const dataVideoId = playerResponse?.videoDetails?.videoId || null;
    const globalsStale = urlVideoId && dataVideoId && urlVideoId !== dataVideoId;

    let jumpAhead = [];
    let chapters = [];
    let introSegments = [];

    refreshMusicGuard();
    if (isMusicVideo) return;

    if (settings.skipJumpAhead && !globalsStale) {
      jumpAhead = [
        ...extractJumpAheadSegments(pageData),
        ...extractJumpAheadSegments(playerResponse),
      ];
    }

    if (settings.skipAdChapter) {
      if (!globalsStale) {
        chapters = [
          ...extractChapterSegments(pageData, lang),
          ...extractChapterSegments(playerResponse, lang),
        ];
      }
      // DOM chapters are always for the current video — process regardless.
      chapters = [...chapters, ...extractChapterSegmentsFromPoints(chapterPoints, lang)];
    }

    introSegments = extractIntroSegmentsFromPoints(chapterPoints);

    // Drop jump-ahead segments whose trigger falls inside an ad chapter
    // or intro zone — ad chapters know exact boundaries, and intros should
    // not be skipped by jump-ahead.
    const excludeZones = [...chapters, ...introSegments];
    if (jumpAhead.length && excludeZones.length) {
      jumpAhead = jumpAhead.filter(seg => !excludeZones.some(z =>
        seg.triggerMs >= z.triggerMs && seg.triggerMs < z.seekTargetMs
      ));
    }

    const all = [...chapters, ...jumpAhead];
    if (all.length) armSkip(all);
  }

  // ── Process a data payload ───────────────────────────────────────────────

  function process(data) {
    refreshMusicGuard();
    if (isMusicVideo) return;

    const lang = detectVideoLanguage(getPlayerResponse());
    let jumpAhead = settings.skipJumpAhead ? extractJumpAheadSegments(data) : [];
    let chapters = [];
    try {
      chapters = settings.skipAdChapter ? extractChapterSegments(data, lang) : [];
    } catch (_) {}

    const all = [...jumpAhead, ...chapters];
    if (all.length) armSkip(all);
  }

  // ── Reset on video change ────────────────────────────────────────────────

  function reset() {
    currentVideoId = getCurrentVideoId();
    activeSegments = [];
    cachedLang = null;
    isMusicVideo = false;
    hasSentMusicState = false;
    jumpAheadCache = new WeakMap();
    chapterCache = new WeakMap();
    clearPendingRetryTimers();
    stopBackgroundPoll();
    stopHeartbeat();
    detachHandler();
    handler = null;
    attachedVideo = null;
  }

  // Deduplicated navigation handler — used by all navigation triggers.
  function onVideoChange() {
    reset();
    refreshMusicGuard();
    scheduleProcessRetries();
  }

  // ── Triggers ─────────────────────────────────────────────────────────────

  // Publish initial music guard state as soon as possible.
  refreshMusicGuard();

  // 1. Initial page load — poll for ytInitialData
  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    if (getPageData() || getPlayerResponse()) {
      clearInterval(poll);
      processAllSources();
      attachHandlerIfReady();
    } else if (attempts > 50) {
      clearInterval(poll);
    }
  }, 200);

  // 2. SPA navigation
  document.addEventListener('yt-navigate-finish', () => {
    onVideoChange();
  });

  // 3. YouTube data-ready events
  for (const evt of [
    'yt-page-data-updated',
    'yt-navigate-cache-hit',
    'yt-player-updated',
    'yt-page-data-fetched',
    'yt-navigate-redirect',
  ]) {
    document.addEventListener(evt, () => {
      processAllSources();
      attachHandlerIfReady();
    });
  }

  // 4. Track video element lifecycle — detects replacements and new loads.
  let monitoredVideo = null;

  function monitorVideoElement() {
    const video = document.querySelector('video');
    if (!video || video === monitoredVideo) return;

    monitoredVideo = video;
    video.addEventListener('loadedmetadata', () => {
      const newId = getCurrentVideoId();
      if (newId && newId !== currentVideoId) {
        onVideoChange();
      } else {
        attachHandlerIfReady();
      }
    });

    attachHandlerIfReady();
  }

  // Re-attach when video element appears or is replaced.
  let lastObservedVideo = null;
  const rootObserver = new MutationObserver(() => {
    const currentVideo = document.querySelector('video');
    if (!currentVideo || currentVideo === lastObservedVideo) return;
    lastObservedVideo = currentVideo;
    monitorVideoElement();
    if (!handler || attachedVideo !== currentVideo) attachHandlerIfReady();
  });
  rootObserver.observe(document.documentElement || document, { childList: true, subtree: true });

  // 5. Intercept history.pushState / replaceState
  function onHistoryChange() {
    const newId = getCurrentVideoId();
    if (newId && newId !== currentVideoId) onVideoChange();
  }

  for (const method of ['pushState', 'replaceState']) {
    const orig = history[method];
    history[method] = function (...args) {
      const result = orig.apply(this, args);
      onHistoryChange();
      return result;
    };
  }
  window.addEventListener('popstate', onHistoryChange);

  // 6. URL-change polling — ultimate fallback
  let lastPolledVideoId = getCurrentVideoId();
  setInterval(() => {
    const newId = getCurrentVideoId();
    if (newId && newId !== lastPolledVideoId) {
      lastPolledVideoId = newId;
      if (newId !== currentVideoId) onVideoChange();
    }
  }, 2000);

  // Settings from content.js
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.origin !== 'https://www.youtube.com') return;
    if (e.data?.source !== 'autoskip-config') return;
    if (e.data?.type !== 'settings') return;
    applySettings(e.data.settings);
  });

  // 7. Intercept /next, /player API responses
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
