# VOD Blur

A tiny Firefox and Chrome extension that lets you draw shapes over a page and blur or cover whatever is underneath. Built to hide burned-in live chat in stream VODs, so you can watch without getting distracted, but it works on any page.

The interface is in English and Dutch; it follows your browser's language.

## Features

- **Shapes:** freehand, rectangle, ellipse and triangle (hold Shift for a perfect square or circle).
- **Blur or colour:** a backdrop blur (2–60px) or a solid colour with adjustable opacity.
- **Pick a colour from the page:** the pipette freezes the page and shows a loupe; click to take that colour. Scroll to average over 1px, 3×3, 5×5, 9×9 or 15×15 pixels, so a cover colour blends in with noisy video. Esc cancels.
- **Sticks to the video:** shapes are stored as percentages of the actual video picture (letterboxing excluded), so they stay in place in theatre mode, fullscreen and after resizing. You can also pin a shape to the browser window instead.
- **Sticks to the page:** click the pick tool and then any part of a page (an address block, a chat list, a sidebar) to cover exactly that element; scroll to select the element around it. Drawn shapes can stick to the element underneath too (**Stick to: Element**). These shapes scroll along with the page, also inside scrolling boxes such as a chat list, and come back on reload as soon as the element appears, before it's painted.
- **Edit afterwards:** click a shape to select it, drag to move, drag the corners to resize, nudge with the arrow keys (Shift = 10px), Delete to remove.
- **Choose where shapes apply:** this page (one video), this site section (e.g. `www.twitch.tv/videos`) or the whole site.
- **Overview page:** see and delete saved shapes per site.
- **Quick toggle:** `Alt+Shift+H` hides or shows all shapes on the current page.

## Install

Install VOD Blur from [addons.mozilla.org](https://addons.mozilla.org/firefox/addon/vod-blur/); Firefox keeps it up to date. (Up to 0.5.0 it was self-distributed as a signed `.xpi` in the GitHub Releases; from 0.5.1 on it's a public AMO add-on.)

To run from source instead:

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `vodblur/manifest.json`.

Temporary add-ons disappear when Firefox restarts.

Requires Firefox 142 or newer.

### Chrome

Install VOD Blur from the [Chrome Web Store](https://chromewebstore.google.com/detail/vod-blur/pddbjjnckpkabideenkmlklcpnmfblmd); Chrome keeps it up to date.

The Chrome version is built from the same source. `node .github/scripts/build-chrome.mjs` writes it to `dist/chrome`, with a Manifest V3 manifest generated from the Firefox one and the PNG icons from `chrome/icons`. To try it, open `chrome://extensions`, turn on Developer mode and choose **Load unpacked** on `dist/chrome`.

## Usage

1. Open a page with a video and click the VOD Blur toolbar icon.
2. Drag over the area you want hidden. Draw as many shapes as you like.
3. Pick blur or colour, what the shape sticks to (**Stick to**: Video / Element / Window) and where it applies (**Save for**).
4. Click **Save** (or press Enter). **Cancel** (or Esc) discards everything since you opened the editor.

## Releasing

The extension has no build step. [A GitHub Action](.github/workflows/release.yml) submits every release to both stores, without waiting for their reviews:

1. Bump `version` in `vodblur/manifest.json` and commit. Every version number can be used only once per store.
2. Tag and push: `git tag v0.5.2 && git push origin v0.5.2` (the tag must match the manifest version).
3. The workflow lints, builds the Chrome zip and creates a GitHub Release with it.
4. It submits the extension to addons.mozilla.org as a listed add-on. Mozilla reviews it, publishes it and updates installed copies. The listing's summary, description and categories come from `.github/amo-metadata.json` and are sent with every release, so edit them there rather than on AMO.
5. It submits the Chrome zip to the Chrome Web Store. Google reviews every version (often an in-depth review, because the extension runs on all sites) and publishes it when approved; Chrome updates installed copies by itself. Google refuses a new upload while an earlier version is still in review; the step then skips Chrome with a warning. Submit that version later from **Actions → Chrome Web Store → Run workflow**, with action `publish` and the release tag (action `check` shows what's published and what's in review).

Check the review status in the [AMO Developer Hub](https://addons.mozilla.org/developers/addons) and the [Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole).

The workflow needs these repository secrets:

- `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` from [AMO's API key page](https://addons.mozilla.org/developers/addon/api/key/).
- `CWS_SERVICE_ACCOUNT_KEY` and `CWS_PUBLISHER_ID` for the Chrome Web Store. Without them the Chrome step is skipped with a warning and you upload the zip by hand.

Setting up the Chrome Web Store secrets (once, see Google's [service account guide](https://developer.chrome.com/docs/webstore/service-accounts)):

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (or reuse one) and enable the **Chrome Web Store API**.
2. Under **IAM & Admin → Service accounts**, create a service account. It needs no roles. Open it, go to **Keys → Add key → Create new key → JSON** and download the key file.
3. In the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole), open **Account** and add the service account's email address (one service account per publisher). The Google account that owns the store item needs 2-step verification.
4. Copy the publisher ID from **Publisher → Settings** in the dashboard.
5. In the GitHub repo, under **Settings → Secrets and variables → Actions**, add `CWS_SERVICE_ACCOUNT_KEY` (the full contents of the JSON key file) and `CWS_PUBLISHER_ID`. Then delete the downloaded key file, or keep it only in your password manager.

## Website

`site/index.html` is the single-page site for vodblur.com: plain HTML, no build step and no external requests. Cloudflare deploys it on every push to `main` as a Worker with static assets only; `wrangler.jsonc` points it at `site/`, so nothing else in the repo is published.

## Privacy

VOD Blur collects no data. Shapes and preferences are stored locally with `browser.storage.local` and never leave your browser.

## License

[MIT](LICENSE)
