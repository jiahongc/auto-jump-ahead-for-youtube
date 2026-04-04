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

  // ── Watch YouTube globals ─────────────────────────────────────────────
  // YouTube assigns ytInitialPlayerResponse / ytInitialData on page load
  // but may NOT update them during SPA navigation.  By installing property
  // setters BEFORE YouTube's code runs (we execute at document_start), we
  // can detect the exact moment a fresh value is assigned and immediately
  // trigger processing — no polling delay, no stale-data race.

  let _globalUpdateTimer = null;

  function onGlobalDataUpdated(prop) {
    console.log('[AutoSkip] Global', prop, 'updated — scheduling process');
    clearTimeout(_globalUpdateTimer);
    _globalUpdateTimer = setTimeout(() => {
      if (typeof processAllSources === 'function') {
        processAllSources();
        attachHandlerIfReady();
      }
    }, 50);
  }

  function watchGlobal(prop) {
    let value = window[prop];
    try {
      Object.defineProperty(window, prop, {
        get() { return value; },
        set(newValue) {
          value = newValue;
          if (newValue && typeof newValue === 'object') onGlobalDataUpdated(prop);
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {
      console.log('[AutoSkip] Could not watch', prop, ':', e);
    }
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
    // Debug: show raw title bytes so we can see exact characters
    const codePoints = [...title].map(ch => {
      const cp = ch.codePointAt(0);
      return cp > 127 ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : ch;
    }).join('');
    console.log('[AutoSkip][DEBUG] Chapter renderer title:', JSON.stringify(title),
      '| codepoints:', codePoints, '| startMs:', startMs);
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
      const elements = document.querySelectorAll(sel);
      if (elements.length) {
        console.log('[AutoSkip][DEBUG] DOM selector', JSON.stringify(sel), 'matched', elements.length, 'element(s)');
      }
      for (const el of elements) {
        const rawText = el.textContent || '';
        const text = rawText.replace(/\s+/g, ' ').trim();
        if (!text) continue;

        const timeMatch = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/);
        const titleMatch = text.match(/[\p{L}][\p{L}\p{N}\s'&/\-]{1,}/u);

        // Log every DOM element we inspect so we can see raw text
        const codePoints = [...text].map(ch => {
          const cp = ch.codePointAt(0);
          return cp > 127 ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : ch;
        }).join('');
        console.log('[AutoSkip][DEBUG] DOM element text:', JSON.stringify(text),
          '| codepoints:', codePoints,
          '| timeMatch:', timeMatch?.[0] || 'none',
          '| titleMatch:', titleMatch?.[0] || 'none');

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
    if (!title || title.length > 200) {
      console.log('[AutoSkip][DEBUG] isAdChapterTitle SKIP: empty or too long', JSON.stringify(title));
      return false;
    }
    const t = title.trim();
    if (INTRO_CHAPTER_PATTERN.test(t) && !INTRO_AD_ALLOW_PATTERN.test(t)) {
      console.log('[AutoSkip][DEBUG] isAdChapterTitle INTRO (not ad):', JSON.stringify(t));
      return false;
    }
    const patterns = LANG_PATTERNS[lang] || LANG_PATTERNS['en'];
    const strongMatch = patterns.strong.test(t);
    const weakMatch = patterns.weak.test(t);
    const contextMatch = patterns.context.test(t);
    const excludeMatch = patterns.exclude.test(t);
    const result = matchesAdPatterns(t, patterns) || (lang !== 'en' && matchesAdPatterns(t, LANG_PATTERNS['en']));
    console.log('[AutoSkip][DEBUG] isAdChapterTitle:', JSON.stringify(t),
      '| lang:', lang, '| strong:', strongMatch, '| weak:', weakMatch,
      '| context:', contextMatch, '| exclude:', excludeMatch, '| => AD:', result);
    return result;
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

      console.log('[AutoSkip] Chapters found:', chapters.map(c => '"' + c.title + '" @' + (c.startMs / 1000).toFixed(0) + 's').join(', '));

      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        if (!isAdChapterTitle(ch.title, lang)) continue;

        const nextChapter = chapters[i + 1];
        if (!nextChapter) continue;

        segments.push({
          label: ch.title,
          triggerMs: ch.startMs,
          seekTargetMs: nextChapter.startMs,
        });
        console.log('[AutoSkip] Break chapter:', '"' + ch.title + '"',
          (ch.startMs / 1000).toFixed(1) + 's ->', (nextChapter.startMs / 1000).toFixed(1) + 's');
      }
    }

    chapterCache.set(data, segments);
    return segments;
  }

  function extractChapterSegmentsFromPoints(points, lang) {
    const segments = [];
    if (!Array.isArray(points) || points.length < 2) return segments;

    console.log('[AutoSkip] DOM chapters found:', points.map(c => '"' + c.title + '" @' + (c.startMs / 1000).toFixed(0) + 's').join(', '));

    for (let i = 0; i < points.length - 1; i++) {
      const ch = points[i];
      const nextChapter = points[i + 1];
      if (!isAdChapterTitle(ch.title, lang)) continue;
      if (nextChapter.startMs <= ch.startMs) continue;

      segments.push({
        label: ch.title,
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
  let lastLogTime = -99999;
  let pendingRetryTimers = [];
  let heartbeatInterval = null;
  let currentVideoId = null;

  function getCurrentVideoId() {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('v') || null;
    } catch (_) { return null; }
  }

  const LISTEN_EVENTS = ['timeupdate', 'playing', 'seeked'];

  // Standalone skip-check — called by event listeners AND heartbeat
  let checkSkipCallCount = 0;

  function checkSkipPoints(video) {
    checkSkipCallCount++;
    const dbg = checkSkipCallCount % 20 === 1; // log every 20th call (~10s)

    if (isMusicVideo) { if (dbg) console.log('[AutoSkip][injected] checkSkip BLOCKED: isMusicVideo'); return; }
    if (!video) { if (dbg) console.log('[AutoSkip][injected] checkSkip BLOCKED: no video element'); return; }
    if (video.paused) { if (dbg) console.log('[AutoSkip][injected] checkSkip: video paused'); return; }
    if (!activeSegments.length) {
      if (dbg) console.log('[AutoSkip][injected] checkSkip: no active segments | handler attached:', !!handler);
      return;
    }
    const ms = video.currentTime * 1000;

    // Segments stay done once skipped — if the user seeks back, they
    // intentionally want to watch that section.  Segments only reset
    // on video navigation (reset() clears activeSegments entirely).

    // Status log every 10s (more frequent for debugging)
    if (ms - lastLogTime > 10000) {
      lastLogTime = ms;
      const pending = activeSegments.filter(s => !s.done);
      console.log('[AutoSkip][injected] At', (ms / 1000).toFixed(1) + 's |',
        'segments:', activeSegments.length,
        '| pending:', pending.length,
        '| next:', pending.length ? pending[0].label + ' @' + (pending[0].triggerMs / 1000).toFixed(1) + 's' : 'none');
    }

    for (const seg of activeSegments) {
      if (seg.done) continue;
      // Trigger anywhere between start and end of the skip zone
      if (ms >= seg.triggerMs && ms < seg.seekTargetMs - 500) {
        console.log('[AutoSkip] Skipping', seg.label, 'at',
          (ms / 1000).toFixed(1) + 's -> ' + (seg.seekTargetMs / 1000).toFixed(1) + 's');

        // Tell content.js a data-driven skip is in progress so it doesn't
        // also click the DOM button for the same segment.
        window.postMessage({ source: 'autoskip', type: 'skip-in-progress' }, '*');

        const player = document.getElementById('movie_player');
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
  }

  function startHeartbeat() {
    stopHeartbeat();
    // Re-query video each tick to survive DOM replacements
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

    // Background poll for 60s — catches data that arrives late via global
    // variable updates or delayed API responses.  Runs regardless of whether
    // segments have already been found (more may arrive later, e.g. chapters
    // after jump-ahead data).  processAllSources() uses WeakMap caches so
    // re-processing the same data objects is essentially free.
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
    // If stale, skip the globals but STILL process DOM chapters and
    // network-intercepted payloads — those may already be correct.
    const urlVideoId = getCurrentVideoId();
    const dataVideoId = playerResponse?.videoDetails?.videoId || null;
    const pageDataVideoId = findDeep(pageData, 'videoId', 0);
    const globalsStale = urlVideoId && dataVideoId && urlVideoId !== dataVideoId;

    console.log('[AutoSkip][DEBUG] processAllSources:',
      '| pageData:', !!pageData,
      '| playerResponse:', !!playerResponse,
      '| domChapterPoints:', chapterPoints.length,
      '| lang:', lang,
      '| isMusicVideo:', isMusicVideo,
      '| urlVideoId:', urlVideoId,
      '| dataVideoId:', dataVideoId,
      '| globalsStale:', globalsStale,
      '| settings:', JSON.stringify(settings));

    let jumpAhead = [];
    let chapters = [];
    let introSegments = [];

    refreshMusicGuard();
    if (isMusicVideo) return;

    if (settings.skipJumpAhead) {
      // Only extract from globals if they belong to the current video.
      if (!globalsStale) {
        jumpAhead = [
          ...extractJumpAheadSegments(pageData),
          ...extractJumpAheadSegments(playerResponse),
        ];
      }
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

    if (jumpAhead.length && introSegments.length) {
      jumpAhead = jumpAhead.filter(seg => !introSegments.some(intro =>
        seg.triggerMs >= intro.triggerMs && seg.triggerMs < intro.seekTargetMs
      ));
    }

    const all = [...jumpAhead, ...chapters];
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
      // Also check DOM chapters — network payloads may not contain chapter
      // data when it's only available via the rendered page.
      if (settings.skipAdChapter) {
        const domPoints = collectDomChapterPoints();
        if (domPoints.length) {
          chapters = [...chapters, ...extractChapterSegmentsFromPoints(domPoints, lang)];
        }
      }
    } catch (e) {
      console.log('[AutoSkip] Chapter extraction error:', e);
    }

    const all = [...jumpAhead, ...chapters];
    if (all.length) armSkip(all);
  }

  // ── Reset on video change ────────────────────────────────────────────────

  function reset() {
    const oldVideoId = currentVideoId;
    currentVideoId = getCurrentVideoId();
    console.log('[AutoSkip][DEBUG] reset(): video changed', oldVideoId, '->', currentVideoId,
      '| clearing', activeSegments.length, 'segment(s)');
    activeSegments = [];
    lastLogTime = -99999;
    cachedLang = null;
    // Reset music guard so it doesn't persist from a previous music video
    isMusicVideo = false;
    hasSentMusicState = false;
    // Replace caches so stale ytInitialData from previous video can't return old results
    jumpAheadCache = new WeakMap();
    chapterCache = new WeakMap();
    clearPendingRetryTimers();
    stopBackgroundPoll();
    stopHeartbeat();
    detachHandler();
    handler = null;
    attachedVideo = null;
  }

  // ── Triggers ─────────────────────────────────────────────────────────────

  // Publish initial music guard state as soon as possible.
  refreshMusicGuard();

  // Debug heartbeat — logs overall state every 10s so we can see if
  // data was found, handler is attached, segments exist, etc.
  setInterval(() => {
    const video = document.querySelector('video');
    console.log('[AutoSkip][injected] HEARTBEAT |',
      'videoId:', currentVideoId,
      '| segments:', activeSegments.length,
      '| pending:', activeSegments.filter(s => !s.done).length,
      '| handler:', !!handler,
      '| attachedVideo:', !!attachedVideo,
      '| isMusicVideo:', isMusicVideo,
      '| videoEl:', !!video,
      '| paused:', video?.paused,
      '| time:', video ? (video.currentTime).toFixed(1) + 's' : 'n/a',
      '| settings:', JSON.stringify(settings));
  }, 10000);

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

  // 2. SPA navigation — try immediately, then retry with background poll
  document.addEventListener('yt-navigate-finish', () => {
    const newId = getCurrentVideoId();
    console.log('[AutoSkip] Navigation - resetting for video:', newId,
      '| previous:', currentVideoId,
      '| old segments:', activeSegments.length);
    reset();
    refreshMusicGuard();
    scheduleProcessRetries();
  });

  // 3. YouTube data-ready events — fire when YouTube updates page data
  //    after the initial load (e.g. late metadata, player state changes).
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

  // Track video element lifecycle — detects replacements and new loads.
  let monitoredVideo = null;

  function monitorVideoElement() {
    const video = document.querySelector('video');
    if (!video || video === monitoredVideo) return;

    monitoredVideo = video;
    video.addEventListener('loadedmetadata', () => {
      console.log('[AutoSkip] Video loadedmetadata fired');
      const newId = getCurrentVideoId();
      if (newId && newId !== currentVideoId) {
        reset();
        refreshMusicGuard();
        scheduleProcessRetries();
      } else {
        // Same video (e.g. quality change) — just re-attach handler.
        attachHandlerIfReady();
      }
    });

    // Re-attach handler immediately if we have pending segments.
    attachHandlerIfReady();
  }

  // Keep trying to attach when video element appears or is replaced —
  // no longer gated on activeSegments so handler is ready before data arrives.
  const rootObserver = new MutationObserver(() => {
    const currentVideo = document.querySelector('video');
    if (!currentVideo) return;
    monitorVideoElement();
    if (!handler || attachedVideo !== currentVideo) attachHandlerIfReady();
  });
  rootObserver.observe(document.documentElement || document, { childList: true, subtree: true });

  // 4. Intercept history.pushState / replaceState — YouTube uses these for
  //    SPA navigation, and yt-navigate-finish can be delayed or skipped.
  function onHistoryChange() {
    const newId = getCurrentVideoId();
    if (newId && newId !== currentVideoId) {
      console.log('[AutoSkip] History change detected:', currentVideoId, '->', newId);
      reset();
      refreshMusicGuard();
      scheduleProcessRetries();
    }
  }

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    const result = origPushState.apply(this, args);
    onHistoryChange();
    return result;
  };
  history.replaceState = function (...args) {
    const result = origReplaceState.apply(this, args);
    onHistoryChange();
    return result;
  };
  window.addEventListener('popstate', onHistoryChange);

  // 5. URL-change polling — ultimate fallback in case all event-driven
  //    navigation detection fails (e.g. YouTube changes its SPA mechanism).
  let lastPolledVideoId = getCurrentVideoId();
  setInterval(() => {
    const newId = getCurrentVideoId();
    if (newId && newId !== lastPolledVideoId) {
      lastPolledVideoId = newId;
      if (newId !== currentVideoId) {
        console.log('[AutoSkip] URL poll detected video change:', currentVideoId, '->', newId);
        reset();
        refreshMusicGuard();
        scheduleProcessRetries();
      }
    }
  }, 2000);

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.origin !== 'https://www.youtube.com') return;
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
