// Uploads a Chrome build to the Chrome Web Store and submits it for review (Chrome Web Store API v2).
// Google reviews every version; once approved it's published to all users automatically.
//
// Usage: node .github/scripts/chrome-publish.mjs <zip>
//        node .github/scripts/chrome-publish.mjs --check   (only log in and print the item's status)
// Env:   CWS_SERVICE_ACCOUNT_KEY  JSON key of the service account linked in the CWS dashboard (Account section)
//        CWS_PUBLISHER_ID         publisher ID from the dashboard (Publisher > Settings)
//        CWS_ITEM_ID              optional, defaults to the VOD Blur item
// Docs:  https://developer.chrome.com/docs/webstore/using-api
//        https://developer.chrome.com/docs/webstore/service-accounts
import fs from 'node:fs';
import crypto from 'node:crypto';

const ITEM_ID = process.env.CWS_ITEM_ID || 'pddbjjnckpkabideenkmlklcpnmfblmd';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
// Overridable only so the script can be tested against a local mock server.
const TOKEN_URL = process.env.CWS_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const API = process.env.CWS_API_ROOT || 'https://chromewebstore.googleapis.com';

const zip = process.argv[2];
const check = zip === '--check';
const { CWS_SERVICE_ACCOUNT_KEY: keyJson, CWS_PUBLISHER_ID: publisher } = process.env;
if (!check && (!zip || !fs.existsSync(zip))) throw new Error(`zip not found: ${zip}`);
if (check && (!keyJson || !publisher)) throw new Error('CWS_SERVICE_ACCOUNT_KEY or CWS_PUBLISHER_ID not set');
if (!keyJson || !publisher) {
  // Not set up yet: don't fail the release, just say so.
  console.log('::warning::CWS_SERVICE_ACCOUNT_KEY or CWS_PUBLISHER_ID not set, skipping Chrome Web Store publish');
  process.exit(0);
}

const b64url = (v) => Buffer.from(v).toString('base64url');

// Service account -> signed JWT -> short-lived access token.
async function accessToken() {
  const key = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`token request failed (${res.status}): ${JSON.stringify(body)}`);
  return body.access_token;
}

async function call(method, url, token, body, contentType) {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...(contentType && { 'content-type': contentType }) }, body });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${url} failed (${res.status}): ${text}`);
  return json;
}

const item = `publishers/${publisher}/items/${ITEM_ID}`;
const token = await accessToken();

if (check) {
  const status = await call('GET', `${API}/v2/${item}:fetchStatus`, token);
  console.log(JSON.stringify(status, null, 2));
  const live = status.publishedItemRevisionStatus, sub = status.submittedItemRevisionStatus;
  console.log(`OK: logged in and read the item. Published: ${live?.distributionChannels?.[0]?.crxVersion || 'none'} (${live?.state || 'unknown'}).`);
  console.log(sub ? `Submitted: ${sub.distributionChannels?.[0]?.crxVersion || '?'} (${sub.state}).` : 'Nothing in review.');
  process.exit(0);
}

// Google refuses uploads while an earlier version is still in review. Don't fail the release over that:
// warn, and let the "Chrome Web Store" workflow (action: publish) submit this tag once the review is done.
const before = await call('GET', `${API}/v2/${item}:fetchStatus`, token);
const pending = before.submittedItemRevisionStatus;
if (pending?.state === 'PENDING_REVIEW') {
  const v = pending.distributionChannels?.[0]?.crxVersion || 'an earlier version';
  console.log(`::warning::Chrome Web Store: ${v} is still in review, so this version can't be uploaded yet. ` +
    'When the review is done, run the "Chrome Web Store" workflow with action "publish" and this tag.');
  process.exit(0);
}

let upload = await call('POST', `${API}/upload/v2/${item}:upload`, token, fs.readFileSync(zip), 'application/zip');
console.log('upload:', JSON.stringify(upload));
let state = upload.uploadState;

// Large or slow uploads finish asynchronously; poll for up to ~2 minutes.
for (let i = 0; /IN_PROGRESS/.test(state) && i < 24; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const status = await call('GET', `${API}/v2/${item}:fetchStatus`, token);
  state = status.lastAsyncUploadState;
  console.log('upload state:', state);
}
if (state !== 'SUCCEEDED') throw new Error(`upload did not succeed: ${state}`);

const publish = await call('POST', `${API}/v2/${item}:publish`, token, '{}', 'application/json');
console.log('publish:', JSON.stringify(publish));
for (const w of publish.warningInfo?.warnings || []) console.log(`::warning::${w.reason}: ${w.description}`);
if (['REJECTED', 'CANCELLED'].includes(publish.state)) throw new Error(`publish state: ${publish.state}`);
console.log(`Submitted to the Chrome Web Store (${publish.state}). Google reviews it before it goes live.`);
