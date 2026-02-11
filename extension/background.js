// ASIN Scout Pro v3 - Multi-tab destekli
const API_BASE = 'https://asinscout.com/api';
const EXT_VERSION = '12.1.0';

// ===== ERROR LOGGING SYSTEM =====
async function logError(errorType, errorMessage, extra = {}) {
  try {
    const payload = {
      error_type: errorType,
      error_message: String(errorMessage).substring(0, 5000),
      error_stack: extra.stack || null,
      source: 'background',
      url: extra.url || null,
      browser_info: navigator.userAgent,
      extension_version: EXT_VERSION,
      user_email: user?.email || null,
      extra_data: extra.data || null
    };

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    await fetch(API_BASE + '/logs.php?action=report', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (e) {
    // Log gonderme hatasi - sessizce devam et
    console.error('[LogError] Failed to send:', e);
  }
}

// Global hata yakalama
self.addEventListener('error', (e) => {
  logError('js_error', e.message, {
    stack: e.error?.stack,
    url: e.filename,
    data: { line: e.lineno, col: e.colno }
  });
});

self.addEventListener('unhandledrejection', (e) => {
  logError('promise_error', e.reason?.message || String(e.reason), {
    stack: e.reason?.stack
  });
});

// Her tab icin ayri state
const tabStates = {};
let token = null, user = null, isLoggedIn = false;

// Storage'dan yukle
chrome.storage.local.get(['token', 'user', 'tabStates'], (d) => {
  if (d.token) { token = d.token; user = d.user; isLoggedIn = true; refreshProfile(); }
  if (d.tabStates) Object.assign(tabStates, d.tabStates);
});

// Tab kapandiginda ASIN'leri kaydet, sonra state'i temizle
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabStates[tabId]) {
    const state = tabStates[tabId];
    // Eger tarama varsa ve ASIN bulunmussa, sunucuya kaydet
    if (state.scanId && state.asins.length > 0) {
      completeScanApi(state.scanId, state.asins, state.scanned, 0);
    }
    delete tabStates[tabId];
    saveTabStates();
  }
});

// Sayfa degistiginde (navigate) ASIN'leri kaydet
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // Sadece ana frame
  const tabId = details.tabId;
  if (tabStates[tabId] && tabStates[tabId].scanning) {
    const state = tabStates[tabId];
    if (state.scanId && state.asins.length > 0) {
      completeScanApi(state.scanId, state.asins, state.scanned, 0);
    }
    state.scanning = false;
    state.lastUpdate = 'Sayfa degisti: ' + state.asins.length + ' ASIN kaydedildi';
    saveTabStates();
  }
});

// Periyodik kayit icin son kayit zamani
const lastSaveTime = {};

function getTabState(tabId) {
  if (!tabStates[tabId]) {
    tabStates[tabId] = {
      scanning: false,
      storeName: '',
      scanned: 0,
      asins: [],
      set: new Set(),
      lastUpdate: '',
      scanId: null,
      createdAt: Date.now()
    };
  }
  // Eski state'lerde createdAt yoksa ekle
  if (!tabStates[tabId].createdAt) {
    tabStates[tabId].createdAt = Date.now();
  }
  return tabStates[tabId];
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  // Log islemleri - diger script'lerden gelen hatalar
  if (msg.action === 'logError') {
    logError(msg.errorType || 'unknown', msg.errorMessage, {
      stack: msg.stack,
      url: msg.url || sender.tab?.url,
      data: { ...msg.data, source: msg.source }
    });
    send({ ok: true });
    return true;
  }

  // Auth islemleri
  if (msg.action === 'login') { handleLogin(msg.email, msg.password).then(send); return true; }
  if (msg.action === 'register') { handleRegister(msg.email, msg.password, msg.name).then(send); return true; }
  if (msg.action === 'logout') {
    token = null; user = null; isLoggedIn = false;
    chrome.storage.local.remove(['token', 'user']);
    send({ ok: true });
  }

  if (msg.action === 'getAuthState') {
    if (!isLoggedIn && !token) {
      chrome.storage.local.get(['token', 'user'], (d) => {
        if (d.token) { token = d.token; user = d.user; isLoggedIn = true; }
        send({ isLoggedIn, user });
      });
      return true;
    }
    send({ isLoggedIn, user });
  }

  if (msg.action === 'refreshProfile') { refreshProfile().then(send); return true; }

  // Tarama islemleri - tab bazli
  if (msg.action === 'startScan') {
    if (!isLoggedIn || !user?.scan_limit) { send({ error: 'Paket yok' }); return; }

    const tabId = msg.tabId;
    const state = getTabState(tabId);

    state.asins = [];
    state.set = new Set();
    state.scanned = 0;
    state.scanning = true;
    state.storeName = msg.storeName || '';
    state.lastUpdate = 'Baslatiliyor...';

    startScanApi(msg.baseUrl, msg.storeName).then(r => {
      if (r.scan_id) {
        state.scanId = r.scan_id;
        saveTabStates();
        badge('...', '#ff6b2c', tabId);
        injectAndStart(tabId, msg.baseUrl, user.scan_limit);
      } else {
        state.scanning = false;
        state.lastUpdate = r.error || 'Hata';
        saveTabStates();
      }
    });
    send({ ok: true });
  }

  else if (msg.action === 'stopScan') {
    const tabId = msg.tabId || sender.tab?.id;
    if (tabId && tabStates[tabId]) {
      const state = tabStates[tabId];
      state.scanning = false;
      state.lastUpdate = 'Durduruldu: ' + state.asins.length + ' ASIN';
      saveTabStates();
      badge(fmtNum(state.asins.length), '#ff4d5e', tabId);
      try { chrome.tabs.sendMessage(tabId, { action: 'stopFetchScan' }); } catch(e) {}
    }
    send({ ok: true });
  }

  else if (msg.action === 'progressUpdate') {
    const tabId = sender.tab?.id;
    if (!tabId || !tabStates[tabId]) return;
    const state = tabStates[tabId];
    if (!state.scanning) return;

    state.asins = msg.asins || [];
    state.set = new Set(state.asins);
    state.scanned = msg.scanned || state.scanned;
    // Detayli status gosterme - sadece ASIN sayisi
    state.lastUpdate = state.asins.length + ' ASIN bulundu';
    saveTabStates();
    badge(fmtNum(state.asins.length), '#ff6b2c', tabId);

    // Periyodik sunucu kaydı - her 500 ASIN'de veya 60 saniyede bir
    const now = Date.now();
    const lastSave = lastSaveTime[tabId] || 0;
    const timeSinceLastSave = now - lastSave;
    const asinThreshold = 500;
    const timeThreshold = 60000; // 60 saniye

    if (state.scanId && state.asins.length > 0) {
      // Her 500 ASIN'de bir veya 60 saniye gectiyse kaydet
      if (state.asins.length % asinThreshold < 50 || timeSinceLastSave > timeThreshold) {
        if (timeSinceLastSave > 10000) { // En az 10 saniye ara ver
          updateScanApi(state.scanId, state.asins, state.scanned);
          lastSaveTime[tabId] = now;
        }
      }
    }
  }

  else if (msg.action === 'scanComplete') {
    const tabId = sender.tab?.id;
    if (!tabId || !tabStates[tabId]) return;
    const state = tabStates[tabId];

    state.scanning = false;
    state.asins = msg.asins || [];
    state.scanned = msg.scanned || state.scanned;
    state.lastUpdate = 'Tamamlandi: ' + state.asins.length + ' ASIN';

    if (state.scanId && state.asins.length > 0) {
      completeScanApi(state.scanId, state.asins, state.scanned, msg.duration || 0);
    }

    badge(fmtNum(state.asins.length), '#22c97a', tabId);
    saveTabStates();
    refreshProfile();
  }

  // Tab bazli state getir
  else if (msg.action === 'getStateForTab') {
    const tabId = msg.tabId;
    if (tabId && tabStates[tabId]) {
      const s = tabStates[tabId];
      send({
        scanning: s.scanning,
        storeName: s.storeName,
        scanned: s.scanned,
        total: s.asins.length,
        lastUpdate: s.lastUpdate,
        user
      });
    } else {
      send(null);
    }
    return true;
  }

  // Genel state (eski uyumluluk + aktif tarama)
  else if (msg.action === 'getState') {
    // Aktif tarama olan tab'i bul
    let activeState = null;
    for (const tid in tabStates) {
      if (tabStates[tid].scanning || tabStates[tid].asins.length > 0) {
        activeState = tabStates[tid];
        break;
      }
    }
    if (activeState) {
      send({
        scanning: activeState.scanning,
        storeName: activeState.storeName,
        scanned: activeState.scanned,
        total: activeState.asins.length,
        lastUpdate: activeState.lastUpdate,
        user
      });
    } else {
      send({ scanning: false, storeName: '', scanned: 0, total: 0, lastUpdate: '', user });
    }
  }

  else if (msg.action === 'getAsins') {
    // Aktif taramanin ASIN'lerini getir
    let asins = [], storeName = '';
    for (const tid in tabStates) {
      if (tabStates[tid].asins.length > 0) {
        asins = tabStates[tid].asins;
        storeName = tabStates[tid].storeName;
        break;
      }
    }
    send({ asins, storeName });
  }

  // Tab bazli ASIN getir (multi-tab)
  else if (msg.action === 'getAsinsForTab') {
    const tid = msg.tabId;
    if (tid && tabStates[tid]) {
      send({ asins: tabStates[tid].asins, storeName: tabStates[tid].storeName });
    } else {
      send({ asins: [], storeName: '' });
    }
  }

  else if (msg.action === 'clearAll') {
    for (const tid in tabStates) {
      tabStates[tid] = {
        scanning: false, storeName: '', scanned: 0, asins: [], set: new Set(), lastUpdate: '', scanId: null, createdAt: Date.now()
      };
    }
    saveTabStates();
    badge('', '#22c97a');
    send({ ok: true });
  }

  // Sadece bir tab'i temizle (multi-tab)
  else if (msg.action === 'clearTab') {
    const tid = msg.tabId;
    if (tid && tabStates[tid]) {
      tabStates[tid] = {
        scanning: false, storeName: '', scanned: 0, asins: [], set: new Set(), lastUpdate: '', scanId: null, createdAt: Date.now()
      };
      saveTabStates();
      badge('', '#22c97a', tid);
    }
    send({ ok: true });
  }

  // Onceki tarama kontrolu
  else if (msg.action === 'checkPreviousScan') {
    checkPreviousScan(msg.storeName).then(send);
    return true;
  }

  // Tum aktif taramalari getir
  else if (msg.action === 'getAllActiveScans') {
    const activeScans = [];
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 saat

    for (const tid in tabStates) {
      const s = tabStates[tid];
      const age = now - (s.createdAt || 0);

      // 24 saatten eski olanlari atla
      if (age > maxAge) {
        // Eski state'i temizle
        delete tabStates[tid];
        continue;
      }

      if (s.scanning || s.asins.length > 0) {
        activeScans.push({
          tabId: parseInt(tid),
          storeName: s.storeName,
          scanning: s.scanning,
          asinCount: s.asins.length,
          scanned: s.scanned,
          createdAt: s.createdAt || now
        });
      }
    }

    // En yeniden eskiye sirala ve max 10 tane al
    activeScans.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const limitedScans = activeScans.slice(0, 10);

    // Eski state'ler silindiyse kaydet
    saveTabStates();

    send({ scans: limitedScans });
  }

  return true;
});

// Onceki taramalari kontrol et
async function checkPreviousScan(storeName) {
  if (!token || !storeName) return { found: false };
  try {
    const r = await fetch(API_BASE + '/scans.php?action=list&limit=100', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const d = await r.json();
    if (d.success && d.data.scans) {
      const normalizedName = storeName.toLowerCase().trim();
      const found = d.data.scans.find(s =>
        s.store_name && s.store_name.toLowerCase().trim() === normalizedName
      );
      if (found) {
        return {
          found: true,
          scan: {
            id: found.id,
            date: found.created_at,
            asin_count: found.asin_count
          }
        };
      }
    }
    return { found: false };
  } catch(e) { return { found: false }; }
}

async function handleLogin(email, password) {
  try {
    const r = await fetch(API_BASE + '/auth.php?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (d.success) {
      token = d.data.token;
      user = d.data.user;
      isLoggedIn = true;
      chrome.storage.local.set({ token, user });
      return { ok: true, user };
    }
    return { error: d.message };
  } catch(e) {
    logError('network_error', 'Login failed: ' + e.message, { stack: e.stack });
    return { error: 'Baglanti hatasi' };
  }
}

async function handleRegister(email, password, name) {
  try {
    const r = await fetch(API_BASE + '/auth.php?action=register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name })
    });
    const d = await r.json();
    if (d.success) {
      token = d.data.token;
      user = d.data.user;
      isLoggedIn = true;
      chrome.storage.local.set({ token, user });
      return { ok: true, user, message: d.message };
    }
    return { error: d.message };
  } catch(e) {
    logError('network_error', 'Register failed: ' + e.message, { stack: e.stack });
    return { error: 'Baglanti hatasi' };
  }
}

async function refreshProfile() {
  if (!token) return { error: 'Giris yapilmamis' };
  try {
    const r = await fetch(API_BASE + '/auth.php?action=profile', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const d = await r.json();
    if (d.success) {
      user = d.data.user;
      chrome.storage.local.set({ user });
      return { ok: true, user };
    }
    return { error: d.message };
  } catch(e) {
    logError('network_error', 'Profile refresh failed: ' + e.message, { stack: e.stack });
    return { error: 'Baglanti hatasi' };
  }
}

async function startScanApi(url, name) {
  if (!token) return { error: 'Giris yapilmamis' };
  try {
    const r = await fetch(API_BASE + '/scans.php?action=start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ store_url: url, store_name: name })
    });
    const d = await r.json();
    return d.success ? { scan_id: d.data.scan_id } : { error: d.message };
  } catch(e) {
    logError('network_error', 'Start scan API failed: ' + e.message, { stack: e.stack, url: url });
    return { error: 'Baglanti hatasi' };
  }
}

async function completeScanApi(scanId, asins, pages, duration) {
  if (!token) return;
  try {
    await fetch(API_BASE + '/scans.php?action=complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ scan_id: scanId, asins, pages_scanned: pages, duration })
    });
  } catch(e) {
    logError('network_error', 'Complete scan API failed: ' + e.message, { stack: e.stack, data: { scanId, asinCount: asins?.length } });
  }
}

// Ara kayit - tarama sirasinda periyodik guncelleme
async function updateScanApi(scanId, asins, pages) {
  if (!token) return;
  try {
    await fetch(API_BASE + '/scans.php?action=update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ scan_id: scanId, asins, pages_scanned: pages })
    });
  } catch(e) {
    logError('network_error', 'Update scan API failed: ' + e.message, { stack: e.stack, data: { scanId, asinCount: asins?.length } });
  }
}

async function injectAndStart(tabId, baseUrl, scanLimit) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 500));
    chrome.tabs.sendMessage(tabId, { action: 'startFetchScan', baseUrl, scanLimit, mode: 'full' }, r => {
      if (chrome.runtime.lastError && tabStates[tabId]) {
        const errMsg = chrome.runtime.lastError.message || 'Unknown error';
        logError('scan_error', 'Content script message failed: ' + errMsg, { url: baseUrl, data: { tabId } });
        tabStates[tabId].scanning = false;
        tabStates[tabId].lastUpdate = 'Hata: Sayfayi yenileyin';
        saveTabStates();
        badge('ERR', '#ff4d5e', tabId);
      }
    });
  } catch(e) {
    logError('scan_error', 'Script injection failed: ' + e.message, { stack: e.stack, url: baseUrl, data: { tabId } });
    if (tabStates[tabId]) {
      tabStates[tabId].scanning = false;
      tabStates[tabId].lastUpdate = 'Hata: ' + e.message;
      saveTabStates();
      badge('ERR', '#ff4d5e', tabId);
    }
  }
}

function fmtNum(n) {
  if (n >= 10000) return Math.round(n/1000) + 'K';
  return String(n);
}

function saveTabStates() {
  // Set'leri kaydetmeden once array'e cevir
  const toSave = {};
  for (const tid in tabStates) {
    toSave[tid] = { ...tabStates[tid], set: undefined };
  }
  chrome.storage.local.set({ tabStates: toSave });
}

function badge(text, color, tabId) {
  try {
    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeText({ text });
  } catch(e) {}
}
