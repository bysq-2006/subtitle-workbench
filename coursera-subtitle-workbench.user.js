// ==UserScript==
// @name         Coursera 字幕工作台
// @namespace    codex-local
// @version      2.3.0
// @description  提取、翻译并加载 Coursera 字幕；按课程集数自动缓存，支持普通与全屏播放
// @match        https://www.coursera.org/*
// @run-at       document-idle
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  'use strict';

  const PREFIX = 'codex-csw';
  if (document.getElementById(`${PREFIX}-launcher`)) return;

  let sourceCues = [];
  let translatedCues = [];
  let translatedTrack = null;
  let overlayTimer = null;
  let activeVideo = null;
  let styleEditing = false;
  let currentLessonKey = '';
  let restoredLessonKey = '';
  const CACHE_PREFIX = `${PREFIX}:lesson:v1:`;
  const STYLE_KEY = `${PREFIX}:style:v1`;
  const DEFAULT_STYLE = { x: 0, y: 0, color: '#ffffff', weight: 600, size: 22 };
  let subtitleStyle = { ...DEFAULT_STYLE };

  const css = document.createElement('style');
  css.textContent = `
    #${PREFIX}-launcher { position:fixed; right:18px; bottom:90px; z-index:2147483646;
      border:0; border-radius:999px; padding:10px 15px; background:#1769e0; color:#fff;
      font:600 14px/1.2 system-ui,sans-serif; box-shadow:0 4px 18px rgba(0,0,0,.28); cursor:pointer; }
    #${PREFIX}-panel { position:fixed; inset:5vh auto auto 50%; transform:translateX(-50%);
      width:min(900px,92vw); max-height:90vh; z-index:2147483647; display:none; overflow:auto;
      background:#fff; color:#172033; border:1px solid #ccd4e0; border-radius:12px;
      box-shadow:0 18px 60px rgba(0,0,0,.38); font:14px/1.45 system-ui,sans-serif; }
    #${PREFIX}-panel * { box-sizing:border-box; }
    #${PREFIX}-head { position:sticky; top:0; z-index:2; display:flex; justify-content:space-between;
      align-items:center; padding:13px 16px; background:#f6f8fb; border-bottom:1px solid #dde3ec; }
    #${PREFIX}-head strong { font-size:17px; }
    #${PREFIX}-close { border:0; background:transparent; font-size:24px; cursor:pointer; }
    #${PREFIX}-body { padding:16px; }
    .${PREFIX}-row { display:flex; gap:8px; align-items:center; margin:9px 0; flex-wrap:wrap; }
    .${PREFIX}-row label { font-weight:600; }
    #${PREFIX}-panel button { border:1px solid #b8c4d6; border-radius:7px; padding:8px 12px;
      background:#fff; color:#172033; cursor:pointer; }
    #${PREFIX}-panel button.${PREFIX}-primary { background:#1769e0; border-color:#1769e0; color:#fff; }
    #${PREFIX}-panel input, #${PREFIX}-panel select, #${PREFIX}-panel textarea {
      border:1px solid #b8c4d6; border-radius:7px; padding:8px; font:13px/1.45 ui-monospace,Consolas,monospace; }
    #${PREFIX}-title { flex:1; min-width:280px; }
    #${PREFIX}-track { min-width:250px; }
    #${PREFIX}-panel textarea { width:100%; min-height:175px; resize:vertical; white-space:pre; }
    #${PREFIX}-status { padding:8px 10px; margin:9px 0; border-radius:7px; background:#edf5ff; color:#174d91; }
    #${PREFIX}-style-panel { position:fixed; right:26px; top:110px; z-index:2147483647; display:none;
      width:min(340px,90vw); padding:16px; border:1px solid rgba(255,255,255,.35); border-radius:12px;
      background:rgba(20,28,42,.76); color:#fff; box-shadow:0 12px 38px rgba(0,0,0,.35);
      backdrop-filter:blur(9px); font:14px/1.4 system-ui,sans-serif; }
    #${PREFIX}-style-panel h3 { margin:0 0 12px; font-size:17px; }
    #${PREFIX}-style-panel label { display:grid; grid-template-columns:95px 1fr 64px;
      align-items:center; gap:8px; margin:12px 0; }
    #${PREFIX}-style-panel input[type="range"] { width:100%; }
    #${PREFIX}-style-panel input[type="number"] { width:58px; padding:5px 3px; border:1px solid rgba(255,255,255,.45);
      border-radius:5px; background:rgba(255,255,255,.92); color:#182235; text-align:center; }
    #${PREFIX}-style-panel input[type="color"] { width:100%; height:34px; border:0; background:transparent; }
    #${PREFIX}-style-panel select { width:100%; padding:6px; border-radius:6px; }
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

  const panel = document.createElement('section');
  panel.id = `${PREFIX}-panel`;
  panel.innerHTML = `
    <div id="${PREFIX}-head"><strong>Coursera 字幕工作台</strong><button id="${PREFIX}-close" title="关闭">×</button></div>
    <div id="${PREFIX}-body">
      <div class="${PREFIX}-row"><label for="${PREFIX}-title">视频/课程标题</label><input id="${PREFIX}-title"></div>
      <div class="${PREFIX}-row">
        <label for="${PREFIX}-track">原字幕轨道</label><select id="${PREFIX}-track"></select>
        <button id="${PREFIX}-refresh">刷新轨道</button>
        <button id="${PREFIX}-extract" class="${PREFIX}-primary">识别原字幕</button>
        <button id="${PREFIX}-copy">复制“标题 + 提示词 + 字幕”</button>
      </div>
      <div id="${PREFIX}-status">请先播放视频，并在 Coursera 中打开一种字幕。</div>
      <label for="${PREFIX}-source"><b>提取到的原字幕</b></label>
      <textarea id="${PREFIX}-source" placeholder="识别后会在这里显示完整 SRT 字幕"></textarea>
      <div class="${PREFIX}-row"><b>把 AI 返回的完整 SRT/VTT 粘贴到下面，然后点击应用：</b></div>
      <textarea id="${PREFIX}-translated" placeholder="在这里粘贴翻译后的 SRT/VTT；即使外面带有 Markdown 代码块也可以识别"></textarea>
      <div class="${PREFIX}-row">
        <button id="${PREFIX}-paste">从剪贴板粘贴</button>
        <button id="${PREFIX}-apply" class="${PREFIX}-primary">应用到当前视频</button>
        <button id="${PREFIX}-style-open">调整字幕样式</button>
        <button id="${PREFIX}-clear">清空输入</button>
      </div>
    </div>`;

  const stylePanel = document.createElement('section');
  stylePanel.id = `${PREFIX}-style-panel`;
  stylePanel.innerHTML = `
    <h3>调整字幕样式</h3>
    <label><span>X 偏移</span><input id="${PREFIX}-style-x" type="range" min="-600" max="600" step="5"><input id="${PREFIX}-style-x-value" type="number" min="-600" max="600" step="1"></label>
    <label><span>Y 偏移</span><input id="${PREFIX}-style-y" type="range" min="-300" max="300" step="5"><input id="${PREFIX}-style-y-value" type="number" min="-300" max="300" step="1"></label>
    <label><span>字幕颜色</span><input id="${PREFIX}-style-color" type="color"><output></output></label>
    <label><span>字体粗细</span><input id="${PREFIX}-style-weight" type="range" min="100" max="900" step="100"><input id="${PREFIX}-style-weight-value" type="number" min="100" max="900" step="100"></label>
    <label><span>字体大小</span><input id="${PREFIX}-style-size" type="range" min="14" max="52" step="1"><input id="${PREFIX}-style-size-value" type="number" min="14" max="52" step="1"></label>
    <button id="${PREFIX}-style-done">完成并返回工作台</button>`;

  const overlay = document.createElement('div');
  overlay.id = `${PREFIX}-subtitle`;
  document.body.append(launcher, panel, stylePanel, overlay);

  const $ = id => document.getElementById(`${PREFIX}-${id}`);
  const video = () => {
    const videos = [...document.querySelectorAll('video')];
    return videos.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const aScore = (a.paused ? 0 : 1e9) + ar.width * ar.height;
      const bScore = (b.paused ? 0 : 1e9) + br.width * br.height;
      return bScore - aScore;
    })[0] || null;
  };
  const status = message => { $('status').textContent = message; };

  function lessonIdentity() {
    const path = location.pathname.replace(/\/+$/, '');
    const match = path.match(/^\/learn\/([^/]+)\/lecture\/([^/]+)(?:\/([^/]+))?/i);
    return match ? `${match[1]}::${match[2]}::${match[3] || ''}` : path;
  }

  function lessonCacheKey() {
    return CACHE_PREFIX + lessonIdentity();
  }

  function saveCurrentLesson() {
    const subtitles = $('translated').value.trim();
    if (!subtitles) return false;
    try {
      localStorage.setItem(lessonCacheKey(), JSON.stringify({
        version: 1, identity: lessonIdentity(), url: location.href,
        title: $('title').value.trim() || pageTitle(), subtitles,
        savedAt: new Date().toISOString()
      }));
      return true;
    } catch (error) {
      console.warn('Coursera 字幕自动保存失败：', error);
      return false;
    }
  }

  function readCurrentLesson() {
    try {
      const raw = localStorage.getItem(lessonCacheKey());
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function loadSubtitleStyle() {
    try { subtitleStyle = { ...DEFAULT_STYLE, ...JSON.parse(localStorage.getItem(STYLE_KEY) || '{}') }; }
    catch (_) { subtitleStyle = { ...DEFAULT_STYLE }; }
  }

  function saveSubtitleStyle() {
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(subtitleStyle)); } catch (_) {}
  }

  function applySubtitleStyle() {
    overlay.style.color = subtitleStyle.color;
    overlay.style.fontSize = `${subtitleStyle.size}px`;
    overlay.style.fontWeight = String(subtitleStyle.weight);
    $('style-x').value = subtitleStyle.x;
    $('style-y').value = subtitleStyle.y;
    $('style-color').value = subtitleStyle.color;
    $('style-weight').value = subtitleStyle.weight;
    $('style-size').value = subtitleStyle.size;
    $('style-x-value').value = subtitleStyle.x;
    $('style-y-value').value = subtitleStyle.y;
    $('style-weight-value').value = subtitleStyle.weight;
    $('style-size-value').value = subtitleStyle.size;
  }

  function pageTitle() {
    const selectors = [
      '[data-testid*="video-title"]', '[data-testid*="lesson-title"]',
      'main h1', 'main h2', 'h1'
    ];
    const heading = selectors.map(s => document.querySelector(s)?.textContent?.trim()).find(Boolean);
    return heading || document.title.replace(/\s*\|\s*Coursera.*$/i, '').trim() || 'Coursera 视频';
  }

  function formatTime(seconds) {
    const msTotal = Math.max(0, Math.round(Number(seconds) * 1000));
    const h = Math.floor(msTotal / 3600000);
    const m = Math.floor((msTotal % 3600000) / 60000);
    const s = Math.floor((msTotal % 60000) / 1000);
    const ms = msTotal % 1000;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  }

  function cuesToSrt(cues) {
    return cues.map((cue, i) => `${i + 1}\n${formatTime(cue.startTime ?? cue.start)} --> ${formatTime(cue.endTime ?? cue.end)}\n${String(cue.text || '').replace(/<[^>]+>/g, '').trim()}`).join('\n\n');
  }

  function toSeconds(value) {
    const parts = value.trim().replace(',', '.').split(':').map(Number);
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

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

  async function clipboardWrite(text) {
    if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return; }
    try { await navigator.clipboard.writeText(text); return; } catch (_) {}
    const area = document.createElement('textarea');
    area.value = text; area.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(area);
    area.select(); document.execCommand('copy'); area.remove();
  }

  async function refreshTracks() {
    const v = video();
    if (!v) { status('没有找到视频，请先打开视频页面并开始播放。'); return; }
    [...v.textTracks].forEach(track => { if (track !== translatedTrack) track.mode = 'hidden'; });
    await new Promise(resolve => setTimeout(resolve, 700));
    const select = $('track'); select.innerHTML = '';
    [...v.textTracks].filter(track => track !== translatedTrack).forEach((track, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${track.label || '未命名'} / ${track.language || '未知语言'}（${track.cues?.length || 0} 条）`;
      select.appendChild(option);
    });
    status(select.options.length ? `发现 ${select.options.length} 条字幕轨道，请选择原语言轨道。` : '没有发现字幕轨道。请先在 Coursera 播放器中打开字幕，再点击“刷新轨道”。');
  }

  async function extractSelectedTrack() {
    const v = video();
    if (!v) return;
    if (!$('track').options.length) await refreshTracks();
    const tracks = [...v.textTracks].filter(track => track !== translatedTrack);
    const index = Number($('track').value || 0);
    const track = tracks[index];
    if (!track?.cues?.length) { status('所选轨道没有可用字幕。请播放几秒并重新刷新。'); return; }
    sourceCues = [...track.cues].sort((a,b) => a.startTime - b.startTime);
    $('source').value = cuesToSrt(sourceCues);
    $('title').value = pageTitle();
    status(`已识别 ${sourceCues.length} 条字幕：${track.label || track.language || '当前轨道'}`);
  }

  function aiPackage() {
    const title = $('title').value.trim() || pageTitle();
    const srt = $('source').value.trim();
    return `课程/视频标题：${title}\n\n请把下面的原字幕翻译成自然、准确的简体中文。要求：\n1. 完整保留所有字幕序号和时间轴，不增删时间段。\n2. 结合整集上下文翻译，不要逐词硬译；修复明显的断句、听写和机器翻译错误。\n3. 对技术名词、缩写、变量名和专有名词进行上下文核对；不易理解或没有可靠中文译名的词，保留英文并在必要时加简短中文说明。\n4. 前后术语必须统一，避免同一术语出现多个译法。\n5. 不要总结，不要解释处理过程，只返回可直接导入播放器的完整 SRT 内容。\n\n原字幕如下：\n\n${srt}`;
  }

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

  function placeOverlay() {
    const v = activeVideo || video();
    if (!v) return;
    const fullscreenRoot = document.fullscreenElement;
    if (fullscreenRoot === v) return;
    const host = fullscreenRoot || document.body;
    if (overlay.parentElement !== host) host.appendChild(overlay);
    const rect = v.getBoundingClientRect();
    overlay.style.position = 'fixed';
    overlay.style.left = `${rect.left + rect.width / 2 + subtitleStyle.x}px`;
    overlay.style.top = `${rect.bottom - Math.max(65, rect.height * 0.10) + subtitleStyle.y}px`;
    overlay.style.bottom = 'auto';
    overlay.style.transform = 'translate(-50%, -100%)';
    overlay.style.maxWidth = `${Math.max(280, rect.width * 0.88)}px`;
  }

  function renderOverlay() {
    const currentVideo = video();
    if (currentVideo && currentVideo !== activeVideo) {
      activeVideo = currentVideo;
      try { installNativeTrack(activeVideo); } catch (_) {}
    }
    const v = activeVideo;
    if (!v) return;
    if (styleEditing) {
      placeOverlay();
      const current = translatedCues.find(cue => v.currentTime >= cue.start && v.currentTime < cue.end);
      overlay.textContent = current?.text || '字幕样式预览：拖动滑块即可实时调整';
      overlay.style.display = document.fullscreenElement === v ? 'none' : 'block';
      return;
    }
    if (!translatedCues.length) { overlay.style.display = 'none'; return; }
    const current = translatedCues.find(cue => v.currentTime >= cue.start && v.currentTime < cue.end);
    overlay.textContent = current?.text || '';
    const videoOnlyFullscreen = document.fullscreenElement === v;
    overlay.style.display = current && !videoOnlyFullscreen ? 'block' : 'none';
    if (!videoOnlyFullscreen) placeOverlay();
  }

  async function applyTranslated(options = {}) {
    const { save = true, silent = false } = options;
    try {
      const raw = $('translated').value;
      status(`正在解析字幕（${raw.length} 个字符）……`);
      await new Promise(resolve => requestAnimationFrame(resolve));
      const v = video();
      if (!v) throw new Error('没有找到当前视频');
      const parsed = parseSubtitle(raw);
      if (!parsed.length) throw new Error('没有识别出有效 SRT/VTT，请确认内容包含类似 00:00:01,000 --> 00:00:03,000 的时间轴');
      translatedCues = parsed;
      activeVideo = v;
      let nativeWarning = '';
      try { installNativeTrack(v); }
      catch (error) { nativeWarning = `；原生全屏轨道不可用：${error.message || error}`; }
      clearInterval(overlayTimer);
      overlayTimer = setInterval(renderOverlay, 100);
      if (save) saveCurrentLesson();
      renderOverlay();
      if (!silent) {
        const first = translatedCues[0];
        const last = translatedCues[translatedCues.length - 1];
        status(`已应用 ${translatedCues.length} 条并保存。视频当前 ${v.currentTime.toFixed(1)} 秒；字幕范围 ${first.start.toFixed(1)}–${last.end.toFixed(1)} 秒${nativeWarning}。`);
      }
      return true;
    } catch (error) {
      status(`应用失败：${error.message || error}`);
      return false;
    }
  }

  async function restoreCurrentLesson(autoApply = false) {
    const saved = readCurrentLesson();
    if (!saved?.subtitles) return false;
    $('translated').value = saved.subtitles;
    if (saved.title) $('title').value = saved.title;
    if (autoApply && video()) {
      const ok = await applyTranslated({ save: false, silent: true });
      if (ok) status(`已自动恢复并应用本集缓存（${new Date(saved.savedAt).toLocaleString()}）。`);
    } else {
      status(`已恢复本集缓存（${new Date(saved.savedAt).toLocaleString()}），点击“应用到当前视频”即可。`);
    }
    return true;
  }

  launcher.onclick = () => { panel.style.display = 'block'; $('title').value = $('title').value || pageTitle(); restoreCurrentLesson(false); refreshTracks(); };
  $('close').onclick = () => { panel.style.display = 'none'; };
  $('refresh').onclick = refreshTracks;
  $('extract').onclick = extractSelectedTrack;
  $('copy').onclick = async () => {
    if (!$('source').value.trim()) await extractSelectedTrack();
    if (!$('source').value.trim()) return;
    await clipboardWrite(aiPackage());
    status('已复制“标题 + 翻译提示词 + 完整字幕”，现在可直接粘贴给豆包或其他模型。');
  };
  $('paste').onclick = async () => {
    try { $('translated').value = await navigator.clipboard.readText(); status('已从剪贴板粘贴翻译结果。'); }
    catch (_) { status('浏览器拒绝读取剪贴板，请在输入框中手动按 Ctrl+V。'); $('translated').focus(); }
  };
  $('apply').onclick = async event => {
    event.preventDefault();
    const button = $('apply');
    button.disabled = true;
    try { await applyTranslated(); }
    finally { button.disabled = false; }
  };
  $('style-open').onclick = () => {
    activeVideo = video();
    if (!activeVideo) { status('没有找到当前视频。'); return; }
    styleEditing = true;
    panel.style.display = 'none';
    stylePanel.style.display = 'block';
    renderOverlay();
  };
  const numericStyleControls = {
    x: { min: -600, max: 600 },
    y: { min: -300, max: 300 },
    weight: { min: 100, max: 900 },
    size: { min: 14, max: 52 }
  };
  Object.entries(numericStyleControls).forEach(([name, limits]) => {
    const slider = $(`style-${name}`);
    const number = $(`style-${name}-value`);
    const update = source => {
      if (source.value.trim() === '') return;
      const value = Math.min(limits.max, Math.max(limits.min, Number(source.value)));
      if (!Number.isFinite(value)) return;
      slider.value = value;
      number.value = value;
      subtitleStyle[name] = value;
      applySubtitleStyle();
      saveSubtitleStyle();
      renderOverlay();
    };
    slider.addEventListener('input', () => update(slider));
    number.addEventListener('input', () => update(number));
    number.addEventListener('change', () => update(number));
  });
  $('style-color').addEventListener('input', () => {
    subtitleStyle.color = $('style-color').value;
    applySubtitleStyle();
    saveSubtitleStyle();
    renderOverlay();
  });
  $('style-done').onclick = () => {
    styleEditing = false;
    stylePanel.style.display = 'none';
    panel.style.display = 'block';
    renderOverlay();
  };
  $('clear').onclick = () => { $('source').value=''; $('translated').value=''; sourceCues=[]; status('输入框已清空。'); };

  function mountUiInCurrentScreen() {
    const fullscreenRoot = document.fullscreenElement;
    const currentVideo = video() || activeVideo;
    if (currentVideo) activeVideo = currentVideo;
    const host = fullscreenRoot && fullscreenRoot !== currentVideo ? fullscreenRoot : document.body;
    host.append(launcher, panel, stylePanel);
    if (!fullscreenRoot) document.body.appendChild(overlay);
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
    if (!launcher.isConnected || !panel.isConnected || !stylePanel.isConnected) document.body.append(launcher, panel, stylePanel);
    const nextKey = lessonCacheKey();
    if (nextKey !== currentLessonKey) {
      currentLessonKey = nextKey;
      restoredLessonKey = '';
      if (translatedTrack) translatedTrack.mode = 'disabled';
      translatedTrack = null; translatedCues = []; activeVideo = null;
      overlay.style.display = 'none'; $('source').value = ''; $('translated').value = '';
      $('title').value = pageTitle();
    }
    if (restoredLessonKey !== nextKey && video()) {
      restoredLessonKey = nextKey;
      restoreCurrentLesson(true);
    }
  }, 1000);
})();
