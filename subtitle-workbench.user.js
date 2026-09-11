// ==UserScript==
// @name         字幕工作台
// @namespace    codex-local
// @version      3.0.0
// @description  提取、翻译并加载网页字幕；可拖动，贴边收成箭头
// @author       local
// @run-at       document-idle
// @grant        GM_setClipboard
//
// @match        *://*.youtube.com/*
// @match        *://youtu.be/*
// @match        *://*.youtube-nocookie.com/*
// @match        *://*.coursera.org/*
// @match        *://*.edx.org/*
// @match        *://*.khanacademy.org/*
// @match        *://*.udemy.com/*
// @match        *://*.udacity.com/*
// @match        *://*.skillshare.com/*
// @match        *://*.futurelearn.com/*
// @match        *://*.ted.com/*
// @match        *://*.linkedin.com/learning/*
// @match        *://*.vimeo.com/*
// @match        *://*.dailymotion.com/*
// @match        *://*.twitch.tv/*
// @match        *://*.netflix.com/*
// @match        *://*.hulu.com/*
// @match        *://*.disneyplus.com/*
// @match        *://*.primevideo.com/*
// @match        *://*.crunchyroll.com/*
// @match        *://*.nicovideo.jp/*
// @match        *://*.rumble.com/*
// @match        *://*.odysee.com/*
// @match        *://*.tiktok.com/*
// ==/UserScript==

(() => {
  'use strict';

  const PREFIX = 'codex-csw';
  if (document.getElementById(`${PREFIX}-launcher`)) return;

  // 判断当前是否为 YouTube
  function isYouTube() {
    return /(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$|^youtu\.be$/i.test(location.hostname);
  }

  // 从地址栏取当前 YouTube 视频 ID
  function youtubeVideoId() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      return location.pathname.match(/\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/)?.[1] || '';
    } catch (_) { return ''; }
  }

  const CACHE_PREFIX = `${PREFIX}:lesson:v1:`;
  const STYLE_KEY = `${PREFIX}:style:v1`;
  const LAUNCHER_KEY = `${PREFIX}:launcher:v1`;
  const PANEL_KEY = `${PREFIX}:panel:v1`;
  const DEFAULT_STYLE = { x: 0, y: 0, color: '#ffffff', weight: 600, size: 22 };
  const EDGE = 24;

  let sourceCues = [];
  let translatedCues = [];
  let translatedTrack = null;
  let overlayTimer = null;
  let activeVideo = null;
  let styleEditing = false;
  let currentLessonKey = '';
  let restoredLessonKey = '';
  let subtitleStyle = { ...DEFAULT_STYLE };

  // 按前缀取工作台内部元素
  const $ = id => document.getElementById(`${PREFIX}-${id}`);
  // 短暂等待
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 把数值限制在区间内
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  // 用 DOM API 建节点，避免 YouTube 的 TrustedHTML 拦截 innerHTML
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'className') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'id') n.id = v;
      else n.setAttribute(k, v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      n.append(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  // 读取 JSON 本地缓存
  function loadJson(key, fallback = {}) {
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
    catch (_) { return { ...fallback }; }
  }

  // 写入 JSON 本地缓存
  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  // 让元素可拖动；dockable 时靠近窗口边缘会收成箭头
  function enableDrag(el, opts = {}) {
    const handle = opts.handle || el;
    const pos = loadJson(opts.storeKey || '', {});
    let press = null, moved = false;

    // 按缓存坐标放置，贴边时变成箭头
    function apply() {
      if (el.style.display === 'none') return;
      const dock = opts.dockable && pos.dock;
      el.classList.toggle(`${PREFIX}-docked`, !!dock);
      if (dock) el.dataset.dock = dock; else delete el.dataset.dock;
      el.style.transform = 'none';
      el.style.right = el.style.bottom = 'auto';
      if (dock === 'left' || dock === 'right') {
        el.style.left = dock === 'left' ? '0px' : 'auto';
        el.style.right = dock === 'right' ? '0px' : 'auto';
        el.style.top = clamp(pos.y ?? innerHeight / 2 - 32, 8, innerHeight - 72) + 'px';
      } else if (dock === 'top' || dock === 'bottom') {
        el.style.top = dock === 'top' ? '0px' : 'auto';
        el.style.bottom = dock === 'bottom' ? '0px' : 'auto';
        el.style.left = clamp(pos.x ?? innerWidth / 2 - 32, 8, innerWidth - 72) + 'px';
      } else if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        const w = el.offsetWidth || 120, h = el.offsetHeight || 40;
        pos.x = clamp(pos.x, 0, innerWidth - w);
        pos.y = clamp(pos.y, 0, innerHeight - h);
        el.style.left = pos.x + 'px';
        el.style.top = pos.y + 'px';
      }
    }

    // 拖动中更新位置，从贴边状态拖出时先展开成完整按钮
    function onMove(e) {
      if (!press) return;
      const dx = e.clientX - press.cx, dy = e.clientY - press.cy;
      if (!moved && dx * dx + dy * dy < 25) return;
      if (el.classList.contains(`${PREFIX}-docked`)) {
        el.classList.remove(`${PREFIX}-docked`);
        delete el.dataset.dock;
        pos.dock = '';
        press = { cx: e.clientX, cy: e.clientY, x: e.clientX - el.offsetWidth / 2, y: e.clientY - el.offsetHeight / 2 };
      }
      moved = true;
      const w = el.offsetWidth, h = el.offsetHeight;
      pos.x = clamp(press.x + (e.clientX - press.cx), 0, innerWidth - w);
      pos.y = clamp(press.y + (e.clientY - press.cy), 0, innerHeight - h);
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
      el.style.right = el.style.bottom = 'auto';
      el.style.transform = 'none';
    }

    // 松手：未移动则点击；靠近边缘则贴边收成箭头
    function onUp() {
      if (!press) return;
      press = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) {
        if (opts.dockable && pos.dock) { pos.dock = ''; apply(); saveJson(opts.storeKey, pos); return; }
        opts.onClick?.();
        return;
      }
      const r = el.getBoundingClientRect();
      pos.x = r.left;
      pos.y = r.top;
      if (opts.dockable) {
        const nearest = [['left', r.left], ['right', innerWidth - r.right], ['top', r.top], ['bottom', innerHeight - r.bottom]]
          .sort((a, b) => a[1] - b[1])[0];
        pos.dock = nearest[1] < EDGE ? nearest[0] : '';
      }
      apply();
      if (opts.storeKey) saveJson(opts.storeKey, pos);
    }

    if (handle) handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const hit = e.target.closest && e.target.closest('button, input, textarea, select, a');
      if (hit && hit !== el && hit !== handle) return;
      if (opts.skip?.(e.target)) return;
      const r = el.getBoundingClientRect();
      press = { cx: e.clientX, cy: e.clientY, x: r.left, y: r.top };
      moved = false;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    window.addEventListener('resize', apply);
    apply();
    return { apply, pos };
  }

  const css = document.createElement('style');
  css.textContent = `
    #${PREFIX}-launcher { position:fixed; right:18px; bottom:90px; z-index:2147483646;
      border:0; border-radius:999px; padding:10px 15px; background:#1769e0; color:#fff;
      font:600 14px/1.2 system-ui,sans-serif; box-shadow:0 4px 18px rgba(0,0,0,.28);
      cursor:grab; user-select:none; touch-action:none; }
    #${PREFIX}-launcher:active { cursor:grabbing; }
    #${PREFIX}-launcher.${PREFIX}-docked { padding:0; overflow:hidden; font-size:0;
      box-shadow:0 2px 10px rgba(0,0,0,.25); text-align:center; }
    #${PREFIX}-launcher.${PREFIX}-docked::after { font:700 16px/1 system-ui; color:#fff; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="left"],
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="right"] { width:22px; height:64px; line-height:64px; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="top"],
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="bottom"] { width:64px; height:22px; line-height:22px; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="left"] { border-radius:0 10px 10px 0; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="left"]::after { content:"▶"; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="right"] { border-radius:10px 0 0 10px; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="right"]::after { content:"◀"; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="top"] { border-radius:0 0 10px 10px; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="top"]::after { content:"▼"; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="bottom"] { border-radius:10px 10px 0 0; }
    #${PREFIX}-launcher.${PREFIX}-docked[data-dock="bottom"]::after { content:"▲"; }
    #${PREFIX}-panel { position:fixed; left:max(4vw,calc(50vw - 450px)); top:5vh;
      width:min(900px,92vw); max-height:90vh; z-index:2147483647; display:none; overflow:auto;
      background:#fff; color:#172033; border:1px solid #ccd4e0; border-radius:12px;
      box-shadow:0 18px 60px rgba(0,0,0,.38); font:14px/1.45 system-ui,sans-serif; }
    #${PREFIX}-panel * { box-sizing:border-box; }
    #${PREFIX}-head { position:sticky; top:0; z-index:2; display:flex; justify-content:space-between;
      align-items:center; padding:13px 16px; background:#f6f8fb; border-bottom:1px solid #dde3ec; cursor:move; user-select:none; }
    #${PREFIX}-head strong { font-size:17px; }
    #${PREFIX}-body { padding:16px; }
    .${PREFIX}-row { display:flex; gap:8px; align-items:center; margin:9px 0; flex-wrap:wrap; }
    .${PREFIX}-row label { font-weight:600; }
    #${PREFIX}-panel button { border:1px solid #b8c4d6; border-radius:7px; padding:8px 12px;
      background:#fff; color:#172033; cursor:pointer; }
    #${PREFIX}-panel button.${PREFIX}-primary { background:#1769e0; border-color:#1769e0; color:#fff; }
    #${PREFIX}-panel #${PREFIX}-close { display:inline-flex; align-items:center; justify-content:center;
      width:36px; height:36px; padding:0; border:0; border-radius:8px; background:transparent;
      font-size:22px; line-height:1; color:#445; cursor:pointer; flex-shrink:0; }
    #${PREFIX}-panel input, #${PREFIX}-panel select, #${PREFIX}-panel textarea {
      border:1px solid #b8c4d6; border-radius:7px; padding:8px; font:13px/1.45 ui-monospace,Consolas,monospace; }
    #${PREFIX}-title { flex:1; min-width:280px; }
    #${PREFIX}-track { min-width:250px; }
    #${PREFIX}-panel textarea { width:100%; min-height:175px; resize:vertical; white-space:pre; }
    #${PREFIX}-status { padding:8px 10px; margin:9px 0; border-radius:7px; background:#edf5ff; color:#174d91; }
    #${PREFIX}-style-panel { position:fixed; right:26px; top:110px; z-index:2147483647; display:none;
      width:min(340px,90vw); padding:16px; border:1px solid rgba(255,255,255,.35); border-radius:12px;
      background:rgba(20,28,42,.76); color:#fff; box-shadow:0 12px 38px rgba(0,0,0,.35);
      backdrop-filter:blur(9px); font:14px/1.4 system-ui,sans-serif; cursor:move; user-select:none; }
    #${PREFIX}-style-panel h3 { margin:0 0 12px; font-size:17px; }
    #${PREFIX}-style-panel label { display:grid; grid-template-columns:95px 1fr 64px;
      align-items:center; gap:8px; margin:12px 0; cursor:default; }
    #${PREFIX}-style-panel input[type="range"] { width:100%; }
    #${PREFIX}-style-panel input[type="number"] { width:58px; padding:5px 3px; border:1px solid rgba(255,255,255,.45);
      border-radius:5px; background:rgba(255,255,255,.92); color:#182235; text-align:center; }
    #${PREFIX}-style-panel input[type="color"] { width:100%; height:34px; border:0; background:transparent; }
    #${PREFIX}-style-panel button { width:100%; margin-top:8px; padding:9px; border:0; border-radius:7px;
      background:#2f80ed; color:#fff; font-weight:700; cursor:pointer; }
    #${PREFIX}-subtitle { position:fixed; left:50%; bottom:13%; transform:translateX(-50%);
      z-index:2147483647 !important; display:none; max-width:85vw; padding:8px 18px; border-radius:5px;
      background:rgba(0,0,0,.76); color:#fff; text-align:center; white-space:pre-line;
      text-shadow:1px 1px 2px #000; font:22px/1.5 system-ui,sans-serif; pointer-events:none; }
    video::cue { color:#fff; background:rgba(0,0,0,.72); font-size:22px; }
  `;
  document.documentElement.appendChild(css);

  const launcher = document.createElement('button');
  launcher.id = `${PREFIX}-launcher`;
  launcher.textContent = '字幕工作台';

  const panel = el('section', { id: `${PREFIX}-panel` },
    el('div', { id: `${PREFIX}-head` },
      el('strong', { text: '字幕工作台' }),
      el('button', { id: `${PREFIX}-close`, title: '关闭', text: '×' })
    ),
    el('div', { id: `${PREFIX}-body` },
      el('div', { className: `${PREFIX}-row` },
        el('label', { for: `${PREFIX}-title`, text: '视频/课程标题' }),
        el('input', { id: `${PREFIX}-title` })
      ),
      el('div', { className: `${PREFIX}-row` },
        el('label', { for: `${PREFIX}-track`, text: '原字幕轨道' }),
        el('select', { id: `${PREFIX}-track` }),
        el('button', { id: `${PREFIX}-refresh`, text: '刷新轨道' }),
        el('button', { id: `${PREFIX}-extract`, className: `${PREFIX}-primary`, text: '识别原字幕' }),
        el('button', { id: `${PREFIX}-copy`, text: '复制“标题 + 提示词 + 字幕”' })
      ),
      el('div', { id: `${PREFIX}-status`, text: '请先播放视频，并在播放器中打开一种字幕。' }),
      el('label', { for: `${PREFIX}-source` }, el('b', { text: '提取到的原字幕' })),
      el('textarea', { id: `${PREFIX}-source`, placeholder: '识别后会在这里显示完整 SRT 字幕' }),
      el('div', { className: `${PREFIX}-row` }, el('b', { text: '把 AI 返回的完整 SRT/VTT 粘贴到下面，然后点击应用：' })),
      el('textarea', { id: `${PREFIX}-translated`, placeholder: '在这里粘贴翻译后的 SRT/VTT；即使外面带有 Markdown 代码块也可以识别' }),
      el('div', { className: `${PREFIX}-row` },
        el('button', { id: `${PREFIX}-paste`, text: '从剪贴板粘贴' }),
        el('button', { id: `${PREFIX}-apply`, className: `${PREFIX}-primary`, text: '应用到当前视频' }),
        el('button', { id: `${PREFIX}-style-open`, text: '调整字幕样式' }),
        el('button', { id: `${PREFIX}-clear`, text: '清空输入' })
      )
    )
  );

  const stylePanel = el('section', { id: `${PREFIX}-style-panel` },
    el('h3', { text: '调整字幕样式' }),
    el('label', {}, el('span', { text: 'X 偏移' }), el('input', { id: `${PREFIX}-style-x`, type: 'range', min: '-600', max: '600', step: '5' }), el('input', { id: `${PREFIX}-style-x-value`, type: 'number', min: '-600', max: '600', step: '1' })),
    el('label', {}, el('span', { text: 'Y 偏移' }), el('input', { id: `${PREFIX}-style-y`, type: 'range', min: '-300', max: '300', step: '5' }), el('input', { id: `${PREFIX}-style-y-value`, type: 'number', min: '-300', max: '300', step: '1' })),
    el('label', {}, el('span', { text: '字幕颜色' }), el('input', { id: `${PREFIX}-style-color`, type: 'color' }), el('output')),
    el('label', {}, el('span', { text: '字体粗细' }), el('input', { id: `${PREFIX}-style-weight`, type: 'range', min: '100', max: '900', step: '100' }), el('input', { id: `${PREFIX}-style-weight-value`, type: 'number', min: '100', max: '900', step: '100' })),
    el('label', {}, el('span', { text: '字体大小' }), el('input', { id: `${PREFIX}-style-size`, type: 'range', min: '14', max: '52', step: '1' }), el('input', { id: `${PREFIX}-style-size-value`, type: 'number', min: '14', max: '52', step: '1' })),
    el('button', { id: `${PREFIX}-style-done`, text: '完成并返回工作台' })
  );

  const overlay = document.createElement('div');
  overlay.id = `${PREFIX}-subtitle`;

  // 把工作台节点挂到指定容器
  function mountTo(host) {
    if (!host) return false;
    host.append(launcher, panel, stylePanel, overlay);
    return true;
  }
  if (!mountTo(document.body)) {
    const obs = new MutationObserver(() => { if (mountTo(document.body)) obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 选出当前页面最大/正在播放的 video
  function video() {
    return [...document.querySelectorAll('video')].sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return ((b.paused ? 0 : 1e9) + br.width * br.height) - ((a.paused ? 0 : 1e9) + ar.width * ar.height);
    })[0] || null;
  }

  // 更新状态栏文字
  function status(message) {
    const el = $('status');
    if (el) el.textContent = message;
  }

  // 生成当前课程/视频的缓存身份
  function lessonIdentity() {
    const yt = youtubeVideoId();
    if (yt) return `youtube::${yt}`;
    const path = location.pathname.replace(/\/+$/, '');
    const match = path.match(/^\/learn\/([^/]+)\/lecture\/([^/]+)(?:\/([^/]+))?/i);
    return match ? `${match[1]}::${match[2]}::${match[3] || ''}` : `${location.host}${path}`;
  }

  // 生成本集字幕缓存键
  function lessonCacheKey() { return CACHE_PREFIX + lessonIdentity(); }

  // 读取页面标题作为默认课程名
  function pageTitle() {
    const heading = ['h1.ytd-watch-metadata', '#title h1', 'h1.video-title',
      '[data-testid*="video-title"]', '[data-testid*="lesson-title"]', 'main h1', 'main h2', 'h1']
      .map(s => document.querySelector(s)?.textContent?.trim()).find(Boolean);
    return heading || document.title.replace(/\s*[|\-].*$/, '').trim() || '当前视频';
  }

  // 保存当前翻译字幕到本集缓存
  function saveCurrentLesson() {
    const subtitles = $('translated')?.value.trim();
    if (!subtitles) return false;
    try {
      localStorage.setItem(lessonCacheKey(), JSON.stringify({
        version: 1, identity: lessonIdentity(), url: location.href,
        title: $('title').value.trim() || pageTitle(), subtitles, savedAt: new Date().toISOString()
      }));
      return true;
    } catch (_) { return false; }
  }

  // 读取本集已缓存的翻译字幕
  function readCurrentLesson() {
    try { return JSON.parse(localStorage.getItem(lessonCacheKey()) || 'null'); }
    catch (_) { return null; }
  }

  // 载入字幕样式设置
  function loadSubtitleStyle() {
    subtitleStyle = loadJson(STYLE_KEY, DEFAULT_STYLE);
  }

  // 保存字幕样式设置
  function saveSubtitleStyle() { saveJson(STYLE_KEY, subtitleStyle); }

  // 把样式应用到浮层和控件
  function applySubtitleStyle() {
    Object.assign(overlay.style, { color: subtitleStyle.color, fontSize: `${subtitleStyle.size}px`, fontWeight: String(subtitleStyle.weight) });
    if (!$('style-x')) return;
    for (const k of ['x', 'y', 'weight', 'size']) {
      $(`style-${k}`).value = subtitleStyle[k];
      $(`style-${k}-value`).value = subtitleStyle[k];
    }
    $('style-color').value = subtitleStyle.color;
  }

  // 秒数转 SRT 时间轴
  function formatTime(seconds) {
    const msTotal = Math.max(0, Math.round(Number(seconds) * 1000));
    const h = Math.floor(msTotal / 3600000);
    const m = Math.floor((msTotal % 3600000) / 60000);
    const s = Math.floor((msTotal % 60000) / 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(msTotal % 1000).padStart(3,'0')}`;
  }

  // 把 cue 列表转成 SRT 文本
  function cuesToSrt(cues) {
    return cues.map((cue, i) => `${i + 1}\n${formatTime(cue.startTime ?? cue.start)} --> ${formatTime(cue.endTime ?? cue.end)}\n${String(cue.text || '').replace(/<[^>]+>/g, '').trim()}`).join('\n\n');
  }

  // 把 00:00:01,000 转成秒
  function toSeconds(value) {
    const parts = value.trim().replace(',', '.').split(':').map(Number);
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  // 解析 SRT / VTT 文本为 cue 列表
  function parseSubtitle(raw) {
    let text = String(raw || '').replace(/\r/g, '').replace(/^\s*```(?:srt|vtt|text)?\s*/i, '').replace(/\s*```\s*$/i, '');
    text = text.replace(/^WEBVTT[^\n]*\n/i, '');
    const lines = text.split('\n');
    const timing = /(\d{1,2}(?::\d{2}){1,2}[,.]\d{1,3})\s*-->\s*(\d{1,2}(?::\d{2}){1,2}[,.]\d{1,3})/;
    const cues = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(timing);
      if (!match) continue;
      const cueLines = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (timing.test(lines[j])) break;
        if (/^\s*\d+\s*$/.test(lines[j]) && timing.test(lines[j + 1] || '')) break;
        if (lines[j].trim()) cueLines.push(lines[j]);
      }
      const cueText = cueLines.join('\n').replace(/<[^>]+>/g, '').trim();
      if (cueText) cues.push({ start: toSeconds(match[1]), end: toSeconds(match[2]), text: cueText });
    }
    return cues;
  }

  // 把 1:23 / 1:02:03 转成秒
  function parseClock(value) {
    const parts = String(value || '').trim().split(':').map(Number);
    if (parts.some(n => !Number.isFinite(n))) return null;
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  // 从 YouTube「显示转录稿」面板刮取字幕
  function scrapeYoutubeTranscriptDom() {
    const nodes = [...document.querySelectorAll('ytd-transcript-segment-renderer')];
    const rows = nodes.map(node => {
      const stamp = (node.querySelector('[class*="timestamp"], .segment-timestamp')?.textContent || '').trim();
      const clock = stamp.match(/\d+:\d+(?::\d+)?/)?.[0] || '';
      const text = (node.querySelector('yt-formatted-string, [class*="segment-text"]')?.textContent || node.textContent || '')
        .replace(stamp, '').replace(/\s+/g, ' ').trim();
      return { start: parseClock(clock) ?? 0, text };
    }).filter(row => row.text);
    return rows.map((row, i) => ({
      start: row.start,
      end: rows[i + 1] ? Math.max(row.start + 0.4, rows[i + 1].start) : row.start + 3,
      text: row.text
    }));
  }

  // 点击页面上带「转录稿」字样的按钮
  function clickTranscriptControl() {
    const el = [...document.querySelectorAll('button, yt-button-shape button, ytd-button-renderer, ytd-menu-service-item-renderer, tp-yt-paper-item, yt-list-item-view-model')]
      .find(n => /transcript|转录|逐字稿|字幕文字稿|Show transcript|显示翻译文本/i.test(`${n.getAttribute('aria-label') || ''} ${n.textContent || ''}`));
    el?.click();
    return !!el;
  }

  // 打开 YouTube 转录稿后再刮取
  async function extractYoutubeTranscript() {
    let cues = scrapeYoutubeTranscriptDom();
    if (cues.length) return cues;
    document.querySelector('ytd-video-description-transcript-section-renderer button')?.click();
    await sleep(800);
    cues = scrapeYoutubeTranscriptDom();
    if (cues.length) return cues;
    document.querySelector('#actions ytd-menu-renderer button, button[aria-label="More actions"], button[aria-label="更多操作"]')?.click();
    await sleep(400);
    clickTranscriptControl();
    await sleep(1200);
    return scrapeYoutubeTranscriptDom();
  }

  // 列出当前视频的 HTML5 字幕轨道（排除本脚本写入的轨道）
  function listNativeTracks() {
    const v = video();
    if (!v) return [];
    return [...v.textTracks].filter(t => t !== translatedTrack && t.label !== 'AI 简体中文');
  }

  // 写入剪贴板
  async function clipboardWrite(text) {
    if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return; }
    try { await navigator.clipboard.writeText(text); return; } catch (_) {}
    const area = document.createElement('textarea');
    area.value = text; area.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
  }

  // 填充原字幕轨道下拉框
  function fillTrackSelect(select, nativeTracks) {
    select.replaceChildren();
    nativeTracks.forEach((track, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${track.label || '未命名'} / ${track.language || '未知语言'}（${track.cues?.length || 0} 条）`;
      select.appendChild(o);
    });
  }

  // 刷新当前页面可用字幕轨道
  async function refreshTracks() {
    const select = $('track');
    if (!select) return;
    if (isYouTube()) {
      const ready = scrapeYoutubeTranscriptDom().length;
      select.replaceChildren();
      const o = document.createElement('option');
      o.value = 'yt-transcript';
      o.textContent = ready ? `页面转录稿（已展开，约 ${ready} 条）` : '页面转录稿（请先打开「显示转录稿」）';
      select.appendChild(o);
      status(ready
        ? `已看到转录稿 ${ready} 条，点击“识别原字幕”即可提取。`
        : 'YouTube 请先打开视频下方「显示转录稿」，再点“识别原字幕”。');
      return;
    }
    const v = video();
    if (!v) { status('没有找到视频，请先打开视频页面并开始播放。'); return; }
    const tracks = listNativeTracks();
    for (const t of tracks) {
      try { if (t.mode === 'disabled') t.mode = 'hidden'; } catch (_) {}
    }
    await sleep(900);
    const withCues = tracks.filter(t => t.cues?.length);
    fillTrackSelect(select, withCues.length ? withCues : tracks);
    if (withCues.length) status(`发现 ${withCues.length} 条有内容的字幕轨道，请选择原语言后点击“识别原字幕”。`);
    else if (tracks.length) status(`找到 ${tracks.length} 条轨道但还没有字幕内容。请播放视频并打开播放器字幕，再点“刷新轨道”。`);
    else status('没有发现字幕轨道。请先在播放器中打开字幕，再点击“刷新轨道”。');
  }

  // 从 HTML5 textTracks 提取一条原生字幕
  async function extractNativeTrack(index) {
    const tracks = listNativeTracks();
    const withCues = tracks.filter(t => t.cues?.length);
    const list = withCues.length ? withCues : tracks;
    const track = list[index];
    if (!track) return [];
    try { track.mode = 'hidden'; } catch (_) {}
    await sleep(400);
    if (track.cues?.length) return [...track.cues].sort((a, b) => a.startTime - b.startTime);
    try { track.mode = 'showing'; } catch (_) {}
    await sleep(800);
    return track.cues?.length ? [...track.cues].sort((a, b) => a.startTime - b.startTime) : [];
  }

  // 把识别结果写入原文框
  function setSourceCues(cues, message) {
    sourceCues = cues;
    $('source').value = cuesToSrt(sourceCues);
    status(message);
  }

  // 识别当前选中的原字幕轨道
  async function extractSelectedTrack() {
    if (!$('track')?.options.length) await refreshTracks();
    $('title').value = pageTitle();
    if (isYouTube()) {
      status('正在从页面转录稿提取字幕……');
      const cues = await extractYoutubeTranscript();
      if (!cues.length) {
        status('没有读到转录稿。请先点视频下方「...」→「显示转录稿」，等文字出现后再识别。');
        return;
      }
      setSourceCues(cues, `已从转录稿识别 ${cues.length} 条字幕。`);
      return;
    }
    const cues = await extractNativeTrack(Number($('track')?.value || 0));
    if (!cues.length) { status('所选轨道没有可用字幕。请播放几秒、打开字幕后重新刷新。'); return; }
    setSourceCues(cues, `已识别 ${cues.length} 条字幕。`);
  }

  // 组装发给 AI 的「标题 + 提示词 + 原字幕」
  function aiPackage() {
    const title = $('title').value.trim() || pageTitle();
    const srt = $('source').value.trim();
    return `课程/视频标题：${title}\n\n请把下面的原字幕翻译成自然、准确的简体中文。要求：\n1. 完整保留所有字幕序号和时间轴，不增删时间段。\n2. 结合整集上下文翻译，不要逐词硬译；修复明显的断句、听写和机器翻译错误。\n3. 对技术名词、缩写、变量名和专有名词进行上下文核对；不易理解或没有可靠中文译名的词，保留英文并在必要时加简短中文说明。\n4. 前后术语必须统一，避免同一术语出现多个译法。\n5. 不要总结，不要解释处理过程，只返回可直接导入播放器的完整 SRT 内容。\n\n原字幕如下：\n\n${srt}`;
  }

  // 把翻译字幕装进 video 的原生 TextTrack
  function installNativeTrack(v) {
    if (translatedTrack) translatedTrack.mode = 'disabled';
    translatedTrack = v.addTextTrack('subtitles', 'AI 简体中文', 'zh-CN');
    translatedCues.forEach(cue => {
      const nativeCue = new VTTCue(cue.start, cue.end, cue.text);
      nativeCue.snapToLines = false; nativeCue.line = 85; nativeCue.position = 50; nativeCue.align = 'center';
      translatedTrack.addCue(nativeCue);
    });
    window.codexSubtitleTrack = translatedTrack;
    translatedTrack.mode = document.fullscreenElement === v ? 'showing' : 'hidden';
  }

  // 把字幕浮层对齐到当前视频画面
  function placeOverlay() {
    const v = activeVideo || video();
    if (!v || document.fullscreenElement === v) return;
    const host = document.fullscreenElement || document.body;
    if (overlay.parentElement !== host) host.appendChild(overlay);
    const rect = v.getBoundingClientRect();
    Object.assign(overlay.style, {
      position: 'fixed',
      left: `${rect.left + rect.width / 2 + subtitleStyle.x}px`,
      top: `${rect.bottom - Math.max(65, rect.height * 0.10) + subtitleStyle.y}px`,
      bottom: 'auto',
      transform: 'translate(-50%, -100%)',
      maxWidth: `${Math.max(280, rect.width * 0.88)}px`
    });
  }

  // 按当前播放时间刷新字幕浮层
  function renderOverlay() {
    const currentVideo = video();
    if (currentVideo && currentVideo !== activeVideo) {
      activeVideo = currentVideo;
      try { installNativeTrack(activeVideo); } catch (_) {}
    }
    const v = activeVideo;
    if (!v) return;
    const current = translatedCues.find(cue => v.currentTime >= cue.start && v.currentTime < cue.end);
    const hide = document.fullscreenElement === v;
    if (styleEditing) {
      placeOverlay();
      overlay.textContent = current?.text || '字幕样式预览：拖动滑块即可实时调整';
      overlay.style.display = hide ? 'none' : 'block';
      return;
    }
    if (!translatedCues.length) { overlay.style.display = 'none'; return; }
    overlay.textContent = current?.text || '';
    overlay.style.display = current && !hide ? 'block' : 'none';
    if (!hide) placeOverlay();
  }

  // 解析并应用翻译字幕到当前视频
  async function applyTranslated(options = {}) {
    const { save = true, silent = false } = options;
    try {
      const raw = $('translated').value;
      status(`正在解析字幕（${raw.length} 个字符）……`);
      await new Promise(r => requestAnimationFrame(r));
      const v = video();
      if (!v) throw new Error('没有找到当前视频');
      const parsed = parseSubtitle(raw);
      if (!parsed.length) throw new Error('没有识别出有效 SRT/VTT，请确认内容包含类似 00:00:01,000 --> 00:00:03,000 的时间轴');
      translatedCues = parsed;
      activeVideo = v;
      let nativeWarning = '';
      try { installNativeTrack(v); } catch (e) { nativeWarning = `；原生全屏轨道不可用：${e.message || e}`; }
      clearInterval(overlayTimer);
      overlayTimer = setInterval(renderOverlay, 100);
      if (save) saveCurrentLesson();
      renderOverlay();
      if (!silent) {
        const first = translatedCues[0], last = translatedCues[translatedCues.length - 1];
        status(`已应用 ${translatedCues.length} 条并保存。视频当前 ${v.currentTime.toFixed(1)} 秒；字幕范围 ${first.start.toFixed(1)}–${last.end.toFixed(1)} 秒${nativeWarning}。`);
      }
      return true;
    } catch (e) {
      status(`应用失败：${e.message || e}`);
      return false;
    }
  }

  // 恢复本集缓存，必要时自动应用到视频
  async function restoreCurrentLesson(autoApply = false) {
    const saved = readCurrentLesson();
    if (!saved?.subtitles) return false;
    $('translated').value = saved.subtitles;
    if (saved.title) $('title').value = saved.title;
    if (autoApply && video()) {
      if (await applyTranslated({ save: false, silent: true }))
        status(`已自动恢复并应用本集缓存（${new Date(saved.savedAt).toLocaleString()}）。`);
    } else status(`已恢复本集缓存（${new Date(saved.savedAt).toLocaleString()}），点击“应用到当前视频”即可。`);
    return true;
  }

  // 打开工作台面板并刷新轨道
  function openPanel() {
    panel.style.display = 'block';
    panelDrag.apply();
    if ($('title')) $('title').value = $('title').value || pageTitle();
    restoreCurrentLesson(false);
    refreshTracks();
  }

  // 给按钮绑定事件
  function bind(id, type, fn) {
    $(id)?.addEventListener(type, fn);
  }

  // 全屏切换时把 UI 挂到正确的根节点
  function mountUiInCurrentScreen() {
    const fs = document.fullscreenElement;
    const currentVideo = video() || activeVideo;
    if (currentVideo) activeVideo = currentVideo;
    (fs && fs !== currentVideo ? fs : document.body).append(launcher, panel, stylePanel);
    if (!fs) document.body.appendChild(overlay);
  }

  const closeBtn = panel.querySelector(`#${PREFIX}-close`);
  closeBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.stopImmediatePropagation(); });
  closeBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    panel.style.display = 'none';
  });

  const launcherDrag = enableDrag(launcher, { dockable: true, storeKey: LAUNCHER_KEY, onClick: openPanel });
  const panelDrag = enableDrag(panel, { handle: panel.querySelector(`#${PREFIX}-head`), storeKey: PANEL_KEY });
  enableDrag(stylePanel, { handle: stylePanel.querySelector('h3') });

  bind('refresh', 'click', refreshTracks);
  bind('extract', 'click', extractSelectedTrack);
  bind('copy', 'click', async () => {
    if (!$('source').value.trim()) await extractSelectedTrack();
    if (!$('source').value.trim()) return;
    await clipboardWrite(aiPackage());
    status('已复制“标题 + 翻译提示词 + 完整字幕”，现在可直接粘贴给豆包或其他模型。');
  });
  bind('paste', 'click', async () => {
    try { $('translated').value = await navigator.clipboard.readText(); status('已从剪贴板粘贴翻译结果。'); }
    catch (_) { status('浏览器拒绝读取剪贴板，请在输入框中手动按 Ctrl+V。'); $('translated').focus(); }
  });
  bind('apply', 'click', async e => {
    e.preventDefault();
    $('apply').disabled = true;
    try { await applyTranslated(); } finally { $('apply').disabled = false; }
  });
  bind('style-open', 'click', () => {
    activeVideo = video();
    if (!activeVideo) { status('没有找到当前视频。'); return; }
    styleEditing = true;
    panel.style.display = 'none';
    stylePanel.style.display = 'block';
    renderOverlay();
  });
  bind('style-color', 'input', () => {
    subtitleStyle.color = $('style-color').value;
    applySubtitleStyle(); saveSubtitleStyle(); renderOverlay();
  });
  bind('style-done', 'click', () => {
    styleEditing = false;
    stylePanel.style.display = 'none';
    panel.style.display = 'block';
    renderOverlay();
  });
  bind('clear', 'click', () => {
    $('source').value = ''; $('translated').value = ''; sourceCues = [];
    status('输入框已清空。');
  });

  for (const [name, limits] of Object.entries({ x: { min: -600, max: 600 }, y: { min: -300, max: 300 }, weight: { min: 100, max: 900 }, size: { min: 14, max: 52 } })) {
    const slider = $(`style-${name}`), number = $(`style-${name}-value`);
    if (!slider || !number) continue;
    const update = src => {
      if (src.value.trim() === '') return;
      const value = clamp(Number(src.value), limits.min, limits.max);
      if (!Number.isFinite(value)) return;
      slider.value = number.value = subtitleStyle[name] = value;
      applySubtitleStyle(); saveSubtitleStyle(); renderOverlay();
    };
    slider.addEventListener('input', () => update(slider));
    number.addEventListener('input', () => update(number));
    number.addEventListener('change', () => update(number));
  }

  document.addEventListener('fullscreenchange', () => {
    mountUiInCurrentScreen();
    if (translatedTrack) translatedTrack.mode = document.fullscreenElement === activeVideo ? 'showing' : 'hidden';
    setTimeout(renderOverlay, 50);
  });

  currentLessonKey = lessonCacheKey();
  loadSubtitleStyle();
  applySubtitleStyle();
  setInterval(() => {
    if (!css.isConnected) document.documentElement.appendChild(css);
    if (!launcher.isConnected || !panel.isConnected || !stylePanel.isConnected) document.body?.append(launcher, panel, stylePanel);
    const nextKey = lessonCacheKey();
    if (nextKey !== currentLessonKey) {
      currentLessonKey = nextKey;
      restoredLessonKey = '';
      if (translatedTrack) translatedTrack.mode = 'disabled';
      translatedTrack = null; translatedCues = []; activeVideo = null;
      overlay.style.display = 'none';
      if ($('source')) $('source').value = '';
      if ($('translated')) $('translated').value = '';
      if ($('title')) $('title').value = pageTitle();
    }
    if (restoredLessonKey !== nextKey && video()) {
      restoredLessonKey = nextKey;
      restoreCurrentLesson(true);
    }
  }, 1000);
})();
