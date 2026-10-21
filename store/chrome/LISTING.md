# Chrome Web Store listing

Everything to fill in on the [developer dashboard](https://chrome.google.com/webstore/devconsole), tab by tab. Text blocks are ready to paste.

## Package

Upload `vodblur-chrome-<version>.zip` from the GitHub Release (the release workflow builds it). For a local build: `node .github/scripts/build-chrome.mjs` and zip the *contents* of `dist/chrome`, so `manifest.json` sits at the root of the zip.

The name and the short summary come from the manifest (`_locales/*/messages.json`, key `extDescription`, max 132 characters). The store shows the Dutch summary to Dutch users automatically.

## Store listing

**Description**

```
VOD Blur lets you draw a shape over any part of a video or web page and blur it, or cover it with a solid color. Built for streamers: whatever you blur in your browser is blurred on your stream and in your VODs too.

WHAT STREAMERS USE IT FOR
• Reacting to videos and VODs: hide burned-in chat, alerts, usernames, watermarks and spoilers.
• Shopping on stream: cover your shipping address, phone number, email, order numbers and card digits at checkout.
• Browsing live: blur DM sidebars, notifications, comments, recommended feeds and dashboard numbers.

HOW IT WORKS
1. Click the VOD Blur icon to open the editor on the current page.
2. Draw a rectangle, ellipse, triangle or freehand shape. Hold Shift for a perfect square or circle.
3. Choose a blur strength or a solid color. The color picker reads straight from the page with a magnifier, and can average anything from 1 pixel to 15×15 pixels, so a cover blends in with compressed video.
4. Save it for this page, this section of the site, or the whole site. Next time you open it, your shapes are already there.

DETAILS
• Sticks to the video: shapes follow the actual video picture, so they stay in place in theater mode, fullscreen and when you resize the window. You can also pin a shape to the window instead.
• Edit any time: move, resize, nudge with the arrow keys, delete, or switch a single shape off without losing it.
• Presets: save your usual setup (say, chat on the right) once and add it to any other video with one click.
• Alt+Shift+H shows or hides all shapes for a moment.
• An overview page lists every saved shape and preset, and exports them to a file as a backup or to move them to another browser.
• Available in English, Dutch and Japanese.

PRIVATE BY DESIGN
No account, no analytics, no servers. Your shapes are stored in your own browser and never leave it. VOD Blur is open source (MIT): https://github.com/jasperfrontend/vodblur

Tip: draw your shapes before you go live and check them in your OBS preview. VOD Blur is a safety net, not a guarantee.
```

**Category:** Productivity › Tools (alternative: Make Chrome Yours › Privacy & Security)

**Language:** English

**Graphic assets** (all in this folder)

| Field | File |
|---|---|
| Store icon (128×128) | `chrome/icons/icon-128.png` |
| Screenshots (1280×800), in this order | `1-vod-chat-blurred.png`, `2-editor-vod.png`, `3-color-picker.png`, `4-checkout-covered.png`, `5-overview.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile (1400×560, optional) | `promo-marquee-1400x560.png` |

The screenshots are real captures of the Chrome build on mock pages (a generic video site and a shop), with made-up names and addresses.

**Official URL:** leave empty (it requires verifying vodblur.com in Google Search Console; can be added later).
**Homepage URL:** `https://vodblur.com/`
**Support URL:** `https://github.com/jasperfrontend/vodblur/issues`
**Mature content:** No

## Privacy practices

**Single purpose description**

```
VOD Blur lets the user hide parts of web pages and videos on their own screen by drawing shapes that blur or cover what is underneath, for example to keep private information or another stream's chat off a live stream.
```

**Permission justification: storage**

```
Saves the shapes the user draws (position, shape type, blur or color, and the page, site section or site they belong to) and the user's last-used settings, so the shapes come back when the user revisits that page. Everything is stored locally with chrome.storage.local and is never transmitted.
```

**Permission justification: host permission (`<all_urls>`)**

```
The extension draws the user's shapes on top of whatever page they are viewing, and restores saved shapes when they return to it. The user decides which sites that is (video sites, shops, forums, dashboards), so the content script has to be able to run on any site. The same permission lets the background script call tabs.captureVisibleTab when the user opens the built-in color picker: the screenshot is used in memory so the user can pick a color from the page, and is discarded as soon as they pick one or cancel. The extension does not read, collect or transmit page content.
```

**Remote code:** No, I am not using remote code.

**Data usage:** tick none of the data types; the extension collects nothing. Then tick all three certifications (not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending).

**Privacy policy URL:** `https://vodblur.com/privacy.html`

## Distribution

**Payments:** Free. **Visibility:** Public. **Regions:** all.

## Test instructions (if the dashboard asks for them)

```
1. Open any page with a video (for example a YouTube or Twitch video) and click the VOD Blur toolbar icon.
2. Drag over part of the video to draw a shape; it is blurred immediately. Click Save.
3. Reload the page: the shape comes back in the same place on the video.
4. To test the color picker: click the shape, choose Color, click the pipette next to the color swatch, scroll to change the sample size and click to pick.
No account or login is needed.
```

## Notes

- Broad host permissions (`<all_urls>`) usually mean a longer, in-depth review. The justification above explains why it's needed; there is no narrower option, because users choose the sites themselves.
- The Chrome Web Store assigns its own extension ID. It doesn't affect the Firefox version.
- After approval, update the Chrome button on `site/index.html` (it says "coming soon") with the store link.
