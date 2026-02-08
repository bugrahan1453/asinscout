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
      try {
        if (data.srAutoMode && data.srAutoAsins && data.srAutoAsins.length > 0) {
          const age = Date.now() - (data.srAutoTimestamp || 0);
          const chunkSize = 5000;
          const totalChunks = Math.ceil(data.srAutoAsins.length / chunkSize);
          const currentChunk = data.srAutoChunk || 0;

          console.log('ASIN Scout: Auto mode kontrol - Chunk:', currentChunk, '/', totalChunks, '- Age:', Math.round(age/1000), 's');

          // 3 saat timeout
          if (age < 180 * 60 * 1000) {
            const currentPath = window.location.pathname;
            const isOnAddPage = currentPath === '/inventory/add';
            const isOnAddedPage = currentPath === '/inventory/added';

            // /inventory/added sayfasindaysak - urunler yuklendi demektir
            if (isOnAddedPage) {
              const nextChunk = currentChunk + 1;

              console.log('ASIN Scout: Added sayfasinda, chunk artiriliyor:', nextChunk, '/', totalChunks);

              // Tum chunk'lar bitti mi?
              if (nextChunk >= totalChunks) {
                console.log('ASIN Scout: Tum chunklar tamamlandi!');
                clearAutoMode();
                alert('✅ Tüm ASIN\'ler başarıyla yüklendi! (' + data.srAutoAsins.length + ' ASIN)');
                return;
              }

              // Sonraki chunk'i kaydet ve yonlendir
              chrome.storage.local.set({
                srAutoMode: true,
                srAutoAsins: data.srAutoAsins,
                srAutoChunk: nextChunk,
                srAutoStore: data.srAutoStore,
                srAutoTimestamp: Date.now()
              }, () => {
                if (chrome.runtime.lastError) {
                  console.error('ASIN Scout: Storage hatasi:', chrome.runtime.lastError);
                  alert('Storage hatası! Konsolu kontrol edin.');
                  return;
                }
                console.log('ASIN Scout: Chunk kaydedildi:', nextChunk, '- Yonlendiriliyor...');
                window.location.href = ADD_PRODUCTS_URL;
              });
              return;
            }

            // Baska bir sayfadaysak (added degil), sadece yonlendir
            if (!isOnAddPage) {
              console.log('ASIN Scout: Auto mode aktif, urun ekleme sayfasina yonlendiriliyor...', currentPath);
              window.location.href = ADD_PRODUCTS_URL;
              return;
            }

            // /inventory/add sayfasindayiz - devam et
            allAsins = data.srAutoAsins;
            storeName = data.srAutoStore || '';
            currentAutoChunk = currentChunk;
            isAutoMode = true;

            console.log('ASIN Scout: Add sayfasinda, chunk yukleniyor:', currentAutoChunk, '/', totalChunks);

            updateToggleButton();
            showPanel();

            // Biraz bekle ve sonraki chunk'i yukle
            setTimeout(() => {
              continueAutoUpload();
            }, 2000);
          } else {
            console.log('ASIN Scout: Timeout - auto mode temizleniyor');
            clearAutoMode();
          }
        }
      } catch (err) {
        console.error('ASIN Scout: checkAutoMode hatasi:', err);
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

    // React/Vue gibi framework'ler icin ekstra event'ler
    textarea.dispatchEvent(new Event('blur', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    // SKU Prefix alanini doldur (Turkce tarih)
    fillSkuPrefix();

    showStatus(`${formatNumber(chunk.length)} ASIN yuklendi, buton aranıyor...`);

    // Biraz bekle, sonra Add Products butonuna bas (form'un hazir olmasini bekle)
    setTimeout(() => {
      clickAddProducts();
    }, 2000);
  }

  function clickAddProducts() {
    // "Add Products" butonunu bul - Seller Running icin ozel
    let addBtn = null;

    // Yontem 1: Buton metnine gore ara
    const buttons = document.querySelectorAll('button, input[type="submit"], a.btn, .button');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').toLowerCase().trim();
      // "Add Products" veya benzeri metinleri ara
      if (text.includes('add product') || text === 'add' || text === 'submit' || text === 'ekle') {
        if (!btn.disabled && btn.offsetParent !== null) {
          addBtn = btn;
          console.log('ASIN Scout: Buton bulundu (metin):', text);
          break;
        }
      }
    }

    // Yontem 2: Form submit butonu
    if (!addBtn) {
      const form = document.querySelector('form');
      if (form) {
        addBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])');
        if (addBtn) console.log('ASIN Scout: Buton bulundu (form submit)');
      }
    }

    // Yontem 3: Primary/ana aksiyon butonu
    if (!addBtn) {
      addBtn = document.querySelector(
        'button.btn-primary, button.primary, button[class*="primary"], ' +
        'button[class*="submit"], button[class*="action"], ' +
        '.btn-primary, .primary-button'
      );
      if (addBtn) console.log('ASIN Scout: Buton bulundu (primary class)');
    }

    // Yontem 4: Sayfadaki son/buyuk buton
    if (!addBtn) {
      const allBtns = Array.from(document.querySelectorAll('button:not([disabled])'));
      // Gorunur butonlari filtrele
      const visibleBtns = allBtns.filter(b => b.offsetParent !== null && b.offsetHeight > 30);
      if (visibleBtns.length > 0) {
        addBtn = visibleBtns[visibleBtns.length - 1]; // Son buyuk buton
        console.log('ASIN Scout: Buton bulundu (son buton):', addBtn.textContent);
      }
    }

    if (!addBtn) {
      showStatus('Add Products butonu bulunamadi! Manuel olarak tiklayin.', true);
      console.log('ASIN Scout: Buton bulunamadi! Sayfadaki butonlar:',
        Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim())
      );
      // 10 saniye bekle, belki manuel tiklayacak
      setTimeout(() => waitForCompletion(), 10000);
      return;
    }

    showStatus('Add Products butonuna tiklaniyor...');

    // Butonu gorunur alana kaydir
    addBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Biraz bekle ve tikla
    setTimeout(() => {
      // Birden fazla tiklama yontemi dene
      try {
        // Yontem 1: Normal click
        addBtn.click();

        // Yontem 2: Mouse event
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        addBtn.dispatchEvent(clickEvent);

        console.log('ASIN Scout: Butona tiklandi');
      } catch (e) {
        console.error('ASIN Scout: Tiklama hatasi:', e);
      }

      // Yukleme tamamlanmasini bekle
      waitForCompletion();
    }, 500);
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

    console.log('ASIN Scout: Chunk tamamlandi, siradaki:', currentAutoChunk, '/', totalChunks);

    if (currentAutoChunk >= totalChunks) {
      completeAutoUpload();
      return;
    }

    showStatus(`Parca ${currentAutoChunk}/${totalChunks} tamamlandi! Kaydediliyor...`);

    // Sonraki chunk icin state'i guncelle - STORAGE KAYDEDILMEDEN SAYFAYI YONLENDIRME!
    chrome.storage.local.set({
      srAutoMode: true,
      srAutoAsins: allAsins,
      srAutoChunk: currentAutoChunk,
      srAutoStore: storeName,
      srAutoTimestamp: Date.now()
    }, () => {
      // Storage kaydedildikten sonra yonlendir
      console.log('ASIN Scout: Storage kaydedildi, chunk:', currentAutoChunk);
      showStatus(`Parca ${currentAutoChunk}/${totalChunks} - Urun ekleme sayfasina yonlendiriliyor...`);

      // Urun ekleme sayfasina git - sonraki chunk otomatik yuklenecek
      setTimeout(() => {
        window.location.href = ADD_PRODUCTS_URL;
      }, 1500);
    });
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

    // SKU Prefix alanini doldur (Turkce tarih)
    fillSkuPrefix();

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

  function fillSkuPrefix() {
    // Turkce ay isimleri
    const turkishMonths = [
      'OCAK', 'SUBAT', 'MART', 'NISAN', 'MAYIS', 'HAZIRAN',
      'TEMMUZ', 'AGUSTOS', 'EYLUL', 'EKIM', 'KASIM', 'ARALIK'
    ];

    const now = new Date();
    const month = turkishMonths[now.getMonth()];
    const day = String(now.getDate()).padStart(2, '0');
    const skuPrefix = month + day; // Ornek: SUBAT08

    // SKU Prefix input'unu bul
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (const input of inputs) {
      // Label veya placeholder'a gore bul
      const label = input.closest('label') || document.querySelector(`label[for="${input.id}"]`);
      const labelText = label ? label.textContent.toLowerCase() : '';
      const placeholder = (input.placeholder || '').toLowerCase();
      const name = (input.name || '').toLowerCase();

      if (labelText.includes('sku') || labelText.includes('prefix') ||
          placeholder.includes('sku') || placeholder.includes('prefix') ||
          name.includes('sku') || name.includes('prefix')) {
        input.value = skuPrefix;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('ASIN Scout: SKU Prefix ayarlandi:', skuPrefix);
        return;
      }
    }

    // Fallback: Textarea'dan sonraki ilk input'u dene
    const textarea = findTextarea();
    if (textarea) {
      const form = textarea.closest('form');
      if (form) {
        const skuInput = form.querySelector('input[type="text"]:not([style*="display: none"])');
        if (skuInput && skuInput !== textarea) {
          skuInput.value = skuPrefix;
          skuInput.dispatchEvent(new Event('input', { bubbles: true }));
          skuInput.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('ASIN Scout: SKU Prefix ayarlandi (fallback):', skuPrefix);
        }
      }
    }
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
