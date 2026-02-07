// ASIN Scout - Seller Running Integration
(function() {
  'use strict';

  let allAsins = [];
  let storeName = '';
  let panelVisible = false;
  let panel = null;
  let toggleBtn = null;
  let isAutoMode = false;
  let currentAutoChunk = 0;

  // Seller Running ürün ekleme sayfası URL'si
  const ADD_PRODUCTS_URL = 'https://sellerrunning.threecolts.com/inventory/add';

  // Sayfa yuklendiginde ASIN'leri al
  init();

  function init() {
    // Kisa bekle - sayfa tam yuklensin
    setTimeout(() => {
      loadAsins();
      createToggleButton();
      checkAutoMode();
    }, 1500);
  }

  function checkAutoMode() {
    // Otomatik mod devam ediyor mu kontrol et
    chrome.storage.local.get(['srAutoMode', 'srAutoAsins', 'srAutoChunk', 'srAutoStore', 'srAutoTimestamp'], data => {
      if (data.srAutoMode && data.srAutoAsins && data.srAutoAsins.length > 0) {
        const age = Date.now() - (data.srAutoTimestamp || 0);
        // 30 dakikadan eski degilse devam et
        if (age < 30 * 60 * 1000) {
          // Eger urun ekleme sayfasinda degilsek, oraya yonlendir
          if (!window.location.href.includes('/inventory/add')) {
            console.log('ASIN Scout: Auto mode aktif, urun ekleme sayfasina yonlendiriliyor...');
            window.location.href = ADD_PRODUCTS_URL;
            return;
          }

          allAsins = data.srAutoAsins;
          storeName = data.srAutoStore || '';
          currentAutoChunk = data.srAutoChunk || 0;
          isAutoMode = true;

          updateToggleButton();
          showPanel();

          // Biraz bekle ve sonraki chunk'i yukle
          setTimeout(() => {
            continueAutoUpload();
          }, 2000);
        } else {
          clearAutoMode();
        }
      }
    });
  }

  function clearAutoMode() {
    isAutoMode = false;
    currentAutoChunk = 0;
    chrome.storage.local.remove(['srAutoMode', 'srAutoAsins', 'srAutoChunk', 'srAutoStore', 'srAutoTimestamp']);
  }

  function loadAsins() {
    // Oncelik 1: Website'den gelen pending ASIN'ler (SR Yukle butonu)
    chrome.storage.local.get(['pendingAsins', 'pendingStoreName', 'pendingTimestamp'], data => {
      if (data.pendingAsins && data.pendingAsins.length > 0) {
        // 5 dakikadan eski degilse kullan
        const age = Date.now() - (data.pendingTimestamp || 0);
        if (age < 5 * 60 * 1000) {
          allAsins = data.pendingAsins;
          storeName = data.pendingStoreName || '';
          updateToggleButton();

          // Paneli otomatik ac
          if (!panelVisible) {
            showPanel();
          } else {
            updatePanel();
          }

          // Kullanildiktan sonra temizle
          chrome.storage.local.remove(['pendingAsins', 'pendingStoreName', 'pendingTimestamp']);
          return;
        }
      }

      // Otomatik mod aktif degilse normal ASIN'leri al
      if (!isAutoMode) {
        // Oncelik 2: Aktif taramadan gelen ASIN'ler
        chrome.runtime.sendMessage({ action: 'getAsins' }, resp => {
          if (resp && resp.asins && resp.asins.length > 0) {
            allAsins = resp.asins;
            storeName = resp.storeName || '';
            updateToggleButton();
            if (panelVisible) {
              updatePanel();
            }
          }
        });
      }
    });
  }

  function createToggleButton() {
    if (toggleBtn) return;

    toggleBtn = document.createElement('button');
    toggleBtn.className = 'asin-scout-toggle';
    toggleBtn.innerHTML = `
      <span>🔍 ASIN Scout</span>
      <span class="asin-scout-toggle-badge" id="asinScoutBadge">0</span>
    `;
    toggleBtn.onclick = togglePanel;
    document.body.appendChild(toggleBtn);
    updateToggleButton();
  }

  function updateToggleButton() {
    const badge = document.getElementById('asinScoutBadge');
    if (badge) {
      badge.textContent = formatNumber(allAsins.length);
    }
  }

  function togglePanel() {
    if (panelVisible) {
      hidePanel();
    } else {
      showPanel();
    }
  }

  function showPanel() {
    panelVisible = true;
    if (toggleBtn) toggleBtn.style.display = 'none';

    if (!panel) {
      createPanel();
    }
    panel.style.display = 'block';
    updatePanel();
  }

  function hidePanel() {
    panelVisible = false;
    if (panel) panel.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = 'flex';
  }

  function createPanel() {
    panel = document.createElement('div');
    panel.className = 'asin-scout-panel';
    panel.innerHTML = `
      <div class="asin-scout-header">
        <div class="asin-scout-logo">
          <div class="asin-scout-logo-icon">A</div>
          <span>ASIN Scout</span>
        </div>
        <button class="asin-scout-close" id="asinScoutClose">&times;</button>
      </div>
      <div class="asin-scout-body">
        <div class="asin-scout-info">
          <div class="asin-scout-total" id="asinScoutTotal">0</div>
          <div class="asin-scout-label">Yuklemeye Hazir ASIN</div>
          <div class="asin-scout-store" id="asinScoutStore"></div>
        </div>
        <div class="asin-scout-auto-section" id="asinScoutAutoSection"></div>
        <div class="asin-scout-chunks" id="asinScoutChunks"></div>
        <div class="asin-scout-status" id="asinScoutStatus" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // Close button
    document.getElementById('asinScoutClose').onclick = hidePanel;

    // Refresh button - panel acildiginda ASIN'leri yenile
    loadAsins();
  }

  function updatePanel() {
    const totalEl = document.getElementById('asinScoutTotal');
    const storeEl = document.getElementById('asinScoutStore');
    const autoEl = document.getElementById('asinScoutAutoSection');
    const chunksEl = document.getElementById('asinScoutChunks');

    if (!totalEl || !chunksEl) return;

    totalEl.textContent = formatNumber(allAsins.length);
    storeEl.textContent = storeName ? `📁 ${storeName}` : '';

    if (allAsins.length === 0) {
      autoEl.innerHTML = '';
      chunksEl.innerHTML = `
        <div class="asin-scout-no-data">
          <div class="asin-scout-no-data-icon">📭</div>
          <div class="asin-scout-no-data-text">
            Henuz ASIN yok.<br>
            Once Amazon'da bir magaza tarayin.
          </div>
        </div>
      `;
      return;
    }

    // Chunk'lari olustur
    const chunkSize = 5000;
    const totalChunks = Math.ceil(allAsins.length / chunkSize);

    // Otomatik yukleme butonu
    if (totalChunks > 1) {
      autoEl.innerHTML = `
        <button class="asin-scout-auto-btn" id="asinScoutAutoBtn" ${isAutoMode ? 'disabled' : ''}>
          <span class="asin-scout-auto-icon">${isAutoMode ? '⏳' : '🚀'}</span>
          <span>${isAutoMode ? 'Otomatik Yukleme Devam Ediyor...' : 'Tumunu Otomatik Yukle'}</span>
        </button>
        ${isAutoMode ? `
          <button class="asin-scout-stop-btn" id="asinScoutStopBtn">
            <span>⏹️ Durdur</span>
          </button>
        ` : ''}
        <div class="asin-scout-auto-info">
          Otomatik mod tum ${totalChunks} parcayi sirayla yukler
        </div>
      `;

      if (!isAutoMode) {
        document.getElementById('asinScoutAutoBtn').onclick = startAutoUpload;
      }

      const stopBtn = document.getElementById('asinScoutStopBtn');
      if (stopBtn) {
        stopBtn.onclick = stopAutoUpload;
      }
    } else {
      autoEl.innerHTML = '';
    }

    let html = '';

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min((i + 1) * chunkSize, allAsins.length);
      const count = end - start;
      const isDone = isAutoMode && i < currentAutoChunk;
      const isCurrent = isAutoMode && i === currentAutoChunk;

      html += `
        <div class="asin-scout-chunk-btn ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}"
             data-start="${start}" data-end="${end}" data-index="${i}">
          <div>
            <div class="asin-scout-chunk-range">${formatNumber(start + 1)} - ${formatNumber(end)}</div>
            <div class="asin-scout-chunk-count">${formatNumber(count)} ASIN</div>
          </div>
          <div class="asin-scout-chunk-status">${isDone ? '✅' : isCurrent ? '⏳' : '📤'}</div>
        </div>
      `;
    }

    chunksEl.innerHTML = html;

    // Click handlers (sadece manuel mod icin)
    if (!isAutoMode) {
      chunksEl.querySelectorAll('.asin-scout-chunk-btn').forEach(btn => {
        btn.onclick = () => loadChunk(btn);
      });
    }
  }

  function startAutoUpload() {
    const chunkSize = 5000;
    const totalChunks = Math.ceil(allAsins.length / chunkSize);

    if (totalChunks === 0) return;

    isAutoMode = true;
    currentAutoChunk = 0;

    // State'i kaydet - sayfa yenilenince devam edebilmek icin
    chrome.storage.local.set({
      srAutoMode: true,
      srAutoAsins: allAsins,
      srAutoChunk: 0,
      srAutoStore: storeName,
      srAutoTimestamp: Date.now()
    });

    updatePanel();
    processCurrentChunk();
  }

  function stopAutoUpload() {
    clearAutoMode();
    isAutoMode = false;
    currentAutoChunk = 0;
    showToast('Otomatik yukleme durduruldu');
    updatePanel();
  }

  function continueAutoUpload() {
    // Sayfa yenilendikten sonra devam et
    const chunkSize = 5000;
    const totalChunks = Math.ceil(allAsins.length / chunkSize);

    if (currentAutoChunk >= totalChunks) {
      // Tamamlandi
      completeAutoUpload();
      return;
    }

    updatePanel();
    processCurrentChunk();
  }

  function processCurrentChunk() {
    const chunkSize = 5000;
    const totalChunks = Math.ceil(allAsins.length / chunkSize);

    if (currentAutoChunk >= totalChunks) {
      completeAutoUpload();
      return;
    }

    const start = currentAutoChunk * chunkSize;
    const end = Math.min((currentAutoChunk + 1) * chunkSize, allAsins.length);
    const chunk = allAsins.slice(start, end);

    showStatus(`Parca ${currentAutoChunk + 1}/${totalChunks} yukleniyor... (${formatNumber(chunk.length)} ASIN)`);

    // Textarea'yi bul ve doldur
    const textarea = findTextarea();
    if (!textarea) {
      showStatus('Textarea bulunamadi! Sayfa yenilensin...', true);
      setTimeout(() => location.reload(), 2000);
      return;
    }

    // ASIN'leri doldur
    textarea.value = chunk.join('\n');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // Biraz bekle, sonra Add Products butonuna bas
    setTimeout(() => {
      clickAddProducts();
    }, 1000);
  }

  function clickAddProducts() {
    // "Add Products" butonunu bul
    const buttons = document.querySelectorAll('button');
    let addBtn = null;

    for (const btn of buttons) {
      const text = btn.textContent.toLowerCase().trim();
      if (text.includes('add products') || text.includes('add') || text.includes('submit')) {
        // Disabled olmayan butonu al
        if (!btn.disabled && btn.offsetParent !== null) {
          addBtn = btn;
          break;
        }
      }
    }

    // Alternatif: Submit button type
    if (!addBtn) {
      addBtn = document.querySelector('button[type="submit"]:not([disabled])');
    }

    // Alternatif: Primary/main action button
    if (!addBtn) {
      addBtn = document.querySelector('.btn-primary:not([disabled]), .primary-button:not([disabled]), [class*="submit"]:not([disabled])');
    }

    if (!addBtn) {
      showStatus('Add Products butonu bulunamadi! Manuel olarak tiklayin.', true);
      // Yine de devam etmeyi dene
      waitForCompletion();
      return;
    }

    showStatus('Add Products butonuna tiklaniyor...');
    addBtn.click();

    // Yukleme tamamlanmasini bekle
    waitForCompletion();
  }

  function waitForCompletion() {
    let checkCount = 0;
    const maxChecks = 90; // 90 saniye max
    let initialUrl = window.location.href;

    showStatus('Urunler yukleniyor, lutfen bekleyin...');

    const checkInterval = setInterval(() => {
      checkCount++;

      // Sayfa degisti mi kontrol et (urunler eklendikten sonra baska sayfaya yonlendirilmis olabilir)
      if (window.location.href !== initialUrl) {
        clearInterval(checkInterval);
        showStatus('Urunler eklendi! Sonraki parcaya geciliyor...');
        markChunkComplete();
        return;
      }

      // Basari mesaji veya loading durumu kontrol et
      const pageText = document.body.textContent.toLowerCase();
      const successIndicators = [
        document.querySelector('.success-message'),
        document.querySelector('.alert-success'),
        document.querySelector('[class*="success"]:not([class*="btn"])'),
        document.querySelector('.toast-success'),
        document.querySelector('.notification-success'),
        pageText.includes('successfully'),
        pageText.includes('added'),
        pageText.includes('imported'),
        pageText.includes('completed')
      ];

      const isLoading = document.querySelector('.loading, .spinner, [class*="loading"], [class*="spinner"], [class*="progress"]');

      // Basari durumu
      if (successIndicators.some(Boolean) && !isLoading) {
        clearInterval(checkInterval);
        showStatus('Urunler eklendi! Sonraki parcaya geciliyor...');
        setTimeout(() => markChunkComplete(), 1500);
        return;
      }

      // Textarea bosaldiysa (form submit edilmis demektir)
      const textarea = findTextarea();
      if (textarea && textarea.value.trim() === '' && checkCount > 5) {
        clearInterval(checkInterval);
        showStatus('Form gonderildi! Sonraki parcaya geciliyor...');
        setTimeout(() => markChunkComplete(), 1500);
        return;
      }

      // Timeout
      if (checkCount >= maxChecks) {
        clearInterval(checkInterval);
        // Zaman asimi - yine de devam et
        showStatus('Zaman asimi - bir sonraki parcaya geciliyor...');
        markChunkComplete();
        return;
      }

      // Hala bekliyoruz
      showStatus(`Urunler yukleniyor... (${checkCount}s)`);
    }, 1000);
  }

  function markChunkComplete() {
    currentAutoChunk++;

    const chunkSize = 5000;
    const totalChunks = Math.ceil(allAsins.length / chunkSize);

    if (currentAutoChunk >= totalChunks) {
      completeAutoUpload();
      return;
    }

    // Sonraki chunk icin state'i guncelle
    chrome.storage.local.set({
      srAutoMode: true,
      srAutoAsins: allAsins,
      srAutoChunk: currentAutoChunk,
      srAutoStore: storeName,
      srAutoTimestamp: Date.now()
    });

    showStatus(`Parca ${currentAutoChunk}/${totalChunks} tamamlandi! Urun ekleme sayfasina yonlendiriliyor...`);

    // Urun ekleme sayfasina git - sonraki chunk otomatik yuklenecek
    setTimeout(() => {
      window.location.href = ADD_PRODUCTS_URL;
    }, 2000);
  }

  function completeAutoUpload() {
    clearAutoMode();
    showStatus('✅ Tum ASIN\'ler basariyla yuklendi!');
    showToast('Tum ASIN\'ler yuklendi!');
    updatePanel();
  }

  function showStatus(msg, isError) {
    const statusEl = document.getElementById('asinScoutStatus');
    if (!statusEl) return;

    statusEl.style.display = 'block';
    statusEl.textContent = msg;
    statusEl.className = 'asin-scout-status' + (isError ? ' error' : '');
  }

  function loadChunk(btn) {
    const start = parseInt(btn.dataset.start);
    const end = parseInt(btn.dataset.end);
    const chunk = allAsins.slice(start, end);

    // Find textarea
    const textarea = findTextarea();
    if (!textarea) {
      showToast('Textarea bulunamadi! Sayfayi yenileyin.', true);
      return;
    }

    // Set loading state
    btn.classList.add('loading');
    btn.querySelector('.asin-scout-chunk-status').textContent = '⏳';

    // Fill textarea
    textarea.value = chunk.join('\n');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // Mark as done
    setTimeout(() => {
      btn.classList.remove('loading');
      btn.classList.add('done');
      btn.querySelector('.asin-scout-chunk-status').textContent = '✅';
      showToast(`${formatNumber(chunk.length)} ASIN yuklendi!`);
    }, 300);
  }

  function findTextarea() {
    // Seller Running'deki textarea'yi bul
    // Ekran goruntusune gore "ASIN or product URL List" label'i altinda
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      // Buyuk textarea'yi bul (ASIN listesi icin)
      if (ta.offsetHeight > 100 || ta.rows > 5) {
        return ta;
      }
    }
    // Fallback - ilk textarea
    return textareas[0] || null;
  }

  function formatNumber(n) {
    if (n >= 1000) {
      return Math.round(n / 1000) + 'K';
    }
    return String(n);
  }

  function showToast(msg, isError) {
    let toast = document.querySelector('.asin-scout-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'asin-scout-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = msg;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // Periyodik olarak ASIN'leri guncelle (sadece otomatik mod degilse)
  setInterval(() => {
    if (!isAutoMode) {
      loadAsins();
    }
  }, 5000);
})();
