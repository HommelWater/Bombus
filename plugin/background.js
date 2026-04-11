console.log('Background script loaded');

// Use browser.storage (native Firefox promises)
async function getApiUrl() {
  try {
    const result = await browser.storage.local.get('apiUrl');
    // Defensive check: result should be an object
    return (result && result.apiUrl) || null;
  } catch (err) {
    console.error('getApiUrl error:', err);
    return null;
  }
}

async function saveApiUrl(url) {
  try {
    await browser.storage.local.set({ apiUrl: url });
    return true;
  } catch (err) {
    console.error('saveApiUrl error:', err);
    return false;
  }
}

async function getSessionToken() {
  try {
    const result = await browser.storage.local.get('sessionToken');
    return (result && result.sessionToken) || null;
  } catch (err) {
    console.error('getSessionToken error:', err);
    return null;
  }
}

async function saveSessionToken(token) {
  try {
    await browser.storage.local.set({ sessionToken: token });
    return true;
  } catch (err) {
    console.error('saveSessionToken error:', err);
    return false;
  }
}

async function saveTheme(theme_id) {
  try {
    await browser.storage.local.set({ themeId: theme_id });
    return true;
  } catch (err) {
    console.error('saveTheme error:', err);
    return false;
  }
}


// Auto‑capture session token when visiting backend
async function tryCaptureSessionToken(tabId, url) {
  try {
    const apiUrl = await getApiUrl();
    if (!apiUrl) return;

    let apiOrigin, tabOrigin;
    try {
      apiOrigin = new URL(apiUrl).origin;
      tabOrigin = new URL(url).origin;
    } catch(e) { return; }
    if (apiOrigin !== tabOrigin) return;

    const results = await browser.tabs.executeScript(tabId, {
      code: `localStorage.getItem('session') || null`
    });
    const token = results && results[0];
    if (token) {
      await saveSessionToken(token);
      browser.browserAction.setBadgeText({ text: '✓' });
      setTimeout(() => browser.browserAction.setBadgeText({ text: '' }), 2000);
      console.log('Session token captured');
    }
  } catch (err) {
    console.warn('tryCaptureSessionToken error:', err);
  }
}

async function tryCaptureTheme(tabId, url) {
  try {
    const apiUrl = await getApiUrl();
    if (!apiUrl) return;

    let apiOrigin, tabOrigin;
    try {
      apiOrigin = new URL(apiUrl).origin;
      tabOrigin = new URL(url).origin;
    } catch(e) { return; }
    if (apiOrigin !== tabOrigin) return;

    const results = await browser.tabs.executeScript(tabId, {
      code: `localStorage.getItem('theme') || null`
    });
    const token = results && results[0];
    if (token) {
      await saveSessionToken(token);
      browser.browserAction.setBadgeText({ text: '✓' });
      setTimeout(() => browser.browserAction.setBadgeText({ text: '' }), 2000);
      console.log('Session token captured');
    }
  } catch (err) {
    console.warn('tryCaptureSessionToken error:', err);
  }
}

// Listen for page loads
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    tryCaptureSessionToken(tabId, tab.url).catch(console.error);
  }
});

// Index current page
async function indexCurrentPage() {
  const apiUrl = await getApiUrl();
  if (!apiUrl) throw new Error('Please set your API URL in the popup first.');

  const sessionToken = await getSessionToken();
  if (!sessionToken) throw new Error('No session token. Visit your backend site once to auto‑capture it.');

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) throw new Error('No active tab');

  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const base64 = dataUrl.split(',')[1];

  const response = await fetch(`${apiUrl}/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_token: sessionToken,
      url: tab.url,
      title: tab.title,
      image_base64: base64
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Indexing failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// Message handling
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setApiUrl') {
    saveApiUrl(request.url).then(() => sendResponse({ success: true }));
    return true;
  }
  if (request.action === 'getApiUrl') {
    getApiUrl().then(url => sendResponse({ url }));
    return true;
  }
  if (request.action === 'indexPage') {
    indexCurrentPage()
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});