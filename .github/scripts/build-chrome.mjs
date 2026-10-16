// Builds the Chrome (Manifest V3) version of the extension from the Firefox source in vodblur/.
// The code is shared; only the manifest differs, plus the PNG icons Chrome needs (it can't use SVG).
//
// Usage: node .github/scripts/build-chrome.mjs [outDir]   (default: dist/chrome)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(root, 'vodblur');
const out = path.resolve(root, process.argv[2] || 'dist/chrome');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true, filter: (f) => path.basename(f) !== 'manifest.json' });
fs.cpSync(path.join(root, 'chrome'), out, { recursive: true });

const ff = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const icons = Object.fromEntries([16, 32, 48, 128].map((n) => [n, `icons/icon-${n}.png`]));
const isHost = (p) => p === '<all_urls>' || p.includes('://');

const manifest = {
  manifest_version: 3,
  name: ff.name,
  version: ff.version,
  description: ff.description,
  default_locale: ff.default_locale,
  minimum_chrome_version: '120',
  icons,
  permissions: ff.permissions.filter((p) => !isHost(p)),
  host_permissions: ff.permissions.filter(isHost),
  background: { service_worker: ff.background.scripts[0] },
  action: { default_title: ff.browser_action.default_title, default_icon: icons },
  commands: ff.commands,
  content_scripts: ff.content_scripts,
  options_ui: ff.options_ui,
};

fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Chrome build ${manifest.version} -> ${path.relative(root, out)}`);
