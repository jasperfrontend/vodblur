// Firefox draait dit als achtergrondscript (MV2), Chrome als service worker (MV3).
globalThis.browser ??= globalThis.chrome;
const action = browser.action ?? browser.browserAction;

// Toolbarknop: tekenmodus aan of uit in het actieve tabblad.
action.onClicked.addListener((tab) => {
  browser.tabs.sendMessage(tab.id, { type: 'toggle-editor' }).catch(() => {
    // Op pagina's waar content scripts niet mogen draaien (about:, addons.mozilla.org) valt hier niets te doen.
  });
});

// Sneltoets: opgeslagen vlakken tijdelijk tonen of verbergen.
browser.commands.onCommand.addListener(async (name) => {
  if (name !== 'toggle-masks') return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    browser.tabs.sendMessage(tab.id, { type: 'toggle-visibility' }).catch(() => {});
  }
});

// Overzichtspagina openen en schermafbeeldingen maken voor de kleurkiezer; content scripts kunnen dat zelf niet.
// sendResponse in plaats van een promise teruggeven: dat laatste kan Chrome niet.
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'open-options') browser.runtime.openOptionsPage();
  if (msg.type === 'capture') {
    browser.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }).then(sendResponse, () => sendResponse(null));
    return true;
  }
});
