// Overzicht van alle opgeslagen vlakken, gegroepeerd per site, plus presets en exporteren/importeren.
'use strict';
globalThis.browser ??= globalThis.chrome;

const t = (key, sub) => browser.i18n.getMessage(key, sub);

const TYPES = [
  { prefix: 'masks-page:', label: t('typePage'), order: 0 },
  { prefix: 'masks:', label: t('typeSection'), order: 1 },
  { prefix: 'masks-site:', label: t('typeSite'), order: 2 },
];
const PRESETS_KEY = 'presets';

const list = document.getElementById('list');
const empty = document.getElementById('empty');
const footer = document.getElementById('footer');
const presetBox = document.getElementById('presets');
const presetList = document.getElementById('presetList');
const status = document.getElementById('status');
const exportBtn = document.getElementById('export');
const importBtn = document.getElementById('import');
const fileInput = document.getElementById('file');

// Vaste teksten uit _locales; optionsSub bevat <b>-tags, dus die gaat via DOMParser.
document.documentElement.lang = browser.i18n.getUILanguage();
for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
for (const e of document.querySelectorAll('[data-i18n-title]')) e.title = t(e.dataset.i18nTitle);
for (const e of document.querySelectorAll('[data-i18n-html]')) {
  const doc = new DOMParser().parseFromString(t(e.dataset.i18nHtml), 'text/html');
  e.replaceChildren(...doc.body.childNodes);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function parse(key, value) {
  const type = TYPES.find((ty) => key.startsWith(ty.prefix));
  if (!type || !Array.isArray(value) || !value.length) return null;
  const where = key.slice(type.prefix.length);
  return { key, type, where, host: where.split('/')[0], masks: value };
}

function describe(masks) {
  const n = masks.length;
  const video = masks.filter((m) => m.anchor === 'video').length;
  const element = masks.filter((m) => m.anchor === 'element').length;
  const off = masks.filter((m) => m.off).length;
  const parts = [];
  if (video) parts.push(t('onVideo', String(video)));
  if (element) parts.push(t('onElement', String(element)));
  if (n - video - element) parts.push(t('onWindow', String(n - video - element)));
  const text = `${n === 1 ? t('countOne') : t('countMany', String(n))} (${parts.join(', ')})`;
  return off ? `${text}, ${t('countOff', String(off))}` : text;
}

// Knop die bij de eerste klik om bevestiging vraagt.
function confirmButton(label, onConfirm) {
  const b = el('button', '', label);
  let timer = null;
  b.addEventListener('click', () => {
    if (timer) {
      clearTimeout(timer);
      onConfirm();
      return;
    }
    b.textContent = t('sure');
    b.classList.add('armed');
    timer = setTimeout(() => {
      timer = null;
      b.textContent = label;
      b.classList.remove('armed');
    }, 3000);
  });
  return b;
}

function item(entry) {
  const row = el('div', 'item');
  const where = el('span', 'where');
  if (entry.type.prefix === 'masks-page:') {
    const a = el('a', '', entry.where);
    a.href = 'https://' + entry.where;
    a.target = '_blank';
    a.rel = 'noopener';
    where.append(a);
  } else {
    where.textContent = entry.where;
  }
  row.append(
    el('span', 'type', entry.type.label),
    where,
    el('span', 'count', describe(entry.masks)),
    confirmButton(t('remove'), () => browser.storage.local.remove(entry.key)),
  );
  return row;
}

// ---------------------------------------------------------------- presets

async function savePresets(fn) {
  const res = await browser.storage.local.get(PRESETS_KEY);
  const next = fn(Array.isArray(res[PRESETS_KEY]) ? res[PRESETS_KEY] : []);
  if (next.length) await browser.storage.local.set({ [PRESETS_KEY]: next });
  else await browser.storage.local.remove(PRESETS_KEY);
}

// De naam wordt een invoerveld; Enter of wegklikken bewaart, Esc annuleert.
function rename(preset, where) {
  const input = el('input');
  input.type = 'text';
  input.maxLength = 40;
  input.value = preset.name;
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (keep && name && name !== preset.name) {
      savePresets((list) => list.map((p) => (p.id === preset.id ? { ...p, name } : p)));
    } else {
      where.textContent = preset.name;
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  where.replaceChildren(input);
  input.focus();
  input.select();
}

function presetItem(preset) {
  const row = el('div', 'item');
  const where = el('span', 'where', preset.name);
  const renameBtn = el('button', '', t('rename'));
  renameBtn.addEventListener('click', () => rename(preset, where));
  row.append(
    where,
    el('span', 'count', describe(preset.masks)),
    renameBtn,
    confirmButton(t('remove'), () => savePresets((list) => list.filter((p) => p.id !== preset.id))),
  );
  return row;
}

// ---------------------------------------------------------------- exporteren en importeren

const SHAPES = ['rect', 'ellipse', 'triangle', 'free'];
const ANCHORS = ['video', 'page', 'element'];
const ID = /^[\w-]{1,40}$/;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Een geïmporteerd bestand komt van buiten: alleen bekende velden met het juiste type gaan mee, de rest valt weg.
function cleanMask(m) {
  if (!m || typeof m !== 'object') return null;
  const { shape, anchor = 'page', box } = m;
  if (!SHAPES.includes(shape) || !ANCHORS.includes(anchor)) return null;
  if (!box || !['x', 'y', 'w', 'h'].every((k) => num(box[k])) || box.w <= 0 || box.h <= 0) return null;
  const out = {
    id: typeof m.id === 'string' && ID.test(m.id) ? m.id : uid(),
    shape,
    anchor,
    box: { x: box.x, y: box.y, w: box.w, h: box.h },
    mode: m.mode === 'color' ? 'color' : 'blur',
    color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#000000',
    opacity: num(m.opacity) ? clamp(m.opacity, 10, 100) : 100,
    blur: num(m.blur) ? clamp(m.blur, 2, 60) : 20,
  };
  if (shape === 'free') {
    const ok = Array.isArray(m.pts) && m.pts.length >= 3 && m.pts.length <= 1000
      && m.pts.every((pt) => Array.isArray(pt) && pt.length === 2 && num(pt[0]) && num(pt[1]));
    if (!ok) return null;
    out.pts = m.pts.map(([x, y]) => [x, y]);
  }
  if (anchor === 'element') {
    const sel = m.el && m.el.sel;
    if (typeof sel !== 'string' || !sel || sel.length > 2000) return null;
    out.el = { sel };
  }
  if (m.off === true) out.off = true;
  return out;
}

function cleanPreset(p) {
  if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.masks)) return null;
  const masks = p.masks.map(cleanMask).filter(Boolean).map(({ id, ...rest }) => rest);
  if (!masks.length) return null;
  return { id: typeof p.id === 'string' && ID.test(p.id) ? p.id : uid(), name: p.name.trim().slice(0, 40), masks };
}

// Samenvoegen op id: wat je al had blijft staan, een item met hetzelfde id wordt vervangen door de import.
function mergeById(current, incoming) {
  const map = new Map((Array.isArray(current) ? current : []).map((x) => [x.id, x]));
  for (const x of incoming) map.set(x.id, x);
  return [...map.values()];
}

function showStatus(text, error) {
  status.textContent = text;
  status.classList.toggle('error', !!error);
  status.hidden = false;
}

async function exportAll() {
  const all = await browser.storage.local.get(null);
  const data = {};
  for (const [k, v] of Object.entries(all)) if (parse(k, v) || k === PRESETS_KEY) data[k] = v;
  const json = JSON.stringify({ app: 'vodblur', version: 1, exported: new Date().toISOString(), data }, null, 2);
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `vodblur-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importFile(file) {
  let doc = null;
  try {
    doc = JSON.parse(await file.text());
  } catch {
    // Geen JSON: valt hieronder af.
  }
  if (!doc || doc.app !== 'vodblur' || !doc.data || typeof doc.data !== 'object') {
    showStatus(t('importFailed'), true);
    return;
  }
  const all = await browser.storage.local.get(null);
  const set = {};
  let shapes = 0, presets = 0;
  for (const [key, value] of Object.entries(doc.data)) {
    if (!Array.isArray(value)) continue;
    if (key === PRESETS_KEY) {
      const clean = value.map(cleanPreset).filter(Boolean);
      if (clean.length) set[key] = mergeById(all[key], clean);
      presets += clean.length;
    } else if (TYPES.some((ty) => key.startsWith(ty.prefix) && key.length > ty.prefix.length)) {
      const clean = value.map(cleanMask).filter(Boolean);
      if (clean.length) set[key] = mergeById(all[key], clean);
      shapes += clean.length;
    }
  }
  if (!shapes && !presets) {
    showStatus(t('importFailed'), true);
    return;
  }
  await browser.storage.local.set(set);
  showStatus(t('importDone', [String(shapes), String(presets)]));
}

exportBtn.addEventListener('click', exportAll);
importBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (file) importFile(file);
});

// ---------------------------------------------------------------- tekenen

async function render() {
  const all = await browser.storage.local.get(null);
  const entries = Object.entries(all).map(([k, v]) => parse(k, v)).filter(Boolean);
  entries.sort((a, b) => a.host.localeCompare(b.host) || a.type.order - b.type.order || a.where.localeCompare(b.where));

  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.host)) groups.set(e.host, []);
    groups.get(e.host).push(e);
  }
  list.replaceChildren(...[...groups].map(([host, items]) => {
    const section = el('section', 'site');
    section.append(el('h2', '', host), ...items.map(item));
    return section;
  }));

  const presets = Array.isArray(all[PRESETS_KEY]) ? all[PRESETS_KEY] : [];
  presetBox.hidden = presets.length === 0;
  presetList.replaceChildren(...presets.map(presetItem));

  empty.hidden = entries.length > 0;
  footer.hidden = entries.length === 0;
  footer.replaceChildren(confirmButton(t('removeAll'), () => browser.storage.local.remove(entries.map((e) => e.key))));
  exportBtn.disabled = entries.length === 0 && presets.length === 0;
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') render();
});

render();
