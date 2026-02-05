// ASIN Scout Pro v2 - Paket bazlı sistem
const API_BASE = 'https://asinscout.com/api'; // KENDİ DOMAİNİNİZİ YAZIN

const S = { scanning: false, storeName: '', scanned: 0, asins: [], set: new Set(), lastUpdate: '', tabId: null, scanId: null, token: null, user: null, isLoggedIn: false };

chrome.storage.local.get(['token', 'user'], (d) => { if (d.token) { S.token = d.token; S.user = d.user; S.isLoggedIn = true; refreshProfile(); } });

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg.action === 'login') { handleLogin(msg.email, msg.password).then(send); return true; }
  if (msg.action === 'register') { handleRegister(msg.email, msg.password, msg.name).then(send); return true; }
  if (msg.action === 'logout') { S.token = null; S.user = null; S.isLoggedIn = false; chrome.storage.local.remove(['token', 'user']); send({ ok: true }); }
  if (msg.action === 'getAuthState') { send({ isLoggedIn: S.isLoggedIn, user: S.user }); }
  if (msg.action === 'refreshProfile') { refreshProfile().then(send); return true; }
  if (msg.action === 'startScan') {
    if (!S.isLoggedIn || !S.user?.scan_limit) { send({ error: 'No package' }); return; }
    S.asins = []; S.set = new Set(); S.scanned = 0; S.scanning = true; S.storeName = msg.storeName || ''; S.tabId = msg.tabId; S.lastUpdate = 'Starting...';
    startScanApi(msg.baseUrl, msg.storeName).then(r => {
      if (r.scan_id) { S.scanId = r.scan_id; save(); badge('...', '#ff6b2c'); injectAndStart(msg.tabId, msg.baseUrl, S.user.scan_limit); }
      else { S.scanning = false; S.lastUpdate = r.error || 'Error'; save(); }
    });
    send({ ok: true });
  }
  else if (msg.action === 'stopScan') { S.scanning = false; S.lastUpdate = 'Stopped: ' + S.asins.length + ' ASIN'; save(); badge(String(S.asins.length), '#ff4d5e'); if (S.tabId) try { chrome.tabs.sendMessage(S.tabId, { action: 'stopFetchScan' }); } catch(e) {} send({ ok: true }); }
  else if (msg.action === 'progressUpdate') { if (!S.scanning) return; S.asins = msg.asins || []; S.set = new Set(S.asins); S.scanned = msg.scanned || S.scanned; S.lastUpdate = msg.status || S.lastUpdate; save(); badge(fmtNum(S.asins.length), '#ff6b2c'); }
  else if (msg.action === 'scanComplete') { S.scanning = false; S.asins = msg.asins || []; S.scanned = msg.scanned || S.scanned; S.lastUpdate = '✅ ' + S.asins.length + ' ASIN'; if (S.scanId && S.asins.length > 0) completeScanApi(S.scanId, S.asins, S.scanned, msg.duration || 0); badge(fmtNum(S.asins.length), '#22c97a'); save(); }
  else if (msg.action === 'getState') { send({ scanning: S.scanning, storeName: S.storeName, scanned: S.scanned, total: S.asins.length, lastUpdate: S.lastUpdate, isLoggedIn: S.isLoggedIn, user: S.user }); }
  else if (msg.action === 'getAsins') { send({ asins: S.asins, storeName: S.storeName }); }
  else if (msg.action === 'clearAll') { S.asins = []; S.set = new Set(); S.scanned = 0; S.storeName = ''; S.lastUpdate = ''; S.scanning = false; save(); badge('', '#22c97a'); send({ ok: true }); }
  return true;
});

async function handleLogin(email, password) {
  try {
    const r = await fetch(API_BASE + '/auth.php?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const d = await r.json();
    if (d.success) { S.token = d.data.token; S.user = d.data.user; S.isLoggedIn = true; chrome.storage.local.set({ token: S.token, user: S.user }); return { ok: true, user: S.user }; }
    return { error: d.message };
  } catch(e) { return { error: 'Connection error' }; }
}

async function handleRegister(email, password, name) {
  try {
    const r = await fetch(API_BASE + '/auth.php?action=register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name }) });
    const d = await r.json();
    if (d.success) { S.token = d.data.token; S.user = d.data.user; S.isLoggedIn = true; chrome.storage.local.set({ token: S.token, user: S.user }); return { ok: true, user: S.user, message: d.message }; }
    return { error: d.message };
  } catch(e) { return { error: 'Connection error' }; }
}

async function refreshProfile() {
  if (!S.token) return { error: 'Not logged in' };
  try {
    const r = await fetch(API_BASE + '/auth.php?action=profile', { headers: { 'Authorization': 'Bearer ' + S.token } });
    const d = await r.json();
    if (d.success) { S.user = d.data.user; chrome.storage.local.set({ user: S.user }); return { ok: true, user: S.user }; }
    return { error: d.message };
  } catch(e) { return { error: 'Connection error' }; }
}

async function startScanApi(url, name) {
  if (!S.token) return { error: 'Not logged in' };
  try {
    const r = await fetch(API_BASE + '/scans.php?action=start', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.token }, body: JSON.stringify({ store_url: url, store_name: name }) });
    const d = await r.json();
    return d.success ? { scan_id: d.data.scan_id } : { error: d.message };
  } catch(e) { return { error: 'Connection error' }; }
}

async function completeScanApi(scanId, asins, pages, duration) {
  if (!S.token) return;
  try { await fetch(API_BASE + '/scans.php?action=complete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.token }, body: JSON.stringify({ scan_id: scanId, asins, pages_scanned: pages, duration }) }); } catch(e) {}
}

async function injectAndStart(tabId, baseUrl, scanLimit) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 500));
    chrome.tabs.sendMessage(tabId, { action: 'startFetchScan', baseUrl, scanLimit }, r => {
      if (chrome.runtime.lastError) { S.scanning = false; S.lastUpdate = 'Error: Refresh page'; save(); badge('ERR', '#ff4d5e'); }
    });
  } catch(e) { S.scanning = false; S.lastUpdate = 'Error: ' + e.message; save(); badge('ERR', '#ff4d5e'); }
}

function fmtNum(n) { return n >= 10000 ? Math.round(n/1000) + 'K' : String(n); }
function save() { chrome.storage.local.set({ asins: S.asins, storeName: S.storeName, scanned: S.scanned, scanning: S.scanning, lastUpdate: S.lastUpdate }); }
function badge(t, c) { try { chrome.action.setBadgeBackgroundColor({ color: c }); chrome.action.setBadgeText({ text: t }); } catch(e) {} }

chrome.storage.local.get(['asins', 'storeName', 'scanned', 'lastUpdate'], d => {
  if (d.asins) { S.asins = d.asins; S.set = new Set(d.asins); }
  S.storeName = d.storeName || ''; S.scanned = d.scanned || 0; S.lastUpdate = d.lastUpdate || '';
});
