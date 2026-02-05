document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  let allAsins = [], storeName = '', tabId = null, scanLimit = 0, currentMarketplace = 'amazon.com';

  // Loading ekranı başta gösteriliyor, auth kontrolü sonrası değişecek
  chrome.runtime.sendMessage({ action: 'getAuthState' }, state => {
    if (state && state.isLoggedIn) {
      // Profili yenile, güncel daily scan bilgisi için
      chrome.runtime.sendMessage({ action: 'refreshProfile' }, resp => {
        if (resp && resp.ok && resp.user) showApp(resp.user);
        else showApp(state.user);
      });
    } else {
      showScreen('login');
    }
  });

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(name + 'Screen')?.classList.add('active');
  }

  function showApp(user) {
    showScreen('app');
    $('userName').textContent = user.name || 'User';
    $('userEmail').textContent = user.email;
    $('userAvatar').textContent = (user.name || 'U')[0].toUpperCase();
    scanLimit = user.scan_limit || 0;
    if (user.package_name && scanLimit > 0) {
      $('pkgBadge').textContent = user.package_name;
      $('pkgBadge').className = 'pkg-badge';
      let limitText = 'Scan limit: <strong>' + fmtNum(scanLimit) + '</strong> ASINs';
      // Günlük tarama hakkı göster
      if (user.daily_scan_limit && user.daily_scan_limit > 0) {
        const remaining = user.daily_remaining >= 0 ? user.daily_remaining : (user.daily_scan_limit - (user.daily_scans_used || 0));
        limitText += '<br><span style="color:' + (remaining > 0 ? '#22c97a' : '#ff4d5e') + '">Günlük: ' + remaining + '/' + user.daily_scan_limit + ' tarama</span>';
      }
      $('limitInfo').innerHTML = limitText;
    } else {
      $('pkgBadge').textContent = 'No Package';
      $('pkgBadge').className = 'pkg-badge none';
      $('limitInfo').innerHTML = '<a href="https://asinscout.com/pricing.html" target="_blank" style="color:var(--or)">Buy package →</a>';
    }
    initApp();
  }

  $('loginBtn').onclick = () => {
    const email = $('loginEmail').value.trim(), pass = $('loginPass').value;
    if (!email || !pass) { showMsg('loginMsg', 'Fill all fields', true); return; }
    $('loginBtn').disabled = true; $('loginBtn').textContent = 'Logging in...';
    chrome.runtime.sendMessage({ action: 'login', email, password: pass }, resp => {
      $('loginBtn').disabled = false; $('loginBtn').textContent = 'Login';
      if (resp && resp.ok) showApp(resp.user);
      else showMsg('loginMsg', resp?.error || 'Failed', true);
    });
  };

  $('regBtn').onclick = () => {
    const name = $('regName').value.trim(), email = $('regEmail').value.trim(), pass = $('regPass').value;
    if (!name || !email || !pass) { showMsg('regMsg', 'Fill all fields', true); return; }
    $('regBtn').disabled = true; $('regBtn').textContent = 'Creating...';
    chrome.runtime.sendMessage({ action: 'register', email, password: pass, name }, resp => {
      $('regBtn').disabled = false; $('regBtn').textContent = 'Create Account';
      if (resp && resp.ok) { showApp(resp.user); toast('Account created!'); }
      else showMsg('regMsg', resp?.error || 'Failed', true);
    });
  };

  $('logoutLink').onclick = (e) => { e.preventDefault(); chrome.runtime.sendMessage({ action: 'logout' }); showScreen('login'); };

  function showMsg(id, msg, isErr) { const el = $(id); el.textContent = msg; el.className = 'msg ' + (isErr ? 'err' : 'ok'); setTimeout(() => el.className = 'msg', 5000); }

  async function initApp() {
    chrome.runtime.sendMessage({ action: 'getState' }, st => {
      if (!st) return;
      $('stTotal').textContent = st.total; $('stScanned').textContent = st.scanned;
      if (st.storeName) { storeName = st.storeName; $('sname').textContent = '🏪 ' + storeName; $('sname').style.display = 'block'; }
      if (st.total > 0) chrome.runtime.sendMessage({ action: 'getAsins' }, r => { if (r?.asins) { allAsins = r.asins; enableExport(); } });
      if (st.scanning) showScanningMode();
      else if (st.lastUpdate) { $('statusBox').classList.add('on'); $('statusTxt').textContent = st.lastUpdate; }
      if (st.user) scanLimit = st.user.scan_limit || 0;
    });
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !tab.url.includes('amazon')) { showNA(); return; }
      tabId = tab.id; $('pgurl').textContent = tab.url.substring(0, 50) + '...';
      const mpMatch = tab.url.match(/amazon\.([a-z.]+)/i);
      if (mpMatch) currentMarketplace = 'amazon.' + mpMatch[1];
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise(r => setTimeout(r, 400));
      chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' }, info => {
        if (chrome.runtime.lastError || !info?.isAmazon) { showNA(); return; }
        setup(info);
      });
    } catch(e) { showNA(); }
  }

  function setup(info) {
    $('badge').className = /[?&]me=|seller=|\/stores\//.test(info.url) ? 'badge store' : 'badge no';
    $('badgeTxt').textContent = /[?&]me=|seller=|\/stores\//.test(info.url) ? '✓ Store Page' : 'Search Page';
    if (info.sellerName) { storeName = info.sellerName; $('sname').textContent = '🏪 ' + storeName; $('sname').style.display = 'block'; }
    $('stPage').textContent = info.currentAsins.length;
    $('bScan').disabled = scanLimit <= 0;
    if (scanLimit <= 0) $('bScan').textContent = '🔒 Buy Package';
  }

  function showNA() { $('badge').className = 'badge no'; $('badgeTxt').textContent = 'Not Amazon'; }

  $('bScan').onclick = async () => {
    if (scanLimit <= 0) { window.open('https://asinscout.com/pricing.html', '_blank'); return; }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ action: 'startScan', tabId: tab.id, storeName, baseUrl: tab.url, scanLimit });
    showScanningMode();
  };

  function showScanningMode() {
    $('bScan').style.display = 'none'; $('bStop').style.display = 'flex';
    $('statusBox').classList.add('on'); $('statusTxt').textContent = 'Starting...';
    if (window.__poll) clearInterval(window.__poll);
    window.__poll = setInterval(() => {
      chrome.runtime.sendMessage({ action: 'getState' }, s => {
        if (!s) return;
        $('stTotal').textContent = s.total; $('stScanned').textContent = s.scanned;
        $('statusTxt').textContent = s.lastUpdate || 'Scanning...';
        if (!s.scanning) { clearInterval(window.__poll); done(s); }
      });
    }, 500);
  }

  function done(s) {
    $('bScan').style.display = 'flex'; $('bScan').textContent = '🔍 Start Scan'; $('bStop').style.display = 'none';
    chrome.runtime.sendMessage({ action: 'getAsins' }, r => { if (r?.asins) { allAsins = r.asins; $('stTotal').textContent = allAsins.length; enableExport(); } });
    toast('✅ ' + s.total + ' ASINs!');
  }

  $('bStop').onclick = () => {
    chrome.runtime.sendMessage({ action: 'stopScan' });
    $('bScan').style.display = 'flex'; $('bScan').textContent = '🔍 Start Scan'; $('bStop').style.display = 'none';
    if (window.__poll) clearInterval(window.__poll);
    chrome.runtime.sendMessage({ action: 'getAsins' }, r => { if (r?.asins) { allAsins = r.asins; enableExport(); } });
  };

  $('bTxt').onclick = () => {
    if (!allAsins.length) return;
    const blob = new Blob([allAsins.join('\n')], { type: 'text/plain' });
    chrome.downloads.download({ url: URL.createObjectURL(blob), filename: (storeName || 'asins').replace(/[^a-zA-Z0-9]/g, '_') + '_' + allAsins.length + '.txt', saveAs: true });
  };

  $('bExcel').onclick = () => {
    if (!allAsins.length) return;
    let xml = '<?xml version="1.0"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="ASINs"><Table><Row><Cell><Data ss:Type="String">ASIN</Data></Cell><Cell><Data ss:Type="String">Link</Data></Cell></Row>';
    for (const a of allAsins) xml += '<Row><Cell><Data ss:Type="String">' + a + '</Data></Cell><Cell><Data ss:Type="String">https://www.' + currentMarketplace + '/dp/' + a + '</Data></Cell></Row>';
    xml += '</Table></Worksheet></Workbook>';
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    chrome.downloads.download({ url: URL.createObjectURL(blob), filename: (storeName || 'asins').replace(/[^a-zA-Z0-9]/g, '_') + '_' + allAsins.length + '.xls', saveAs: true });
  };

  $('bCp').onclick = async () => { if (allAsins.length) { await navigator.clipboard.writeText(allAsins.join('\n')); toast(allAsins.length + ' copied!'); } };

  $('bClr').onclick = () => { chrome.runtime.sendMessage({ action: 'clearAll' }, () => { allAsins = []; $('stTotal').textContent = '0'; $('stScanned').textContent = '0'; $('sname').style.display = 'none'; $('statusBox').classList.remove('on'); enableExport(); }); };

  function enableExport() { const h = allAsins.length > 0; $('bTxt').disabled = !h; $('bExcel').disabled = !h; $('bCp').disabled = !h; $('bClr').style.display = h ? 'flex' : 'none'; }
  function fmtNum(n) { return n >= 1000 ? Math.round(n/1000) + 'K' : String(n); }
  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
  $('loginPass').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };
  $('regPass').onkeydown = (e) => { if (e.key === 'Enter') $('regBtn').click(); };
  window.showScreen = showScreen;
});
