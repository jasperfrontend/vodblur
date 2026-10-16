// Overzicht van alle opgeslagen vlakken, gegroepeerd per site.
'use strict';
globalThis.browser ??= globalThis.chrome;

const t = (key, sub) => browser.i18n.getMessage(key, sub);

const TYPES = [
  { prefix: 'masks-page:', label: t('typePage'), order: 0 },
  { prefix: 'masks:', label: t('typeSection'), order: 1 },
  { prefix: 'masks-site:', label: t('typeSite'), order: 2 },
];

const list = document.getElementById('list');
const empty = document.getElementById('empty');
const footer = document.getElementById('footer');

// Vaste teksten uit _locales; optionsSub bevat <b>-tags, dus die gaat via DOMParser.
document.documentElement.lang = browser.i18n.getUILanguage();
for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
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
  const parts = [];
  if (video) parts.push(t('onVideo', String(video)));
  if (element) parts.push(t('onElement', String(element)));
  if (n - video - element) parts.push(t('onWindow', String(n - video - element)));
  return `${n === 1 ? t('countOne') : t('countMany', String(n))} (${parts.join(', ')})`;
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

  empty.hidden = entries.length > 0;
  footer.hidden = entries.length === 0;
  footer.replaceChildren(confirmButton(t('removeAll'), () => browser.storage.local.remove(entries.map((e) => e.key))));
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') render();
});

render();
