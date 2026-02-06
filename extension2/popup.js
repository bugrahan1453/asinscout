// ASIN Scout Pro v2 TURBO - Popup
document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  let allAsins = [], storeName = '', storeUrl = '', tabId = null, scanLimit = 0;
  let isScanning = false, isPaused = false;

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      $(tab.dataset.tab + 'Tab').classList.add('active');

      if (tab.dataset.tab === 'history') {
        loadHistory();
      }
    };
  });

  // Auth state check
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
    scanLimit = user.scan_limit || 0;

    // Limit bilgisi
    let limitText = '';
    if (user.package_name) {
      limitText = `${user.package_name} | ${fmtNum(scanLimit)} ASIN`;
      if (user.daily_scan_limit > 0) {
        const remaining = user.daily_remaining >= 0 ? user.daily_remaining : user.daily_scan_limit;
        limitText += ` | Gunluk: ${remaining}/${user.daily_scan_limit}`;
      }
    } else {
      limitText = 'Paket yok - Tarama yapamazsınız';
    }
    $('limitInfo').textContent = limitText;

    // Mevcut durumu al
    chrome.runtime.sendMessage({ action: 'getState' }, s => {
      if (s) {
        isScanning = s.scanning;
        isPaused = s.paused;
        allAsins = [];
        storeName = s.storeName || '';
        storeUrl = s.storeUrl || '';

        $('stTotal').textContent = fmtNum(s.total || 0);
        $('stScanned').textContent = fmtNum(s.scanned || 0);

        if (storeName) {
          $('sname').textContent = storeName;
          $('sname').classList.add('on');
        }

        if (s.lastUpdate) {
          $('statusTxt').textContent = s.lastUpdate;
          $('statusBox').classList.add('on');
        }

        updateButtons();
        updateWarningBanner();
      }
    });

    // ASIN'leri al
    chrome.runtime.sendMessage({ action: 'getAsins' }, r => {
      if (r && r.asins) {
        allAsins = r.asins;
        storeName = r.storeName || storeName;
        enableExport();
      }
    });

    // Geçmişi yükle
    loadHistory();
  }

  function updateButtons() {
    if (isScanning) {
      $('bScan').style.display = 'none';
      $('bStop').style.display = 'flex';

      if (isPaused) {
        $('bPause').style.display = 'none';
        $('bResume').style.display = 'flex';
      } else {
        $('bPause').style.display = 'flex';
        $('bResume').style.display = 'none';
      }
    } else {
      $('bScan').style.display = 'flex';
      $('bStop').style.display = 'none';
      $('bPause').style.display = 'none';
      $('bResume').style.display = 'none';
    }
  }

  function updateWarningBanner() {
    if (isScanning && !isPaused) {
      $('warningBanner').classList.add('on');
    } else {
      $('warningBanner').classList.remove('on');
    }
  }

  // Login
  $('loginBtn').onclick = async () => {
    const email = $('loginEmail').value.trim();
    const pass = $('loginPass').value;
    if (!email || !pass) { showError('loginMsg', 'Tum alanları doldurun'); return; }

    $('loginBtn').disabled = true;
    $('loginBtn').textContent = 'Giris yapılıyor...';

    chrome.runtime.sendMessage({ action: 'login', email, password: pass }, r => {
      $('loginBtn').disabled = false;
      $('loginBtn').textContent = 'Login';
      if (r.ok) { showApp(r.user); }
      else { showError('loginMsg', r.error || 'Giris basarısız'); }
    });
  };

  // Register
  $('regBtn').onclick = async () => {
    const name = $('regName').value.trim();
    const email = $('regEmail').value.trim();
    const pass = $('regPass').value;
    if (!name || !email || !pass) { showError('regMsg', 'Tum alanları doldurun'); return; }
    if (pass.length < 6) { showError('regMsg', 'Sifre en az 6 karakter'); return; }

    $('regBtn').disabled = true;
    $('regBtn').textContent = 'Kayıt yapılıyor...';

    chrome.runtime.sendMessage({ action: 'register', email, password: pass, name }, r => {
      $('regBtn').disabled = false;
      $('regBtn').textContent = 'Register';
      if (r.ok) { showApp(r.user); toast(r.message || 'Kayıt basarılı!'); }
      else { showError('regMsg', r.error || 'Kayıt basarısız'); }
    });
  };

  // Logout
  $('logoutLink').onclick = (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'logout' }, () => {
      showScreen('login');
    });
  };

  // Start Scan
  $('bScan').onclick = async () => {
    if (scanLimit <= 0) { toast('Paket satın alın!'); return; }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('amazon')) {
      toast('Amazon sayfasında olmalısınız!');
      return;
    }

    tabId = tab.id;

    // Sayfa bilgisini al
    chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' }, info => {
      if (chrome.runtime.lastError || !info) {
        // Content script inject et
        chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' }, info2 => {
              if (info2) startScan(info2, tab);
              else toast('Sayfa hazır değil, yenileyin');
            });
          }, 500);
        });
        return;
      }
      startScan(info, tab);
    });
  };

  function startScan(info, tab) {
    const baseUrl = info.pageType === 'store' ? tab.url : tab.url;
    storeName = info.sellerName || new URL(tab.url).hostname;
    storeUrl = baseUrl;

    $('sname').textContent = storeName;
    $('sname').classList.add('on');

    isScanning = true;
    isPaused = false;
    updateButtons();
    updateWarningBanner();

    chrome.runtime.sendMessage({
      action: 'startScan',
      baseUrl,
      storeName,
      tabId: tab.id
    });

    $('statusTxt').textContent = 'Baslıyor...';
    $('statusBox').classList.add('on');
  }

  // Pause
  $('bPause').onclick = () => {
    isPaused = true;
    updateButtons();
    updateWarningBanner();
    chrome.runtime.sendMessage({ action: 'pauseScan' });
  };

  // Resume
  $('bResume').onclick = () => {
    isPaused = false;
    updateButtons();
    updateWarningBanner();
    chrome.runtime.sendMessage({ action: 'unpauseScan' });
  };

  // Stop
  $('bStop').onclick = () => {
    isScanning = false;
    isPaused = false;
    updateButtons();
    updateWarningBanner();
    chrome.runtime.sendMessage({ action: 'stopScan' });
  };

  // Export TXT
  $('bTxt').onclick = () => {
    if (allAsins.length === 0) return;
    const blob = new Blob([allAsins.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: `${sanitize(storeName)}_${allAsins.length}_asins.txt`
    });
    toast('TXT indirildi!');
  };

  // Export Excel
  $('bExcel').onclick = () => {
    if (allAsins.length === 0) return;
    let csv = 'ASIN\n' + allAsins.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: `${sanitize(storeName)}_${allAsins.length}_asins.csv`
    });
    toast('Excel indirildi!');
  };

  // Copy
  $('bCp').onclick = () => {
    if (allAsins.length === 0) return;
    navigator.clipboard.writeText(allAsins.join('\n'));
    toast('Kopyalandı!');
  };

  // Clear
  $('bClr').onclick = () => {
    chrome.runtime.sendMessage({ action: 'clearAll' }, () => {
      allAsins = [];
      $('stTotal').textContent = '0';
      $('stScanned').textContent = '0';
      $('sname').style.display = 'none';
      $('sname').classList.remove('on');
      $('statusBox').classList.remove('on');
      enableExport();
    });
  };

  // History
  function loadHistory() {
    chrome.runtime.sendMessage({ action: 'getScanHistory' }, r => {
      const list = $('historyList');
      const history = r?.history || [];

      if (history.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:var(--t3);font-size:11px;padding:20px;">Henuz tarama yok</div>';
        return;
      }

      list.innerHTML = history.map((scan, idx) => {
        const date = new Date(scan.date);
        const dateStr = date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
        const asinCount = scan.asins?.length || 0;
        const badge = scan.completed ?
          '<span class="history-item-badge">Tamamlandı</span>' :
          '<span class="history-item-badge incomplete">Yarım</span>';

        return `
          <div class="history-item" data-idx="${idx}">
            <div class="history-item-name">${scan.storeName || 'Bilinmeyen'}</div>
            <div class="history-item-info">
              <span>${fmtNum(asinCount)} ASIN | ${dateStr}</span>
              ${badge}
            </div>
          </div>
        `;
      }).join('');

      // Click handlers
      list.querySelectorAll('.history-item').forEach(item => {
        item.onclick = async () => {
          const idx = parseInt(item.dataset.idx);
          const scan = history[idx];

          if (!scan.storeUrl) {
            toast('Tarama linki bulunamadı');
            return;
          }

          // Yeni tab aç ve taramayı devam ettir
          const tab = await chrome.tabs.create({ url: scan.storeUrl, active: true });

          // Tab yüklenene kadar bekle
          setTimeout(() => {
            chrome.runtime.sendMessage({
              action: 'resumeScan',
              scan: scan,
              tabId: tab.id
            });
            toast('Tarama devam ediyor...');
            window.close();
          }, 2000);
        };
      });
    });
  }

  // Clear history
  $('clearHistory').onclick = () => {
    if (confirm('Tum gecmisi silmek istiyor musunuz?')) {
      chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
        loadHistory();
        toast('Gecmis temizlendi');
      });
    }
  };

  // Listen for updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'progressUpdate') {
      $('stTotal').textContent = fmtNum(msg.asins?.length || 0);
      $('stScanned').textContent = fmtNum(msg.scanned || 0);
      if (msg.status) {
        $('statusTxt').textContent = msg.status;
        $('statusBox').classList.add('on');
      }
      allAsins = msg.asins || [];
      enableExport();
    }

    if (msg.action === 'scanComplete') {
      isScanning = false;
      isPaused = false;
      updateButtons();
      updateWarningBanner();
      allAsins = msg.asins || [];
      $('stTotal').textContent = fmtNum(allAsins.length);
      enableExport();
      loadHistory();
      toast('Tarama tamamlandı!');
    }
  });

  // Helpers
  function enableExport() {
    const h = allAsins.length > 0;
    $('bTxt').disabled = !h;
    $('bExcel').disabled = !h;
    $('bCp').disabled = !h;
    $('bClr').style.display = h ? 'flex' : 'none';
  }

  function fmtNum(n) { return n >= 1000 ? Math.round(n/1000) + 'K' : String(n); }
  function sanitize(s) { return (s || 'scan').replace(/[^a-z0-9]/gi, '_').substring(0, 30); }
  function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
  function showError(id, msg) { const el = $(id); el.textContent = msg; el.className = 'msg error'; }

  $('loginPass').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };
  $('regPass').onkeydown = (e) => { if (e.key === 'Enter') $('regBtn').click(); };
  window.showScreen = showScreen;
});
