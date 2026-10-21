// VOD Blur content script.
// Tekent vlakken (kleur of blur) boven de pagina. Een vlak hangt vast aan de video (procenten van het videobeeld zelf,
// zonder zwarte balken), aan een element op de pagina (scrolt mee) of aan het venster, en wordt bewaard voor één
// pagina, een sitedeel of de hele site.
(() => {
  'use strict';
  if (window.top !== window || window.__vodblur) return;
  window.__vodblur = true;
  globalThis.browser ??= globalThis.chrome; // Chrome kent alleen chrome.*, met dezelfde promises

  const t = (key, sub) => browser.i18n.getMessage(key, sub);

  const SVGNS = 'http://www.w3.org/2000/svg';
  const PREFS_KEY = 'prefs';
  const PRESETS_KEY = 'presets';
  const MIN_SIZE = 8; // px, kleinere vormen worden genegeerd
  const DEFAULT_PREFS = {
    shape: 'rect', mode: 'blur', color: '#000000', opacity: 100, blur: 20, anchor: 'video', scope: 'section',
    pickSize: 1,
  };
  const SCOPES = ['page', 'section', 'site'];
  // 'masks:' is het oorspronkelijke formaat (sitedeel), zodat bestaande vlakken blijven werken.
  const PREFIX = { page: 'masks-page:', section: 'masks:', site: 'masks-site:' };
  const SCOPE_LABEL = { page: t('scopePage'), section: t('scopeSection'), site: t('scopeSite') };
  // Queryparameters die niets zeggen over wélke video het is (tijdstip, tracking, playlist).
  const NOISE = /^(t|time|start|si|feature|pp|ab_channel|index|list|utm_.+)$/;

  // Bijvoorbeeld page "www.youtube.com/watch?v=abc", section "www.youtube.com/watch", site "www.youtube.com".
  function scopePaths() {
    // Met de hand in plaats van URLSearchParams: diens iterators werken niet in Firefox content scripts.
    const q = location.search.slice(1).split('&')
      .filter((kv) => kv && !NOISE.test(kv.split('=')[0]))
      .sort()
      .join('&');
    return {
      page: location.hostname + location.pathname + (q ? '?' + q : ''),
      section: location.hostname + '/' + (location.pathname.split('/')[1] || ''),
      site: location.hostname,
    };
  }

  let paths = scopePaths();
  const keyFor = (scope) => PREFIX[scope] + paths[scope];

  let masks = [];
  let backup = null; // stand bij het openen van de editor, voor Annuleren
  let dirty = false;
  let prefs = { ...DEFAULT_PREFS };
  let presets = []; // [{ id, name, masks }], vlakken zonder id en scope
  let hidden = false;
  let editing = false;
  let selected = null; // id van het gekozen vlak
  let drag = null; // bezig met tekenen, verplaatsen of vergroten
  let ui = null;
  // Tweede laag in documentcoördinaten voor vlakken aan een element: die scrollt met de pagina mee zonder dat wij
  // iets hoeven te doen, dus zonder een frame achter te lopen (dat frame zou op stream te zien zijn).
  let docUi = null;
  let clearTimer = null;
  let loop = 0;

  // Rechthoeken in pixels binnen de host: het venster en het zichtbare videobeeld. doc is waar de documentlaag
  // begint, ook in host-coördinaten.
  let frames = { page: null, video: null, doc: null };
  let frameSig = '';
  // Per selector: het gevonden element en de voorouders die het afsnijden (scrollende lijsten).
  const anchors = new Map();
  // Per selector: rechthoek van het element in documentlaag-coördinaten, plus de afsnijrechthoek.
  let elFrames = {};
  let observer = null;
  let pickTarget = null; // elementkiezer: { stack, i, wheel }
  let video = null;
  let videoFit = '';
  let videoAge = 0;

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  // ---------------------------------------------------------------- styles

  const CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
* { box-sizing: border-box; }
.masks, .layer, .overlay, .handles, .capture { position: absolute; inset: 0; }
.masks, .overlay, .handles { pointer-events: none; }
.overlay { width: 100%; height: 100%; }
.mask { position: absolute; }
.doclayer { position: absolute; left: 0; top: 0; }
.clipbox { position: absolute; overflow: hidden; }
.capture { cursor: crosshair; touch-action: none; user-select: none; pointer-events: auto; }
.capture.pickmode { cursor: pointer; }
.capture.over { cursor: move; }
.pickbox {
  position: absolute; pointer-events: none; border: 2px solid #bf94ff; border-radius: 3px;
  background: rgba(145, 70, 255, .14); box-shadow: 0 0 0 1px rgba(0, 0, 0, .55);
}
.pickbox span {
  position: absolute; left: -2px; bottom: 100%; margin-bottom: 4px; padding: 4px 7px; border-radius: 5px;
  background: #9146ff; color: #fff; font: 600 11px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  white-space: nowrap; max-width: 420px; overflow: hidden; text-overflow: ellipsis;
}
.pickbox.low span { bottom: auto; top: 100%; margin: 4px 0 0; }
.olb { fill: none; stroke: rgba(0, 0, 0, .6); stroke-width: 3; }
.olw { fill: none; stroke: rgba(255, 255, 255, .75); stroke-width: 1.5; stroke-dasharray: 6 4; }
.olw.live { stroke: #bf94ff; }
.olw.off { stroke: rgba(255, 255, 255, .45); stroke-dasharray: 2 5; }
.olw.sel { stroke: #bf94ff; stroke-width: 2; stroke-dasharray: none; }
.olw.sel.off { stroke-dasharray: 6 4; }
.del, .eye {
  position: absolute; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%;
  background: #e5484d; color: #fff; font: 700 15px/24px system-ui, sans-serif; text-align: center;
  cursor: pointer; pointer-events: auto; box-shadow: 0 2px 8px rgba(0, 0, 0, .5);
}
.del:hover { background: #ff5f64; }
.eye { display: flex; align-items: center; justify-content: center; background: #26262c; border: 1px solid #3a3a42; }
.eye:hover { background: #34343b; }
.hdl {
  position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; pointer-events: auto;
  background: #fff; border: 2px solid #9146ff; border-radius: 3px; box-shadow: 0 1px 4px rgba(0, 0, 0, .5);
}
.hdl.nw, .hdl.se { cursor: nwse-resize; }
.hdl.ne, .hdl.sw { cursor: nesw-resize; }
.panel {
  position: absolute; top: 16px; left: 50%; transform: translateX(-50%); pointer-events: auto;
  background: rgba(24, 24, 27, .96); color: #efeff1; border: 1px solid rgba(255, 255, 255, .14);
  border-radius: 14px; box-shadow: 0 10px 40px rgba(0, 0, 0, .5); padding: 16px 18px;
  font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: calc(100vw - 16px);
}
.row { display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap; }
.row + .row { margin-top: 14px; }
.grip { cursor: grab; color: #8b8b95; padding: 4px 2px; display: flex; touch-action: none; }
.grip:active { cursor: grabbing; }
.sep { width: 1px; height: 26px; margin: 0 2px; background: #3a3a42; }
.lbl { min-width: 96px; color: #adadb8; } /* vaste breedte, zodat de knoppen eronder netjes uitlijnen */
button { font: inherit; color: inherit; cursor: pointer; }
.seg { display: flex; gap: 3px; padding: 3px; background: #26262c; border-radius: 10px; }
.seg button {
  min-width: 36px; height: 32px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent;
  display: flex; align-items: center; justify-content: center;
}
.seg button:hover { background: #34343b; }
.seg button[aria-pressed="true"] { background: #9146ff; color: #fff; }
.seg button:disabled { opacity: .35; cursor: default; background: transparent; }
.field { display: flex; align-items: center; gap: 10px; color: #adadb8; }
.field output { min-width: 34px; color: #efeff1; font-variant-numeric: tabular-nums; }
input[type="range"] { width: 130px; accent-color: #9146ff; }
input[type="text"] {
  height: 38px; width: 170px; padding: 0 10px; border-radius: 8px; border: 1px solid #3a3a42;
  background: #26262c; color: #efeff1; font: inherit;
}
input[type="color"] {
  width: 38px; height: 38px; padding: 3px; border: 1px solid #3a3a42; border-radius: 8px;
  background: none; cursor: pointer;
}
select {
  height: 38px; max-width: 340px; padding: 0 10px; border-radius: 8px; border: 1px solid #3a3a42;
  background: #26262c; color: #efeff1; font: inherit; cursor: pointer;
}
.btn { height: 38px; padding: 0 16px; border-radius: 8px; border: 1px solid #3a3a42; background: #26262c; }
.btn:hover { background: #34343b; }
.btn.primary { background: #9146ff; border-color: #9146ff; color: #fff; font-weight: 600; }
.btn.primary:hover { background: #a265ff; }
.btn.ghost { background: transparent; color: #adadb8; }
.btn:disabled { opacity: .4; cursor: default; }
/* width 0 + min-width 100%: de hint volgt de breedte van de rijen in plaats van het paneel op te rekken */
.hint { margin-top: 14px; padding-top: 12px; border-top: 1px solid #2e2e35; line-height: 1.55; width: 0; min-width: 100%; color: #adadb8; font-size: 12px; }
.hint b { color: #efeff1; font-weight: 600; }
.warn { color: #f5b14c; }
.pick {
  width: 38px; height: 38px; padding: 0; border: 1px solid #3a3a42; border-radius: 8px; background: #26262c;
  display: flex; align-items: center; justify-content: center;
}
.pick:hover { background: #34343b; }
.picker { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: crosshair; touch-action: none; }
.picker .shot { position: absolute; inset: 0; width: 100%; height: 100%; }
.loupe {
  position: absolute; pointer-events: none; padding: 6px; border-radius: 10px;
  background: rgba(24, 24, 27, .96); border: 1px solid rgba(255, 255, 255, .14); box-shadow: 0 6px 24px rgba(0, 0, 0, .5);
  font: 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #efeff1;
}
.loupe canvas { display: block; border-radius: 5px; }
.pinfo { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.swatch { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, .3); }
.hex { font-variant-numeric: tabular-nums; text-transform: uppercase; }
.psize { margin-left: auto; color: #adadb8; }
`;

  const PANEL_HTML = `
<div class="panel" id="panel">
  <div class="row">
    <div class="grip" id="grip" title="${t('grip')}">
      <svg viewBox="0 0 10 16" width="10" height="16"><g fill="currentColor">
        <circle cx="2" cy="3" r="1.3"/><circle cx="8" cy="3" r="1.3"/>
        <circle cx="2" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/>
        <circle cx="2" cy="13" r="1.3"/><circle cx="8" cy="13" r="1.3"/>
      </g></svg>
    </div>
    <div class="seg">
      <button data-shape="free" title="${t('shapeFree')}">
        <svg viewBox="0 0 16 16" width="16" height="16"><path d="M2 11C4 3 7 14 9 7s4-3 5-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
      <button data-shape="rect" title="${t('shapeRect')}">
        <svg viewBox="0 0 16 16" width="16" height="16"><rect x="3" y="3" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
      </button>
      <button data-shape="ellipse" title="${t('shapeEllipse')}">
        <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
      </button>
      <button data-shape="triangle" title="${t('shapeTriangle')}">
        <svg viewBox="0 0 16 16" width="16" height="16"><polygon points="8,2.5 14,13 2,13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </button>
      <button data-shape="element" title="${t('shapeElement')}">
        <svg viewBox="0 0 16 16" width="16" height="16"><path d="M9.5 2.5h-7v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 1.6"/><path d="M6.5 6.5l7.5 2.8-3.2 1.3-1.3 3.2z" fill="currentColor"/></svg>
      </button>
    </div>
    <div class="sep"></div>
    <div class="seg">
      <button data-mode="blur">${t('modeBlur')}</button>
      <button data-mode="color">${t('modeColor')}</button>
    </div>
    <label class="field" id="blurField">
      <input type="range" id="blur" min="2" max="60" step="1">
      <output id="blurOut"></output>
    </label>
    <label class="field" id="colorField">
      <input type="color" id="color">
      <button type="button" class="pick" id="pick" title="${t('pick')}">
        <svg viewBox="0 0 16 16" width="16" height="16"><path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3l-1.6 1.6.7.7-1 1-.7-.7-5.2 5.2H3.6v-2.1L8.8 5.1l-.7-.7 1-1 .7.7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </button>
      <input type="range" id="opacity" min="10" max="100" step="5">
      <output id="opacityOut"></output>
    </label>
  </div>
  <div class="row">
    <span class="lbl">${t('anchorLabel')}</span>
    <div class="seg">
      <button data-anchor="video" title="${t('anchorVideoTitle')}">${t('anchorVideo')}</button>
      <button data-anchor="element" title="${t('anchorElementTitle')}">${t('anchorElement')}</button>
      <button data-anchor="page" title="${t('anchorPageTitle')}">${t('anchorPage')}</button>
    </div>
  </div>
  <div class="row">
    <span class="lbl">${t('scopeLabel')}</span>
    <select id="scope" title="${t('scopeTitle')}">
      <option value="page"></option>
      <option value="section"></option>
      <option value="site"></option>
    </select>
  </div>
  <div class="row">
    <span class="lbl">${t('presetLabel')}</span>
    <select id="preset" title="${t('presetTitle')}"></select>
    <button class="btn" id="presetSave" title="${t('presetSaveTitle')}">${t('presetSave')}</button>
    <span class="field" id="presetForm" hidden>
      <input type="text" id="presetName" maxlength="40" placeholder="${t('presetName')}">
      <button class="btn primary" id="presetOk">${t('presetOk')}</button>
    </span>
  </div>
  <div class="row">
    <button class="btn primary" id="save" disabled>${t('save')}</button>
    <button class="btn" id="cancel">${t('cancel')}</button>
    <button class="btn ghost" id="clear" title="${t('clearAllTitle')}">${t('clearAll')}</button>
    <button class="btn ghost" id="manage" title="${t('overviewTitle')}">${t('overview')}</button>
  </div>
  <div class="hint">
    <span id="hintDraw">${t('hintDraw')}</span>
    <span id="hintPick">${t('hintPick')}</span>
    <span id="hintEdit">${t('hintEdit')}</span>
    <span id="hintOff" class="warn">${t('hintOff')}</span>
    <span id="hintNoVideo" class="warn">${t('hintNoVideo')}</span>
    <span id="hintMissing" class="warn">${t('hintMissing')}</span>
  </div>
</div>`;

  // ---------------------------------------------------------------- helpers

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function parseHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.firstElementChild;
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function styleOf(p) {
    return { mode: p.mode, color: p.color, opacity: p.opacity, blur: p.blur };
  }

  const selectedMask = () => masks.find((m) => m.id === selected) || null;

  // ---------------------------------------------------------------- video en frames

  // De grootste zichtbare video op de pagina is "de" video.
  function pickVideo() {
    const vw = window.innerWidth, vh = window.innerHeight;
    let best = null, bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0 || w * h <= bestArea) continue;
      if (getComputedStyle(v).visibility === 'hidden') continue;
      best = v;
      bestArea = w * h;
    }
    return best;
  }

  // Het deel van het video-element waar echt beeld staat, dus zonder de zwarte balken van object-fit.
  function videoFrame(v, hr) {
    const r = v.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    let x = r.left, y = r.top, w = r.width, h = r.height;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (vw && vh && videoFit !== 'fill') {
      const s = videoFit === 'cover' ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
      x += (w - vw * s) / 2;
      y += (h - vh * s) / 2;
      w = vw * s;
      h = vh * s;
    }
    return { x: x - hr.left, y: y - hr.top, w, h };
  }

  function measure() {
    const hr = ui.host.getBoundingClientRect();
    const dr = docUi.host.getBoundingClientRect();
    if (!video || !video.isConnected || ++videoAge > 30) {
      video = pickVideo();
      videoFit = video ? getComputedStyle(video).objectFit : '';
      videoAge = 0;
    }
    frames = {
      page: { x: 0, y: 0, w: hr.width, h: hr.height },
      video: video ? videoFrame(video, hr) : null,
      doc: { x: dr.left - hr.left, y: dr.top - hr.top },
    };
    resolveAnchors();
    elFrames = {};
    for (const [sel, a] of anchors) {
      const r = a.el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      let clip = null;
      if (a.clips.length) {
        let l = -Infinity, t = -Infinity, ri = Infinity, bo = Infinity;
        for (const c of a.clips) {
          const q = c.getBoundingClientRect();
          l = Math.max(l, q.left);
          t = Math.max(t, q.top);
          ri = Math.min(ri, q.right);
          bo = Math.min(bo, q.bottom);
        }
        clip = { x: l - dr.left, y: t - dr.top, w: Math.max(0, ri - l), h: Math.max(0, bo - t) };
      }
      elFrames[sel] = { x: r.left - dr.left, y: r.top - dr.top, w: r.width, h: r.height, clip };
    }
  }

  // Bij gewoon scrollen veranderen de element-rechthoeken in documentcoördinaten niet, dus hoeft er dan niets
  // opnieuw getekend te worden. Alleen in de editor volgen de omlijningen (in het venster) de scroll.
  const signature = () => JSON.stringify([frames.page, frames.video, elFrames, editing && frames.doc]);

  function frameOf(m) {
    if (m.anchor !== 'element') return frames[m.anchor] || null;
    const f = elFrames[m.el.sel];
    return f && frames.doc ? { x: f.x + frames.doc.x, y: f.y + frames.doc.y, w: f.w, h: f.h } : null;
  }

  function pxBox(m) {
    const f = frameOf(m);
    if (!f) return null;
    return { x: f.x + m.box.x * f.w, y: f.y + m.box.y * f.h, w: m.box.w * f.w, h: m.box.h * f.h };
  }

  function normBox(b, f) {
    return { x: (b.x - f.x) / f.w, y: (b.y - f.y) / f.h, w: b.w / f.w, h: b.h / f.h };
  }

  // ---------------------------------------------------------------- elementen

  const isOurs = (e) => e === ui?.host || e === docUi?.host;
  const isRoot = (e) => e === document.body || e === document.documentElement;

  // Bovenste pagina-element onder een punt (viewport-coördinaten), zonder onze eigen lagen.
  function elementAt(x, y) {
    const list = document.elementsFromPoint(x, y);
    for (let i = 0; i < list.length; i++) {
      if (!isOurs(list[i]) && !isRoot(list[i])) return list[i];
    }
    return null;
  }

  function rectOf(e) {
    const r = e.getBoundingClientRect(), hr = ui.host.getBoundingClientRect();
    return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
  }

  // CSS.escape bestaat niet in Firefox content scripts, dus zelf, volgens de CSSOM-spec.
  function cssEscape(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const digit = c >= 0x30 && c <= 0x39;
      if (c === 0) out += '�';
      else if ((c >= 0x1 && c <= 0x1f) || c === 0x7f || (i === 0 && digit) || (i === 1 && digit && s.charCodeAt(0) === 0x2d)) {
        out += '\\' + c.toString(16) + ' ';
      } else if (i === 0 && s.length === 1 && c === 0x2d) out += '\\-';
      else if (c >= 0x80 || c === 0x2d || c === 0x5f || digit || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) out += s[i];
      else out += '\\' + s[i];
    }
    return out;
  }

  // Id's en klassen die gegenereerd lijken (css-1x2y3z, Foo_bar__a1b2c, :r1:) veranderen per build: niet gebruiken.
  const GENERATED = /\d{3,}|^(css|sc|jsx|svelte|emotion|tw)-|__[\w-]{5,}$|:/;
  const stable = (s) => !!s && s.length <= 40 && !GENERATED.test(s);

  // Eén stap van een selector: tag met stabiele klassen, plus :nth-of-type als broers er hetzelfde uitzien.
  function selectorStep(e) {
    const classes = (e.getAttribute('class') || '').split(/\s+/).filter(stable).slice(0, 3);
    let s = e.tagName.toLowerCase() + classes.map((c) => '.' + cssEscape(c)).join('');
    const parent = e.parentElement;
    if (parent) {
      let index = 0, n = 0, same = 0;
      for (let i = 0; i < parent.children.length; i++) {
        const c = parent.children[i];
        if (c.tagName !== e.tagName) continue;
        n++;
        if (c === e) index = n;
        if (c.matches(s)) same++;
      }
      if (same > 1) s += `:nth-of-type(${index})`;
    }
    return s;
  }

  // Kortste selector (van binnen naar buiten opgebouwd) die precies dit ene element vindt.
  function selectorFor(target) {
    const parts = [];
    for (let e = target; e && e !== document.documentElement; e = e.parentElement) {
      const id = e.id && '#' + cssEscape(e.id);
      parts.unshift(stable(e.id) && document.querySelectorAll(id).length === 1 ? id : selectorStep(e));
      const sel = parts.join(' > ');
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    return parts.join(' > ');
  }

  // Voorouders die hun inhoud afsnijden (scrollende lijsten, overflow: hidden): het vlak mag daar niet buiten komen.
  function clipsOf(e) {
    const list = [];
    for (let p = e.parentElement; p && !isRoot(p); p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') list.push(p);
    }
    return list;
  }

  function anchorTo(target) {
    const sel = selectorFor(target);
    anchors.set(sel, { el: target, clips: clipsOf(target) });
    return sel;
  }

  // Zoekt het element van elk vlak (opnieuw) op. True als er iets veranderde: gevonden, verdwenen of vervangen,
  // zoals wanneer een single page app een stuk pagina opnieuw opbouwt.
  function resolveAnchors() {
    let changed = false;
    const used = new Set();
    for (const m of masks) {
      if (m.anchor !== 'element') continue;
      const sel = m.el.sel;
      if (used.has(sel)) continue;
      used.add(sel);
      const cur = anchors.get(sel);
      if (cur && cur.el.isConnected) continue;
      let e = null;
      try {
        e = document.querySelector(sel);
      } catch {
        // Ongeldige selector: dit vlak blijft onvindbaar.
      }
      if (e) anchors.set(sel, { el: e, clips: clipsOf(e) });
      else anchors.delete(sel);
      if (e || cur) changed = true;
    }
    for (const sel of [...anchors.keys()]) if (!used.has(sel)) anchors.delete(sel);
    return changed;
  }

  // Zodra het element van een vlak in de pagina komt of vervangen wordt meteen tekenen, nog voordat de browser het
  // schildert, zodat de inhoud ook bij het laden geen frame zichtbaar is.
  function watchAnchors() {
    const need = masks.some((m) => m.anchor === 'element');
    if (need && !observer) {
      observer = new MutationObserver(() => {
        if (ui && resolveAnchors()) render();
      });
      observer.observe(document, { childList: true, subtree: true });
    } else if (!need && observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // Kleinste element (onder het midden van het vlak) waar het hele vlak binnen valt.
  function containerFor(b) {
    const hr = ui.host.getBoundingClientRect();
    const x = b.x + hr.left, y = b.y + hr.top;
    for (let e = elementAt(x + b.w / 2, y + b.h / 2); e && !isRoot(e); e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.left <= x + 1 && r.top <= y + 1 && r.right >= x + b.w - 1 && r.bottom >= y + b.h - 1) return e;
    }
    return null;
  }

  // ---------------------------------------------------------------- vormen

  function clipFor(m) {
    switch (m.shape) {
      case 'ellipse':
        return 'ellipse(50% 50% at 50% 50%)';
      case 'triangle':
        return 'polygon(50% 0%, 100% 100%, 0% 100%)';
      case 'free':
        return 'polygon(' + m.pts.map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(',') + ')';
      default:
        return '';
    }
  }

  function outlinePath(m, b) {
    const { x, y, w, h } = b;
    switch (m.shape) {
      case 'ellipse': {
        const rx = w / 2, ry = h / 2;
        return `M${x},${y + ry} a${rx},${ry} 0 1,0 ${w},0 a${rx},${ry} 0 1,0 ${-w},0Z`;
      }
      case 'triangle':
        return `M${x + w / 2},${y} L${x + w},${y + h} L${x},${y + h}Z`;
      case 'free':
        return 'M' + m.pts.map(([px, py]) => `${x + px * w},${y + py * h}`).join(' L') + 'Z';
      default:
        return `M${x},${y}h${w}v${h}h${-w}Z`;
    }
  }

  function maskEl(m, b) {
    const d = el('div', 'mask');
    const s = d.style;
    s.left = b.x + 'px';
    s.top = b.y + 'px';
    s.width = b.w + 'px';
    s.height = b.h + 'px';
    const clip = clipFor(m);
    if (clip) s.clipPath = clip;
    if (m.mode === 'blur') {
      const f = `blur(${m.blur}px)`;
      s.backdropFilter = f;
      s.webkitBackdropFilter = f;
    } else {
      s.background = rgba(m.color, m.opacity / 100);
    }
    return d;
  }

  // final = false voor het voorbeeld tijdens het slepen: dan nog geen element zoeken.
  function newMask(shape, px, extra, final = true) {
    const base = { id: uid(), shape, scope: prefs.scope, ...extra, ...styleOf(prefs) };
    if (prefs.anchor === 'element' && final) {
      const target = containerFor(px);
      // Zonder passend element (alleen de hele pagina eromheen) valt het vlak terug op het venster.
      if (target) return { ...base, anchor: 'element', el: { sel: anchorTo(target) }, box: normBox(px, rectOf(target)) };
    }
    const anchor = prefs.anchor === 'video' && frames.video ? 'video' : 'page';
    return { ...base, anchor, box: normBox(px, frames[anchor]) };
  }

  // Elementkiezer: een vlak precies over het hele element.
  function elementMask(target) {
    return {
      id: uid(), shape: 'rect', scope: prefs.scope, anchor: 'element', el: { sel: anchorTo(target) },
      box: { x: 0, y: 0, w: 1, h: 1 }, ...styleOf(prefs),
    };
  }

  function buildBox(shape, a, b, square, final = true) {
    const { w: W, h: H } = frames.page;
    let dx = b.x - a.x, dy = b.y - a.y;
    if (square) {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = dx < 0 ? -s : s;
      dy = dy < 0 ? -s : s;
    }
    const x2 = clamp(a.x + dx, 0, W), y2 = clamp(a.y + dy, 0, H);
    const w = Math.abs(x2 - a.x), h = Math.abs(y2 - a.y);
    if (w < MIN_SIZE || h < MIN_SIZE) return null;
    return newMask(shape, { x: Math.min(a.x, x2), y: Math.min(a.y, y2), w, h }, {}, final);
  }

  function buildFree(points) {
    if (points.length < 3) return null;
    let pts = points;
    if (pts.length > 240) {
      const step = Math.ceil(pts.length / 240);
      pts = pts.filter((_, i) => i % step === 0);
    }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY;
    if (w < MIN_SIZE || h < MIN_SIZE) return null;
    return newMask('free', { x: minX, y: minY, w, h }, {
      pts: pts.map((p) => [(p.x - minX) / w, (p.y - minY) / h]),
    });
  }

  // Kleinste vlak onder het punt, zodat een klein vlak binnen een groot vlak ook te kiezen is.
  function hit(p) {
    let best = null, area = Infinity;
    for (const m of masks) {
      const b = pxBox(m);
      if (!b || p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) continue;
      if (b.w * b.h < area) {
        best = m;
        area = b.w * b.h;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- render

  function render() {
    if (!ui) return;
    measure();
    frameSig = signature();
    watchAnchors();
    const shown = [], fixed = [], doc = [];
    for (const m of masks) {
      const b = pxBox(m);
      if (!b) continue;
      shown.push([m, b]);
      if (hidden || m.off) continue;
      if (m.anchor !== 'element') {
        fixed.push(maskEl(m, b));
        continue;
      }
      // In documentcoördinaten, en zo nodig afgesneden door de scrollende lijst waar het element in zit.
      const d = { x: b.x - frames.doc.x, y: b.y - frames.doc.y, w: b.w, h: b.h };
      const c = elFrames[m.el.sel].clip;
      if (!c) {
        doc.push(maskEl(m, d));
      } else if (c.w >= 1 && c.h >= 1) {
        const box = el('div', 'clipbox');
        Object.assign(box.style, { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px' });
        box.append(maskEl(m, { x: d.x - c.x, y: d.y - c.y, w: d.w, h: d.h }));
        doc.push(box);
      }
    }
    ui.saved.replaceChildren(...fixed);
    docUi.layer.replaceChildren(...doc);
    ui.gSaved.replaceChildren();
    ui.handles.replaceChildren();
    if (editing) {
      let sel = null;
      for (const [m, b] of shown) {
        if (m.id === selected) sel = [m, b];
        else addOutline(ui.gSaved, outlinePath(m, b), m.off ? 'off' : '');
      }
      if (sel) {
        addOutline(ui.gSaved, outlinePath(...sel), sel[0].off ? 'sel off' : 'sel');
        addHandles(...sel);
      }
    }
    drawLive();
  }

  function drawLive() {
    ui.gLive.replaceChildren();
    const preview = [];
    if (drag && drag.type === 'draw') {
      if (drag.shape === 'free') {
        if (drag.pts.length > 1) addOutline(ui.gLive, 'M' + drag.pts.map((p) => `${p.x},${p.y}`).join(' L'), 'live');
      } else if (drag.preview) {
        const b = pxBox(drag.preview);
        if (b) {
          preview.push(maskEl(drag.preview, b));
          addOutline(ui.gLive, outlinePath(drag.preview, b), 'live');
        }
      }
    }
    ui.live.replaceChildren(...preview);
  }

  function addOutline(group, d, cls) {
    group.append(svgEl('path', { d, class: 'olb' }), svgEl('path', { d, class: ('olw ' + cls).trim() }));
  }

  function addHandles(m, b) {
    const { w: W, h: H } = frames.page;
    for (const c of ['nw', 'ne', 'sw', 'se']) {
      const h = el('div', 'hdl ' + c);
      h.style.left = b.x + (c[1] === 'e' ? b.w : 0) + 'px';
      h.style.top = b.y + (c[0] === 's' ? b.h : 0) + 'px';
      h.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        // De grepen worden bij elke render opnieuw gemaakt, dus de capture-laag houdt de pointer vast.
        ui.capture.setPointerCapture(e.pointerId);
        drag = { type: 'resize', id: m.id, corner: c, start: point(e), orig: { ...b } };
      });
      ui.handles.append(h);
    }
    const del = el('button', 'del');
    del.textContent = '×';
    del.title = t('removeShape');
    const x = clamp(b.x + b.w - 32, 4, W - 28), y = clamp(b.y + 8, 4, H - 28);
    del.style.left = x + 'px';
    del.style.top = y + 'px';
    del.addEventListener('click', () => removeMask(m.id));
    // Aan/uit naast het kruisje; tegen de linkerrand komt hij er rechts van.
    const eye = el('button', 'eye');
    eye.title = m.off ? t('showShape') : t('hideShape');
    eye.append(eyeIcon(m.off));
    eye.style.left = (x >= 32 ? x - 28 : x + 28) + 'px';
    eye.style.top = y + 'px';
    eye.addEventListener('click', () => toggleOff(m));
    ui.handles.append(eye, del);
  }

  // Open oog als het vlak aan staat, doorgestreept als het uit staat.
  function eyeIcon(off) {
    const svg = svgEl('svg', { viewBox: '0 0 16 16', width: 14, height: 14 });
    const line = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' };
    svg.append(
      svgEl('path', { d: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z', ...line }),
      svgEl('circle', { cx: 8, cy: 8, r: 2, ...line }),
    );
    if (off) svg.append(svgEl('path', { d: 'M2.5 2.5l11 11', ...line }));
    return svg;
  }

  function syncPanel() {
    if (!ui) return;
    const sel = selectedMask();
    const st = sel || prefs;
    for (const b of ui.panel.querySelectorAll('[data-shape]')) {
      b.setAttribute('aria-pressed', String(b.dataset.shape === prefs.shape));
    }
    for (const b of ui.panel.querySelectorAll('[data-mode]')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode));
    }
    ui.blurField.hidden = st.mode !== 'blur';
    ui.colorField.hidden = st.mode !== 'color';
    ui.blur.value = st.blur;
    ui.blurOut.textContent = st.blur + 'px';
    ui.color.value = st.color;
    ui.opacity.value = st.opacity;
    ui.opacityOut.textContent = st.opacity + '%';

    const hasVideo = !!frames.video;
    const anchor = sel ? sel.anchor : prefs.anchor === 'video' && !hasVideo ? 'page' : prefs.anchor;
    for (const b of ui.panel.querySelectorAll('[data-anchor]')) {
      b.setAttribute('aria-pressed', String(b.dataset.anchor === anchor));
      if (b.dataset.anchor === 'video') b.disabled = !hasVideo;
    }
    for (const o of ui.scope.options) o.textContent = `${SCOPE_LABEL[o.value]}: ${trunc(paths[o.value], 34)}`;
    ui.scope.value = sel ? sel.scope : prefs.scope;

    const picking = prefs.shape === 'element';
    ui.capture.classList.toggle('pickmode', picking);
    if (!picking) hidePick();
    ui.save.disabled = !dirty;
    ui.clear.disabled = masks.length === 0;
    ui.presetSave.disabled = masks.length === 0;
    ui.hintDraw.hidden = !!sel || picking;
    ui.hintPick.hidden = !!sel || !picking;
    ui.hintEdit.hidden = !sel;
    ui.hintOff.hidden = !sel?.off;
    ui.hintNoVideo.hidden = hasVideo || prefs.anchor !== 'video' || picking;
    ui.hintMissing.hidden = !masks.some((m) => m.anchor === 'element' && !elFrames[m.el.sel]);
  }

  // ---------------------------------------------------------------- acties

  function savePrefs() {
    browser.storage.local.set({ [PREFS_KEY]: prefs });
  }

  // Stijl geldt voor het gekozen vlak én voor nieuwe vlakken.
  function setStyle(patch) {
    Object.assign(prefs, patch);
    savePrefs();
    const sel = selectedMask();
    if (sel) {
      Object.assign(sel, patch);
      dirty = true;
    }
    render();
    syncPanel();
  }

  function setShape(shape) {
    prefs.shape = shape;
    savePrefs();
    syncPanel();
  }

  // Het vlak blijft op dezelfde plek op het scherm staan, alleen het referentiekader verandert.
  function setAnchor(anchor) {
    prefs.anchor = anchor;
    savePrefs();
    const sel = selectedMask();
    const b = sel && pxBox(sel);
    if (b && sel.anchor !== anchor) {
      if (anchor === 'element') {
        const target = containerFor(b);
        if (target) {
          sel.anchor = anchor;
          sel.el = { sel: anchorTo(target) };
          sel.box = normBox(b, rectOf(target));
          dirty = true;
        }
      } else if (frames[anchor]) {
        sel.anchor = anchor;
        delete sel.el;
        sel.box = normBox(b, frames[anchor]);
        dirty = true;
      }
    }
    render();
    syncPanel();
  }

  function setScope(scope) {
    prefs.scope = scope;
    savePrefs();
    const sel = selectedMask();
    if (sel && sel.scope !== scope) {
      sel.scope = scope;
      dirty = true;
    }
    syncPanel();
  }

  function removeMask(id) {
    masks = masks.filter((m) => m.id !== id);
    if (selected === id) selected = null;
    dirty = true;
    render();
    syncPanel();
  }

  // Een uitgezet vlak blijft bewaard, maar verbergt niets tot je het weer aanzet.
  function toggleOff(m) {
    if (m.off) delete m.off;
    else m.off = true;
    dirty = true;
    render();
    syncPanel();
  }

  function nudge(m, key, step) {
    const f = frameOf(m), b = pxBox(m);
    if (!f || !b) return;
    if (key === 'ArrowLeft') b.x -= step;
    else if (key === 'ArrowRight') b.x += step;
    else if (key === 'ArrowUp') b.y -= step;
    else b.y += step;
    m.box = normBox(b, f);
    dirty = true;
    render();
    syncPanel();
  }

  function applyDrag(p) {
    const m = masks.find((x) => x.id === drag.id);
    const f = m && frameOf(m);
    if (!f) return;
    const { w: W, h: H } = frames.page;
    const o = drag.orig, dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    let b;
    if (drag.type === 'move') {
      b = { x: clamp(o.x + dx, 0, W - o.w), y: clamp(o.y + dy, 0, H - o.h), w: o.w, h: o.h };
    } else {
      const c = drag.corner;
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      if (c[1] === 'w') x1 = clamp(x1 + dx, 0, x2 - MIN_SIZE);
      else x2 = clamp(x2 + dx, x1 + MIN_SIZE, W);
      if (c[0] === 'n') y1 = clamp(y1 + dy, 0, y2 - MIN_SIZE);
      else y2 = clamp(y2 + dy, y1 + MIN_SIZE, H);
      b = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    m.box = normBox(b, f);
    dirty = true;
  }

  async function save() {
    const byScope = { page: [], section: [], site: [] };
    for (const m of masks) byScope[m.scope].push(m);
    const set = {}, remove = [];
    for (const s of SCOPES) {
      if (byScope[s].length) set[keyFor(s)] = byScope[s];
      else remove.push(keyFor(s));
    }
    await browser.storage.local.set(set);
    if (remove.length) await browser.storage.local.remove(remove);
    backup = null;
    closeEditor();
  }

  // ---------------------------------------------------------------- presets

  async function loadPresets() {
    const res = await browser.storage.local.get(PRESETS_KEY);
    presets = Array.isArray(res[PRESETS_KEY]) ? res[PRESETS_KEY] : [];
    if (ui) syncPresets();
  }

  function syncPresets() {
    const option = (value, text) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      return o;
    };
    ui.preset.replaceChildren(
      option('', presets.length ? t('presetPlaceholder') : t('presetNone')),
      ...presets.map((p) => option(p.id, `${trunc(p.name, 30)} (${p.masks.length})`)),
    );
    ui.preset.value = '';
    ui.preset.disabled = !presets.length;
  }

  // Voegt de vlakken van een preset toe, met nieuwe id's en de gekozen "Bewaren voor".
  function applyPreset(id) {
    const p = presets.find((x) => x.id === id);
    ui.preset.value = '';
    ui.preset.blur(); // anders vangt de keuzelijst Enter af in plaats van Opslaan
    if (!p) return;
    const added = p.masks.map((m) => ({ ...structuredClone(m), id: uid(), scope: prefs.scope }));
    masks = [...masks, ...added];
    selected = null;
    dirty = true;
    render();
    syncPanel();
  }

  // Bewaart alle vlakken van de editor (ook nog niet opgeslagen) als preset; een bestaande naam wordt overschreven.
  async function savePreset(name) {
    const res = await browser.storage.local.get(PRESETS_KEY);
    const list = Array.isArray(res[PRESETS_KEY]) ? res[PRESETS_KEY] : [];
    const shapes = masks.map(({ id, scope, ...rest }) => structuredClone(rest));
    const i = list.findIndex((p) => p.name === name);
    const preset = { id: i >= 0 ? list[i].id : uid(), name, masks: shapes };
    if (i >= 0) list[i] = preset;
    else list.push(preset);
    await browser.storage.local.set({ [PRESETS_KEY]: list });
  }

  function openPresetForm() {
    ui.presetSave.hidden = true;
    ui.presetForm.hidden = false;
    ui.presetName.value = '';
    ui.presetName.focus();
  }

  function closePresetForm() {
    if (!ui) return;
    ui.presetForm.hidden = true;
    ui.presetSave.hidden = false;
  }

  function submitPreset() {
    const name = ui.presetName.value.trim();
    if (!name) return ui.presetName.focus();
    if (masks.length) savePreset(name);
    closePresetForm();
  }

  function resetClear() {
    clearTimeout(clearTimer);
    clearTimer = null;
    if (ui) ui.clear.textContent = t('clearAll');
  }

  function clearAll() {
    if (!clearTimer) {
      ui.clear.textContent = t('sure');
      clearTimer = setTimeout(resetClear, 3000);
      return;
    }
    resetClear();
    masks = [];
    selected = null;
    dirty = true;
    render();
    syncPanel();
  }

  function onKey(e) {
    if (!editing) return;
    if (picker) {
      if (e.key === 'Escape') closePicker();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const focus = ui.root.activeElement;
    const typing = !!focus && /^(INPUT|SELECT)$/.test(focus.tagName);
    const sel = selectedMask();
    if (focus === ui.presetName && (e.key === 'Enter' || e.key === 'Escape')) {
      if (e.key === 'Enter') submitPreset();
      else closePresetForm();
    } else if (e.key === 'Escape') {
      // Eerst tekenen afbreken, dan selectie opheffen, dan pas de editor sluiten.
      if (drag || sel) {
        drag = null;
        selected = null;
        render();
        syncPanel();
      } else {
        closeEditor();
      }
    } else if (typing) {
      return;
    } else if (e.key === 'Enter') {
      save();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      removeMask(sel.id);
    } else if (e.key.startsWith('Arrow') && sel) {
      nudge(sel, e.key, e.shiftKey ? 10 : 1);
    } else if ((e.key === 'h' || e.key === 'H') && sel && !e.altKey && !e.ctrlKey && !e.metaKey) {
      toggleOff(sel);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function openEditor() {
    ensureHost();
    editing = true;
    hidden = false;
    selected = null;
    drag = null;
    dirty = false;
    backup = structuredClone(masks);
    ui.capture.hidden = false;
    ui.panel.hidden = false;
    closePresetForm();
    render();
    syncPanel();
    loadPresets();
    startLoop();
    window.addEventListener('keydown', onKey, true);
  }

  // Zonder Opslaan gaan alle wijzigingen van deze sessie verloren.
  function closeEditor() {
    if (!editing) return;
    closePicker();
    hidePick();
    editing = false;
    drag = null;
    selected = null;
    dirty = false;
    if (backup) masks = backup;
    backup = null;
    resetClear();
    closePresetForm();
    window.removeEventListener('keydown', onKey, true);
    ui.capture.hidden = true;
    ui.capture.classList.remove('over');
    ui.panel.hidden = true;
    render();
  }

  // ---------------------------------------------------------------- element kiezen

  // Licht het element onder de cursor op. Scrollen kiest het omringende element of weer terug (stack[i]).
  function hoverPick(e) {
    const base = elementAt(e.clientX, e.clientY);
    if (!base) return hidePick();
    if (!pickTarget || pickTarget.stack[0] !== base) {
      const stack = [];
      for (let x = base; x && !isRoot(x); x = x.parentElement) stack.push(x);
      pickTarget = { stack, i: 0, wheel: 0 };
    }
    drawPick();
  }

  function drawPick() {
    const target = pickTarget && pickTarget.stack[pickTarget.i];
    if (!target || !target.isConnected) return hidePick();
    const b = rectOf(target);
    const s = ui.pickBox.style;
    Object.assign(s, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
    ui.pickBox.classList.toggle('low', b.y < 24);
    const cls = (target.getAttribute('class') || '').split(/\s+/).filter(stable)[0];
    const name = target.id ? '#' + target.id : cls ? '.' + cls : '';
    ui.pickLabel.textContent = `${target.tagName.toLowerCase()}${name}  ${Math.round(b.w)}×${Math.round(b.h)}`;
    ui.pickBox.hidden = false;
  }

  function hidePick() {
    pickTarget = null;
    if (ui) ui.pickBox.hidden = true;
  }

  function wheelPick(e) {
    if (!pickTarget) return;
    e.preventDefault();
    // Optellen, net als bij de kleurkiezer, zodat een touchpad niet in één keer naar de hele pagina springt.
    const d = e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
    if (Math.sign(d) !== Math.sign(pickTarget.wheel)) pickTarget.wheel = 0;
    pickTarget.wheel += d;
    if (Math.abs(pickTarget.wheel) < 50) return;
    pickTarget.i = clamp(pickTarget.i + (pickTarget.wheel < 0 ? 1 : -1), 0, pickTarget.stack.length - 1);
    pickTarget.wheel = 0;
    drawPick();
  }

  // ---------------------------------------------------------------- kleur van de pagina kiezen

  // Een schermafbeelding van het tabblad bevriest de pagina; daaruit kies je een kleur met een loep.
  // De kleur is het gemiddelde over een vierkant van schermpixels, scrollen wisselt de maat (zoals in ShareX).
  const PICK_SIZES = [1, 3, 5, 9, 15];
  const LOUPE_PX = 21; // schermpixels in de loep, oneven zodat er een middelste is
  const LOUPE_ZOOM = 7;
  let picker = null;

  async function openPicker(e) {
    if (picker || !editing) return;
    const { host } = ui;
    const start = { x: e.clientX, y: e.clientY };
    // Het paneel en de vlakken zelf horen niet in de schermafbeelding.
    host.style.visibility = 'hidden';
    docUi.host.style.visibility = 'hidden';
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const url = await browser.runtime.sendMessage({ type: 'capture' });
      if (!url) throw new Error('no capture');
      // Via fetch en createImageBitmap in plaats van een <img>: dan heeft de CSP van de pagina er geen invloed op.
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      if (editing) buildPicker(bmp, start);
    } catch (err) {
      console.warn('VOD Blur: schermafbeelding mislukt', err);
    } finally {
      host.style.visibility = '';
      docUi.host.style.visibility = '';
    }
  }

  function buildPicker(bmp, start) {
    const shot = el('canvas', 'shot');
    shot.width = bmp.width;
    shot.height = bmp.height;
    const ctx = shot.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();

    const wrap = el('div', 'picker');
    // De schermafbeelding is het hele venster, inclusief een eventuele scrollbalk; de host stopt daarvoor.
    wrap.style.width = window.innerWidth + 'px';
    wrap.style.height = window.innerHeight + 'px';
    const loupe = el('div', 'loupe');
    const zoom = el('canvas');
    zoom.width = zoom.height = LOUPE_PX * LOUPE_ZOOM;
    const info = el('div', 'pinfo');
    const swatch = el('span', 'swatch');
    const hex = el('span', 'hex');
    const size = el('span', 'psize');
    info.append(swatch, hex, size);
    loupe.append(zoom, info);
    wrap.append(shot, loupe);
    ui.root.append(wrap);

    picker = { wrap, shot, ctx, zoom, loupe, swatch, hex, size, x: start.x, y: start.y, color: null, wheel: 0 };

    wrap.addEventListener('pointermove', (ev) => {
      picker.x = ev.clientX;
      picker.y = ev.clientY;
      drawPicker();
    });
    wrap.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      // Optellen, zodat een touchpad met veel kleine stapjes niet in één keer alle maten doorloopt.
      const d = ev.deltaMode === 0 ? ev.deltaY : ev.deltaY * 40;
      if (Math.sign(d) !== Math.sign(picker.wheel)) picker.wheel = 0;
      picker.wheel += d;
      if (Math.abs(picker.wheel) < 50) return;
      // Omhoog scrollen = groter gebied.
      const i = Math.max(0, PICK_SIZES.indexOf(prefs.pickSize));
      prefs.pickSize = PICK_SIZES[clamp(i + (picker.wheel < 0 ? 1 : -1), 0, PICK_SIZES.length - 1)];
      picker.wheel = 0;
      savePrefs();
      drawPicker();
    }, { passive: false });
    wrap.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const color = ev.button === 0 && picker.color;
      closePicker();
      if (color) setStyle({ color });
    });
    wrap.addEventListener('contextmenu', (ev) => ev.preventDefault());

    drawPicker();
  }

  function closePicker() {
    if (!picker) return;
    picker.wrap.remove();
    picker = null;
  }

  function drawPicker() {
    const p = picker;
    const r = ui.host.getBoundingClientRect();
    const W = p.shot.width, H = p.shot.height;
    const vw = window.innerWidth, vh = window.innerHeight;
    // De schermafbeelding is in echte pixels; dit vangt devicePixelRatio en paginazoom allebei af.
    const k = W / vw;
    const cx = clamp(Math.floor((p.x - r.left) * k), 0, W - 1);
    const cy = clamp(Math.floor((p.y - r.top) * k), 0, H - 1);
    const n = PICK_SIZES.includes(prefs.pickSize) ? prefs.pickSize : 1;
    const half = (n - 1) / 2;

    // Gemiddelde kleur over het gebied, aan de randen van het scherm ingekort.
    const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
    const x1 = Math.min(W, cx + half + 1), y1 = Math.min(H, cy + half + 1);
    const data = p.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let rs = 0, gs = 0, bs = 0;
    for (let i = 0; i < data.length; i += 4) {
      rs += data[i];
      gs += data[i + 1];
      bs += data[i + 2];
    }
    const cnt = data.length / 4;
    p.color = '#' + [rs, gs, bs].map((v) => Math.round(v / cnt).toString(16).padStart(2, '0')).join('');

    // Loep: uitvergrote pixels rond de cursor, met het gemeten gebied omlijnd.
    const z = p.zoom.getContext('2d');
    const R = (LOUPE_PX - 1) / 2, Z = LOUPE_ZOOM, S = LOUPE_PX * Z;
    z.imageSmoothingEnabled = false;
    z.fillStyle = '#0e0e10';
    z.fillRect(0, 0, S, S);
    const sx = Math.max(0, cx - R), sy = Math.max(0, cy - R);
    const sw = Math.min(W, cx + R + 1) - sx, sh = Math.min(H, cy + R + 1) - sy;
    z.drawImage(p.shot, sx, sy, sw, sh, (sx - cx + R) * Z, (sy - cy + R) * Z, sw * Z, sh * Z);
    const o = (R - half) * Z;
    z.lineWidth = 3;
    z.strokeStyle = 'rgba(0, 0, 0, .7)';
    z.strokeRect(o - 1, o - 1, n * Z + 2, n * Z + 2);
    z.lineWidth = 1;
    z.strokeStyle = '#fff';
    z.strokeRect(o - 0.5, o - 0.5, n * Z + 1, n * Z + 1);

    p.swatch.style.background = p.color;
    p.hex.textContent = p.color;
    p.size.textContent = n === 1 ? '1 px' : `${n}×${n}`;

    // Loep naast de cursor, omgeklapt bij de rand van het scherm.
    const lw = p.loupe.offsetWidth, lh = p.loupe.offsetHeight, gap = 20;
    const px = p.x - r.left, py = p.y - r.top;
    p.loupe.style.left = (px + gap + lw > vw ? px - gap - lw : px + gap) + 'px';
    p.loupe.style.top = (py + gap + lh > vh ? py - gap - lh : py + gap) + 'px';
  }

  // ---------------------------------------------------------------- DOM opbouw

  // In fullscreen tekent de browser alleen het fullscreen-element, dus de host moet daarin hangen.
  function place() {
    if (!ui) return;
    const fs = document.fullscreenElement;
    const target = fs && !/^(VIDEO|IFRAME)$/.test(fs.tagName) ? fs : document.documentElement;
    if (!target) return; // heel vroeg bij het laden bestaat <html> soms nog niet
    if (docUi.host.parentNode !== target) target.appendChild(docUi.host);
    if (ui.host.parentNode !== target) target.appendChild(ui.host);
  }

  function point(e) {
    const r = ui.host.getBoundingClientRect();
    return { x: clamp(e.clientX - r.left, 0, r.width), y: clamp(e.clientY - r.top, 0, r.height) };
  }

  function ensureHost() {
    if (ui) return ui;
    const host = document.createElement('div');
    host.id = 'vodblur-host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = CSS;

    const masksLayer = el('div', 'masks');
    const saved = el('div', 'layer');
    const live = el('div', 'layer');
    masksLayer.append(saved, live);

    const capture = el('div', 'capture');
    capture.hidden = true;

    const overlay = svgEl('svg', { class: 'overlay' });
    const gSaved = svgEl('g', {});
    const gLive = svgEl('g', {});
    overlay.append(gSaved, gLive);

    const handles = el('div', 'handles');
    const pickBox = el('div', 'pickbox');
    const pickLabel = el('span');
    pickBox.append(pickLabel);
    pickBox.hidden = true;
    const panel = parseHTML(PANEL_HTML);
    panel.hidden = true;

    root.append(style, masksLayer, capture, overlay, handles, pickBox, panel);

    // Documentlaag: absoluut op de oorsprong van het document, zodat wat erin staat met de pagina meescrolt.
    const docHost = document.createElement('div');
    docHost.id = 'vodblur-doc';
    docHost.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483646;pointer-events:none;';
    const docRoot = docHost.attachShadow({ mode: 'closed' });
    const docStyle = document.createElement('style');
    docStyle.textContent = CSS;
    const layer = el('div', 'doclayer');
    docRoot.append(docStyle, layer);
    docUi = { host: docHost, layer };

    const q = (id) => panel.querySelector('#' + id);
    ui = {
      host, root, saved, live, capture, gSaved, gLive, handles, pickBox, pickLabel, panel,
      grip: q('grip'), blurField: q('blurField'), colorField: q('colorField'),
      blur: q('blur'), blurOut: q('blurOut'), color: q('color'), pick: q('pick'), opacity: q('opacity'),
      opacityOut: q('opacityOut'), scope: q('scope'), save: q('save'), cancel: q('cancel'), clear: q('clear'),
      manage: q('manage'), preset: q('preset'), presetSave: q('presetSave'), presetForm: q('presetForm'),
      presetName: q('presetName'), presetOk: q('presetOk'), hintDraw: q('hintDraw'), hintPick: q('hintPick'),
      hintEdit: q('hintEdit'), hintOff: q('hintOff'), hintNoVideo: q('hintNoVideo'), hintMissing: q('hintMissing'),
    };
    place();
    wire();
    return ui;
  }

  function wire() {
    const { panel, capture, grip } = ui;

    for (const b of panel.querySelectorAll('[data-shape]')) {
      b.addEventListener('click', () => setShape(b.dataset.shape));
    }
    for (const b of panel.querySelectorAll('[data-mode]')) {
      b.addEventListener('click', () => setStyle({ mode: b.dataset.mode }));
    }
    for (const b of panel.querySelectorAll('[data-anchor]')) {
      b.addEventListener('click', () => setAnchor(b.dataset.anchor));
    }
    ui.blur.addEventListener('input', () => setStyle({ blur: Number(ui.blur.value) }));
    ui.color.addEventListener('input', () => setStyle({ color: ui.color.value }));
    ui.pick.addEventListener('click', (e) => {
      e.preventDefault(); // anders opent het label ook de kleurkiezer van het systeem
      openPicker(e);
    });
    ui.opacity.addEventListener('input', () => setStyle({ opacity: Number(ui.opacity.value) }));
    ui.scope.addEventListener('change', () => setScope(ui.scope.value));
    ui.save.addEventListener('click', save);
    ui.cancel.addEventListener('click', closeEditor);
    ui.clear.addEventListener('click', clearAll);
    ui.manage.addEventListener('click', () => browser.runtime.sendMessage({ type: 'open-options' }));
    ui.preset.addEventListener('change', () => applyPreset(ui.preset.value));
    ui.presetSave.addEventListener('click', openPresetForm);
    ui.presetOk.addEventListener('click', submitPreset);
    // Typen in het naamveld mag geen sneltoetsen van de pagina zelf raken (YouTube: f = fullscreen, k = pauze).
    for (const type of ['keydown', 'keypress', 'keyup']) {
      ui.presetName.addEventListener(type, (e) => e.stopPropagation());
    }

    // Paneel verslepen
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const pr = panel.getBoundingClientRect();
      const ox = e.clientX - pr.left, oy = e.clientY - pr.top;
      const move = (ev) => {
        panel.style.transform = 'none';
        panel.style.left = clamp(ev.clientX - ox, 0, Math.max(0, window.innerWidth - pr.width)) + 'px';
        panel.style.top = clamp(ev.clientY - oy, 0, Math.max(0, window.innerHeight - pr.height)) + 'px';
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });

    // Tekenen, kiezen en verplaatsen
    capture.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      capture.setPointerCapture(e.pointerId);
      measure();
      const p = point(e);
      const m = e.altKey ? null : hit(p);
      if (m) {
        selected = m.id;
        drag = { type: 'move', id: m.id, start: p, orig: pxBox(m) };
      } else if (prefs.shape === 'element') {
        // Elementkiezer: klikken legt een vlak over het opgelichte element (Alt = ook onder een bestaand vlak).
        hoverPick(e);
        const target = pickTarget && pickTarget.stack[pickTarget.i];
        selected = null;
        if (target) {
          const nm = elementMask(target);
          masks = [...masks, nm];
          selected = nm.id;
          dirty = true;
        }
      } else {
        selected = null;
        drag = { type: 'draw', shape: prefs.shape, start: p, pts: [p], preview: null };
      }
      render();
      syncPanel();
    });

    capture.addEventListener('pointermove', (e) => {
      const p = point(e);
      if (!drag) {
        const over = !e.altKey && !!hit(p);
        capture.classList.toggle('over', over);
        if (prefs.shape === 'element') {
          if (over) hidePick();
          else hoverPick(e);
        }
        return;
      }
      if (drag.type !== 'draw') {
        applyDrag(p);
        render();
      } else if (drag.shape === 'free') {
        const last = drag.pts[drag.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
        drag.pts.push(p);
        drawLive();
      } else {
        drag.preview = buildBox(drag.shape, drag.start, p, e.shiftKey, false);
        drawLive();
      }
    });

    capture.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.type === 'draw') {
        const m = d.shape === 'free' ? buildFree(d.pts) : buildBox(d.shape, d.start, point(e), e.shiftKey);
        if (m) {
          masks = [...masks, m];
          selected = m.id;
          dirty = true;
        }
      }
      render();
      syncPanel();
    });

    capture.addEventListener('pointercancel', () => {
      drag = null;
      render();
    });

    capture.addEventListener('pointerleave', () => {
      if (!drag) hidePick();
    });

    capture.addEventListener('wheel', (e) => {
      if (prefs.shape === 'element' && !drag) wheelPick(e);
    }, { passive: false });
  }

  // ---------------------------------------------------------------- volgen van video en venster

  // Elke frame meten waar de video staat; alleen bij een verandering opnieuw tekenen.
  function tick() {
    loop = 0;
    if (!ui || !(editing || masks.length)) return;
    place();
    measure();
    if (signature() !== frameSig) {
      render();
      if (editing) syncPanel();
    }
    if (editing && pickTarget) drawPick();
    loop = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (!loop) loop = requestAnimationFrame(tick);
  }

  document.addEventListener('fullscreenchange', () => {
    place();
    render();
  });

  // ---------------------------------------------------------------- opslag en berichten

  async function loadMasks() {
    const res = await browser.storage.local.get(SCOPES.map(keyFor));
    masks = SCOPES.flatMap((s) => {
      const list = res[keyFor(s)];
      // Vlakken van vóór versie 0.2 hebben geen anker: die hingen aan het venster.
      return Array.isArray(list) ? list.map((m) => ({ anchor: 'page', ...m, scope: s })) : [];
    });
    if (masks.length || ui) {
      ensureHost();
      render();
      syncPanel();
      startLoop();
    }
  }

  async function init() {
    const res = await browser.storage.local.get(PREFS_KEY);
    if (res[PREFS_KEY]) prefs = { ...DEFAULT_PREFS, ...res[PREFS_KEY] };
    await loadMasks();
  }

  // Tijdens het bewerken wint de editor; bij Opslaan wordt alles overschreven.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (PRESETS_KEY in changes && ui) loadPresets();
    if (!editing && SCOPES.some((s) => keyFor(s) in changes)) loadMasks();
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'toggle-editor') {
      if (editing) closeEditor();
      else openEditor();
    } else if (msg.type === 'toggle-visibility') {
      hidden = !hidden;
      render();
    }
  });

  // Single page apps (zoals YouTube) wisselen van URL zonder te herladen.
  function checkUrl() {
    const next = scopePaths();
    if (SCOPES.every((s) => next[s] === paths[s])) return;
    if (editing) closeEditor();
    paths = next;
    loadMasks();
  }

  try {
    window.navigation?.addEventListener('navigatesuccess', checkUrl);
  } catch {
    // Navigation API niet beschikbaar; de interval hieronder vangt het op.
  }
  setInterval(checkUrl, 1000);

  init();
})();
