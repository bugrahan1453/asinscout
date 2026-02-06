// ASIN Scout Pro v2 TURBO - Background Service Worker
// Tarama geçmişi ve devam ettirme özellikli
const API_BASE = 'https://asinscout.com/api';

const S = {
  scanning: false,
  paused: false,
  storeName: '',
  storeUrl: '',
  scanned: 0,
  asins: [],
  set: new Set(),
  lastUpdate: '',
  tabId: null,
  scanId: null,
  token: null,
  user: null,
  isLoggedIn: false,
  startTime: null,
  scanHistory: [] // Son taramalar
};

// Storage'dan yükle
chrome.storage.local.get(['token', 'user', 'scanHistory'], (d) => {
  if (d.token) {
    S.token = d.token;
    S.user = d.user;
    S.isLoggedIn = true;
    refreshProfile();
  }
  if (d.scanHistory) {
    S.scanHistory = d.scanHistory;
  }
});

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg.action === 'login') { handleLogin(msg.email, msg.password).then(send); return true; }
  if (msg.action === 'register') { handleRegister(msg.email, msg.password, msg.name).then(send); return true; }
  if (msg.action === 'logout') {
    S.token = null; S.user = null; S.isLoggedIn = false;
    chrome.storage.local.remove(['token', 'user']);
    send({ ok: true });
  }

  if (msg.action === 'getAuthState') {
    if (!S.isLoggedIn && !S.token) {
      chrome.storage.local.get(['token', 'user'], (d) => {
        if (d.token) { S.token = d.token; S.user = d.user; S.isLoggedIn = true; }
        send({ isLoggedIn: S.isLoggedIn, user: S.user });
      });
      return true;
    }
    send({ isLoggedIn: S.isLoggedIn, user: S.user });
  }

  if (msg.action === 'refreshProfile') { refreshProfile().then(send); return true; }

  // Tarama başlat
  if (msg.action === 'startScan') {
    if (!S.isLoggedIn || !S.user?.scan_limit) { send({ error: 'No package' }); return; }

    S.asins = [];
    S.set = new Set();
    S.scanned = 0;
    S.scanning = true;
    S.paused = false;
    S.storeName = msg.storeName || '';
    S.storeUrl = msg.baseUrl || '';
    S.tabId = msg.tabId;
    S.lastUpdate = 'Başlatılıyor...';
    S.startTime = Date.now();

    startScanApi(msg.baseUrl, msg.storeName).then(r => {
      if (r.scan_id) {
        S.scanId = r.scan_id;
        save();
        badge('...', '#ff6b2c');
        injectAndStart(msg.tabId, msg.baseUrl, S.user.scan_limit, 0);
      } else {
        S.scanning = false;
        S.lastUpdate = r.error || 'Error';
        save();
      }
    });
    send({ ok: true });
  }

  // Taramayı devam ettir (geçmişten)
  if (msg.action === 'resumeScan') {
    if (!S.isLoggedIn || !S.user?.scan_limit) { send({ error: 'No package' }); return; }

    const scan = msg.scan;
    S.asins = scan.asins || [];
    S.set = new Set(S.asins);
    S.scanned = scan.scanned || 0;
    S.scanning = true;
    S.paused = false;
    S.storeName = scan.storeName || '';
    S.storeUrl = scan.storeUrl || '';
    S.tabId = msg.tabId;
    S.lastUpdate = 'Devam ediliyor...';
    S.startTime = Date.now();

    startScanApi(scan.storeUrl, scan.storeName).then(r => {
      if (r.scan_id) {
        S.scanId = r.scan_id;
        save();
        badge('...', '#ff6b2c');
        injectAndStart(msg.tabId, scan.storeUrl, S.user.scan_limit, S.scanned);
      } else {
        S.scanning = false;
        S.lastUpdate = r.error || 'Error';
        save();
      }
    });
    send({ ok: true });
  }

  // Taramayı duraklat
  if (msg.action === 'pauseScan') {
    S.paused = true;
    S.lastUpdate = '⏸️ Duraklatıldı: ' + S.asins.length + ' ASIN';
    save();
    badge('⏸️', '#ff9500');
    if (S.tabId) {
      try { chrome.tabs.sendMessage(S.tabId, { action: 'pauseFetchScan' }); } catch(e) {}
    }
    send({ ok: true });
  }

  // Taramaya devam et
  if (msg.action === 'unpauseScan') {
    S.paused = false;
    S.lastUpdate = 'Devam ediliyor...';
    save();
    badge('...', '#ff6b2c');
    if (S.tabId) {
      try { chrome.tabs.sendMessage(S.tabId, { action: 'resumeFetchScan' }); } catch(e) {}
    }
    send({ ok: true });
  }

  // Taramayı durdur
  if (msg.action === 'stopScan') {
    S.scanning = false;
    S.paused = false;
    S.lastUpdate = 'Durduruldu: ' + S.asins.length + ' ASIN';

    // Geçmişe kaydet
    if (S.asins.length > 0) {
      addToHistory({
        storeName: S.storeName,
        storeUrl: S.storeUrl,
        asins: S.asins,
        scanned: S.scanned,
        date: new Date().toISOString(),
        completed: false
      });
    }

    save();
    badge(String(S.asins.length), '#ff4d5e');
    if (S.tabId) {
      try { chrome.tabs.sendMessage(S.tabId, { action: 'stopFetchScan' }); } catch(e) {}
    }
    send({ ok: true });
  }

  // Progress güncelleme
  if (msg.action === 'progressUpdate') {
    if (!S.scanning) return;
    S.asins = msg.asins || [];
    S.set = new Set(S.asins);
    S.scanned = msg.scanned || S.scanned;
    S.lastUpdate = msg.status || S.lastUpdate;
    save();
    badge(fmtNum(S.asins.length), '#ff6b2c');
  }

  // Tarama tamamlandı
  if (msg.action === 'scanComplete') {
    S.scanning = false;
    S.paused = false;
    S.asins = msg.asins || [];
    S.scanned = msg.scanned || S.scanned;
    const duration = msg.duration || Math.round((Date.now() - (S.startTime || Date.now())) / 1000);
    S.lastUpdate = `✅ ${S.asins.length} ASIN (${duration}s)`;

    // Geçmişe kaydet
    addToHistory({
      storeName: S.storeName,
      storeUrl: S.storeUrl,
      asins: S.asins,
      scanned: S.scanned,
      date: new Date().toISOString(),
      duration: duration,
      completed: true
    });

    if (S.scanId && S.asins.length > 0) {
      completeScanApi(S.scanId, S.asins, S.scanned, duration);
    }

    badge(fmtNum(S.asins.length), '#22c97a');
    save();
    refreshProfile();
  }

  // Durum getir
  if (msg.action === 'getState') {
    send({
      scanning: S.scanning,
      paused: S.paused,
      storeName: S.storeName,
      storeUrl: S.storeUrl,
      scanned: S.scanned,
      total: S.asins.length,
      lastUpdate: S.lastUpdate,
      isLoggedIn: S.isLoggedIn,
      user: S.user
    });
  }

  // ASIN'leri getir
  if (msg.action === 'getAsins') {
    send({ asins: S.asins, storeName: S.storeName });
  }

  // Tarama geçmişi getir
  if (msg.action === 'getScanHistory') {
    chrome.storage.local.get(['scanHistory'], (d) => {
      send({ history: d.scanHistory || [] });
    });
    return true;
  }

  // Geçmişi temizle
  if (msg.action === 'clearHistory') {
    S.scanHistory = [];
    chrome.storage.local.set({ scanHistory: [] });
    send({ ok: true });
  }

  // Geçmişten sil
  if (msg.action === 'deleteFromHistory') {
    const idx = msg.index;
    if (idx >= 0 && idx < S.scanHistory.length) {
      S.scanHistory.splice(idx, 1);
      chrome.storage.local.set({ scanHistory: S.scanHistory });
    }
    send({ ok: true });
  }

  // Tümünü temizle
  if (msg.action === 'clearAll') {
    S.asins = [];
    S.set = new Set();
    S.scanned = 0;
    S.storeName = '';
    S.storeUrl = '';
    S.lastUpdate = '';
    S.scanning = false;
    S.paused = false;
    save();
    badge('', '#22c97a');
    send({ ok: true });
  }

  return true;
});

// Geçmişe ekle (max 20 kayıt)
function addToHistory(scan) {
  // Aynı mağaza varsa güncelle
  const existingIdx = S.scanHistory.findIndex(s => s.storeUrl === scan.storeUrl);
  if (existingIdx >= 0) {
    S.scanHistory[existingIdx] = scan;
  } else {
    S.scanHistory.unshift(scan);
  }

  // Max 20 kayıt tut
  if (S.scanHistory.length > 20) {
    S.scanHistory = S.scanHistory.slice(0, 20);
  }

  chrome.storage.local.set({ scanHistory: S.scanHistory });
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
      S.token = d.data.token;
      S.user = d.data.user;
      S.isLoggedIn = true;
      chrome.storage.local.set({ token: S.token, user: S.user });
      return { ok: true, user: S.user };
    }
    return { error: d.message };
  } catch(e) { return { error: 'Connection error' }; }
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
      S.token = d.data.token;
      S.user = d.data.user;
      S.isLoggedIn = true;
      chrome.storage.local.set({ token: S.token, user: S.user });
      return { ok: true, user: S.user, message: d.message };
    }
    return { error: d.message };
  } catch(e) { return { error: 'Connection error' }; }
}

async function refreshProfile() {
  if (!S.token) return { error: 'Not logged in' };
  try {
    const r = await fetch(API_BASE + '/auth.php?action=profile', {
      headers: { 'Authorization': 'Bearer ' + S.token }
    });
    const d = await r.json();
    if (d.success) {
      S.user = d.data.user;
      chrome.storage.local.set({ user: S.user });
      return { ok: true, user: S.user };
    }
    return { error: d.message };
  } catch(e) { return { error: 'Connection error' }; }
}

async function startScanApi(url, name) {
  if (!S.token) return { error: 'Not logged in' };
  try {
    const r = await fetch(API_BASE + '/scans.php?action=start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.token },
      body: JSON.stringify({ store_url: url, store_name: name })
    });
    const d = await r.json();
    return d.success ? { scan_id: d.data.scan_id } : { error: d.message };
  } catch(e) { return { error: 'Connection error' }; }
}

async function completeScanApi(scanId, asins, pages, duration) {
  if (!S.token) return;
  try {
    await fetch(API_BASE + '/scans.php?action=complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.token },
      body: JSON.stringify({ scan_id: scanId, asins, pages_scanned: pages, duration })
    });
  } catch(e) {}
}

async function injectAndStart(tabId, baseUrl, scanLimit, resumeFrom) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 500));
    chrome.tabs.sendMessage(tabId, {
      action: 'startFetchScan',
      baseUrl,
      scanLimit,
      mode: 'full',
      resumeFrom: resumeFrom || 0
    }, r => {
      if (chrome.runtime.lastError) {
        S.scanning = false;
        S.lastUpdate = 'Hata: Sayfayı yenileyin';
        save();
        badge('ERR', '#ff4d5e');
      }
    });
  } catch(e) {
    S.scanning = false;
    S.lastUpdate = 'Hata: ' + e.message;
    save();
    badge('ERR', '#ff4d5e');
  }
}

function fmtNum(n) { return n >= 10000 ? Math.round(n/1000) + 'K' : String(n); }

function save() {
  chrome.storage.local.set({
    asins: S.asins,
    storeName: S.storeName,
    storeUrl: S.storeUrl,
    scanned: S.scanned,
    scanning: S.scanning,
    paused: S.paused,
    lastUpdate: S.lastUpdate
  });
}

function badge(t, c) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: c });
    chrome.action.setBadgeText({ text: t });
  } catch(e) {}
}

// Başlangıçta storage'dan yükle
chrome.storage.local.get(['asins', 'storeName', 'storeUrl', 'scanned', 'lastUpdate', 'scanHistory'], d => {
  if (d.asins) { S.asins = d.asins; S.set = new Set(d.asins); }
  S.storeName = d.storeName || '';
  S.storeUrl = d.storeUrl || '';
  S.scanned = d.scanned || 0;
  S.lastUpdate = d.lastUpdate || '';
  if (d.scanHistory) { S.scanHistory = d.scanHistory; }
});
