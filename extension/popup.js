// ===== ERROR LOGGING =====
function logError(errorType, errorMessage, extra = {}) {
  try {
    chrome.runtime.sendMessage({
      action: 'logError',
      errorType,
      errorMessage: String(errorMessage).substring(0, 2000),
      stack: extra.stack,
      url: location.href,
      source: 'popup',
      data: extra.data
    });
  } catch(e) { /* ignore */ }
}

// Global hata yakalama
window.addEventListener('error', (e) => {
  logError('js_error', e.message, { stack: e.error?.stack, data: { line: e.lineno, file: e.filename } });
});

window.addEventListener('unhandledrejection', (e) => {
  logError('promise_error', e.reason?.message || String(e.reason), { stack: e.reason?.stack });
});

document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  let allAsins = [], storeName = '', tabId = null, scanLimit = 0, currentMarketplace = 'amazon.com';
  let pendingTabUrl = '';

  // Auth state kontrolu
  chrome.runtime.sendMessage({ action: 'getAuthState' }, state => {
    if (state && state.isLoggedIn) {
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
    $('userName').textContent = user.name || 'Kullanici';
    $('userEmail').textContent = user.email;
    $('userAvatar').textContent = (user.name || 'U')[0].toUpperCase();
    scanLimit = user.scan_limit || 0;

    if (user.package_name && scanLimit > 0) {
      $('pkgBadge').textContent = user.package_name;
      $('pkgBadge').className = 'pkg-badge';
      let limitText = 'Tarama limiti: <strong>' + fmtNum(scanLimit) + '</strong> ASIN';
      if (user.daily_scan_limit && user.daily_scan_limit > 0) {
        const remaining = user.daily_remaining >= 0 ? user.daily_remaining : (user.daily_scan_limit - (user.daily_scans_used || 0));
        limitText += '<br><span style="color:' + (remaining > 0 ? '#22c97a' : '#ff4d5e') + '">Gunluk: ' + remaining + '/' + user.daily_scan_limit + ' tarama</span>';
      }
      $('limitInfo').innerHTML = limitText;
    } else {
      $('pkgBadge').textContent = 'Paket Yok';
      $('pkgBadge').className = 'pkg-badge none';
      $('limitInfo').innerHTML = '<a href="https://asinscout.com/pricing.html" target="_blank" style="color:var(--or)">Paket Satin Al →</a>';
    }
    initApp();
  }

  // Login
  $('loginBtn').onclick = () => {
    const email = $('loginEmail').value.trim(), pass = $('loginPass').value;
    if (!email || !pass) { showMsg('loginMsg', 'Tum alanlari doldurun', true); return; }
    $('loginBtn').disabled = true; $('loginBtn').textContent = 'Giris yapiliyor...';
    chrome.runtime.sendMessage({ action: 'login', email, password: pass }, resp => {
      $('loginBtn').disabled = false; $('loginBtn').textContent = 'Giris Yap';
      if (resp && resp.ok) showApp(resp.user);
      else showMsg('loginMsg', resp?.error || 'Giris basarisiz', true);
    });
  };

  // Register
  $('regBtn').onclick = () => {
    const name = $('regName').value.trim(), email = $('regEmail').value.trim(), pass = $('regPass').value;
    if (!name || !email || !pass) { showMsg('regMsg', 'Tum alanlari doldurun', true); return; }
    $('regBtn').disabled = true; $('regBtn').textContent = 'Olusturuluyor...';
    chrome.runtime.sendMessage({ action: 'register', email, password: pass, name }, resp => {
      $('regBtn').disabled = false; $('regBtn').textContent = 'Kayit Ol';
      if (resp && resp.ok) { showApp(resp.user); toast('Hesap olusturuldu!'); }
      else showMsg('regMsg', resp?.error || 'Kayit basarisiz', true);
    });
  };

  // Logout
  $('logoutLink').onclick = (e) => { e.preventDefault(); chrome.runtime.sendMessage({ action: 'logout' }); showScreen('login'); };

  function showMsg(id, msg, isErr) {
    const el = $(id);
    el.textContent = msg;
    el.className = 'msg ' + (isErr ? 'err' : 'ok');
    setTimeout(() => el.className = 'msg', 5000);
  }

  async function initApp() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !tab.url.includes('amazon')) { showNA(); return; }
      tabId = tab.id;
      $('pgurl').textContent = tab.url.substring(0, 50) + '...';

      const mpMatch = tab.url.match(/amazon\.([a-z.]+)/i);
      if (mpMatch) currentMarketplace = 'amazon.' + mpMatch[1];

      // Bu tab'in state'ini al
      chrome.runtime.sendMessage({ action: 'getStateForTab', tabId: tabId }, st => {
        if (st) applyState(st);
        // State yoksa veya tarama yoksa, yeni tarama icin hazir
      });

      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise(r => setTimeout(r, 400));

      chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' }, info => {
        if (chrome.runtime.lastError || !info?.isAmazon) { showNA(); return; }
        setup(info, tab.url);
      });
    } catch(e) {
      logError('init_error', 'initApp failed: ' + e.message, { stack: e.stack });
      showNA();
    }
  }

  function applyState(st) {
    if (!st) return;
    $('stTotal').textContent = fmtNum(st.total || 0);
    if (st.storeName) {
      storeName = st.storeName;
      $('sname').textContent = storeName;
      $('sname').style.display = 'block';
    }
    if (st.total > 0) {
      chrome.runtime.sendMessage({ action: 'getAsinsForTab', tabId: tabId }, r => {
        if (r?.asins) {
          allAsins = r.asins;
          enableExport();
          updateChunkButtons();
        }
      });
    }
    if (st.scanning) {
      showScanningMode();
    }
  }

  function setup(info, tabUrl) {
    const isStore = /[?&]me=|seller=|\/stores\//.test(info.url);
    $('badge').className = isStore ? 'badge store' : 'badge no';
    $('badgeTxt').textContent = isStore ? 'Magaza Sayfasi' : 'Arama Sayfasi';

    // Magaza adini otomatik cek
    if (info.sellerName) {
      storeName = info.sellerName;
      $('sname').textContent = storeName;
      $('sname').style.display = 'block';
    }

    pendingTabUrl = tabUrl;
    $('bScan').disabled = scanLimit <= 0;
    if (scanLimit <= 0) $('bScan').textContent = 'Paket Satin Al';
  }

  function showNA() {
    $('badge').className = 'badge no';
    $('badgeTxt').textContent = 'Amazon Degil';
  }

  let pendingTab = null; // Bekleyen tab

  // Tarama baslat
  $('bScan').onclick = async () => {
    if (scanLimit <= 0) {
      window.open('https://asinscout.com/pricing.html', '_blank');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab.id;
    pendingTab = tab;

    // Magaza adi yoksa modal goster
    if (!storeName) {
      $('storeModal').classList.add('on');
      $('storeNameInput').focus();
      return;
    }

    // Onceki tarama kontrolu
    checkAndStartScan(tab);
  };

  // Onceki tarama kontrolu yap
  async function checkAndStartScan(tab) {
    $('bScan').disabled = true;
    $('bScan').textContent = 'Kontrol ediliyor...';

    chrome.runtime.sendMessage({ action: 'checkPreviousScan', storeName }, resp => {
      $('bScan').disabled = false;
      $('bScan').textContent = 'Taramayi Baslat';

      if (resp && resp.found) {
        // Onceden tarandi - uyari goster
        const scanDate = new Date(resp.scan.date).toLocaleDateString('tr-TR');
        const asinCount = resp.scan.asin_count || 0;
        $('prevScanInfo').textContent = scanDate + ' tarihinde ' + asinCount + ' ASIN bulunmustu.';
        $('warningModal').classList.add('on');
      } else {
        // Ilk kez taraniyor
        startScan(tab);
      }
    });
  }

  // Modal onay
  $('confirmStoreName').onclick = async () => {
    const name = $('storeNameInput').value.trim();
    if (!name) { toast('Magaza adi girin'); return; }
    storeName = name;
    $('sname').textContent = storeName;
    $('sname').style.display = 'block';
    $('storeModal').classList.remove('on');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    pendingTab = tab;
    // Onceki tarama kontrolu
    checkAndStartScan(tab);
  };

  $('cancelStoreName').onclick = () => {
    $('storeModal').classList.remove('on');
  };

  // Tekrar tarama onay
  $('confirmRescan').onclick = () => {
    $('warningModal').classList.remove('on');
    if (pendingTab) startScan(pendingTab);
  };

  $('cancelRescan').onclick = () => {
    $('warningModal').classList.remove('on');
  };

  function startScan(tab) {
    chrome.runtime.sendMessage({
      action: 'startScan',
      tabId: tab.id,
      storeName,
      baseUrl: tab.url,
      scanLimit
    });
    showScanningMode();
  }

  function showScanningMode() {
    $('bScan').style.display = 'none';
    $('bStop').style.display = 'flex';
    $('progressWrap').classList.add('on');
    $('progressFill').style.width = '5%';
    $('progressTxt').textContent = 'Tarama baslatiliyor...';

    if (window.__poll) clearInterval(window.__poll);
    window.__poll = setInterval(() => {
      // Bu tab'in state'ini al (multi-tab destegi)
      chrome.runtime.sendMessage({ action: 'getStateForTab', tabId: tabId }, s => {
        if (!s) return;
        $('stTotal').textContent = fmtNum(s.total);

        // Progress bar animasyonu
        const progress = Math.min(95, 5 + (s.scanned * 0.5));
        $('progressFill').style.width = progress + '%';
        $('progressTxt').textContent = 'Tarama devam ediyor... (' + fmtNum(s.total) + ' ASIN bulundu)';

        if (!s.scanning) {
          clearInterval(window.__poll);
          done(s);
        }
      });
    }, 500);
  }

  function done(s) {
    $('bScan').style.display = 'flex';
    $('bScan').textContent = 'Taramayi Baslat';
    $('bStop').style.display = 'none';
    $('progressWrap').classList.remove('on');

    chrome.runtime.sendMessage({ action: 'getAsinsForTab', tabId: tabId }, r => {
      if (r?.asins) {
        allAsins = r.asins;
        $('stTotal').textContent = fmtNum(allAsins.length);
        enableExport();
        updateChunkButtons();
      }
    });
    toast('Tamamlandi! ' + fmtNum(s.total) + ' ASIN');
  }

  // Durdur
  $('bStop').onclick = () => {
    chrome.runtime.sendMessage({ action: 'stopScan', tabId: tabId });
    $('bScan').style.display = 'flex';
    $('bScan').textContent = 'Taramayi Baslat';
    $('bStop').style.display = 'none';
    $('progressWrap').classList.remove('on');
    if (window.__poll) clearInterval(window.__poll);
    chrome.runtime.sendMessage({ action: 'getAsinsForTab', tabId: tabId }, r => {
      if (r?.asins) {
        allAsins = r.asins;
        enableExport();
        updateChunkButtons();
      }
    });
  };

  // TXT indir
  $('bTxt').onclick = () => {
    if (!allAsins.length) return;
    const blob = new Blob([allAsins.join('\n')], { type: 'text/plain' });
    chrome.downloads.download({
      url: URL.createObjectURL(blob),
      filename: (storeName || 'asinler').replace(/[^a-zA-Z0-9]/g, '_') + '_' + allAsins.length + '.txt',
      saveAs: true
    });
    toast('TXT indirildi!');
  };

  // Excel indir
  $('bExcel').onclick = () => {
    if (!allAsins.length) return;
    let xml = '<?xml version="1.0"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="ASINs"><Table><Row><Cell><Data ss:Type="String">ASIN</Data></Cell><Cell><Data ss:Type="String">Link</Data></Cell></Row>';
    for (const a of allAsins) xml += '<Row><Cell><Data ss:Type="String">' + a + '</Data></Cell><Cell><Data ss:Type="String">https://www.' + currentMarketplace + '/dp/' + a + '</Data></Cell></Row>';
    xml += '</Table></Worksheet></Workbook>';
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    chrome.downloads.download({
      url: URL.createObjectURL(blob),
      filename: (storeName || 'asinler').replace(/[^a-zA-Z0-9]/g, '_') + '_' + allAsins.length + '.xls',
      saveAs: true
    });
    toast('Excel indirildi!');
  };

  // Kopyala
  $('bCp').onclick = async () => {
    if (allAsins.length) {
      await navigator.clipboard.writeText(allAsins.join('\n'));
      toast(fmtNum(allAsins.length) + ' ASIN kopyalandi!');
    }
  };

  // Temizle (sadece bu tab)
  $('bClr').onclick = () => {
    chrome.runtime.sendMessage({ action: 'clearTab', tabId: tabId }, () => {
      allAsins = [];
      storeName = '';
      $('stTotal').textContent = '0';
      $('sname').style.display = 'none';
      $('copyChunks').classList.remove('on');
      enableExport();
    });
  };

  // 5K Chunk butonlarini guncelle
  function updateChunkButtons() {
    const container = $('chunkBtns');
    container.innerHTML = '';

    if (allAsins.length <= 5000) {
      $('copyChunks').classList.remove('on');
      return;
    }

    $('copyChunks').classList.add('on');
    const chunkSize = 5000;
    const chunks = Math.ceil(allAsins.length / chunkSize);

    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize;
      const end = Math.min((i + 1) * chunkSize, allAsins.length);

      const btn = document.createElement('button');
      btn.className = 'chunk-btn';
      btn.textContent = fmtNum(start) + '-' + fmtNum(end);
      btn.dataset.start = start;
      btn.dataset.end = end;

      btn.onclick = async () => {
        const chunk = allAsins.slice(start, end);
        await navigator.clipboard.writeText(chunk.join('\n'));
        btn.classList.add('copied');
        toast((end - start) + ' ASIN kopyalandi!');
      };

      container.appendChild(btn);
    }
  }

  function enableExport() {
    const h = allAsins.length > 0;
    $('bTxt').disabled = !h;
    $('bExcel').disabled = !h;
    $('bCp').disabled = !h;
    $('bClr').style.display = h ? 'flex' : 'none';
  }

  function fmtNum(n) {
    if (n >= 1000000) return Math.round(n/1000000) + 'M';
    if (n >= 1000) return Math.round(n/1000) + 'K';
    return String(n);
  }

  function toast(m) {
    const t = $('toast');
    t.textContent = m;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  $('loginPass').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };
  $('regPass').onkeydown = (e) => { if (e.key === 'Enter') $('regBtn').click(); };
  $('storeNameInput').onkeydown = (e) => { if (e.key === 'Enter') $('confirmStoreName').click(); };

  // Aktif taramalar panelini guncelle
  function updateActiveScansPanel() {
    chrome.runtime.sendMessage({ action: 'getAllActiveScans' }, resp => {
      if (!resp || !resp.scans || resp.scans.length === 0) {
        $('activeScansPanel').style.display = 'none';
        return;
      }

      $('activeScansPanel').style.display = 'block';
      const list = $('activeScansList');
      list.innerHTML = '';

      for (const scan of resp.scans) {
        const item = document.createElement('div');
        item.className = 'scan-item' + (scan.tabId === tabId ? ' current' : '');

        const statusIcon = scan.scanning ? '🔄' : '✅';
        const statusText = scan.scanning ? 'Taraniyor...' : 'Tamamlandi';

        item.innerHTML = `
          <div class="scan-info">
            <div class="scan-name">${statusIcon} ${scan.storeName || 'Magaza'}</div>
            <div class="scan-stats">${fmtNum(scan.asinCount)} ASIN ${scan.scanning ? '- ' + statusText : ''}</div>
          </div>
          <div class="scan-actions">
            ${!scan.scanning && scan.asinCount > 0 ? '<button class="scan-btn scan-btn-sr" data-tab="' + scan.tabId + '" data-name="' + (scan.storeName || 'Magaza') + '">SR</button>' : ''}
            <button class="scan-btn scan-btn-go" data-tab="${scan.tabId}">Git</button>
            ${scan.scanning ? '<button class="scan-btn scan-btn-stop" data-tab="' + scan.tabId + '">Durdur</button>' : ''}
          </div>
        `;
        list.appendChild(item);
      }

      // Event listeners for buttons
      list.querySelectorAll('.scan-btn-go').forEach(btn => {
        btn.onclick = () => {
          const tid = parseInt(btn.dataset.tab);
          chrome.tabs.update(tid, { active: true });
          chrome.tabs.get(tid, tab => {
            if (tab && tab.windowId) {
              chrome.windows.update(tab.windowId, { focused: true });
            }
          });
        };
      });

      list.querySelectorAll('.scan-btn-stop').forEach(btn => {
        btn.onclick = () => {
          const tid = parseInt(btn.dataset.tab);
          chrome.runtime.sendMessage({ action: 'stopScan', tabId: tid });
          setTimeout(updateActiveScansPanel, 500);
        };
      });

      // SR Yukle butonlari
      list.querySelectorAll('.scan-btn-sr').forEach(btn => {
        btn.onclick = () => {
          const tid = parseInt(btn.dataset.tab);
          const name = btn.dataset.name;
          btn.textContent = '...';

          chrome.runtime.sendMessage({ action: 'getAsinsForTab', tabId: tid }, r => {
            if (r && r.asins && r.asins.length > 0) {
              // ASIN'leri storage'a kaydet ve SR ac
              chrome.storage.local.set({
                pendingAsins: r.asins,
                pendingStoreName: name,
                pendingTimestamp: Date.now()
              }, () => {
                btn.textContent = '✓';
                btn.classList.add('done');
                window.open('https://sellerrunning.threecolts.com/inventory/add', '_blank');
                setTimeout(() => {
                  btn.textContent = 'SR';
                  btn.classList.remove('done');
                }, 2000);
              });
            } else {
              btn.textContent = '!';
              setTimeout(() => { btn.textContent = 'SR'; }, 2000);
            }
          });
        };
      });
    });
  }

  // Aktif taramalar panelini periyodik guncelle
  updateActiveScansPanel();
  setInterval(updateActiveScansPanel, 2000);

  window.showScreen = showScreen;
});
