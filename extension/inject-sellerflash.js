// ASIN Scout - Seller Flash Integration
(function() {
  'use strict';

  let allAsins = [];
  let storeName = '';
  let panelVisible = false;
  let panel = null;
  let toggleBtn = null;
  let isAutoMode = false;
  let currentAutoChunk = 0;

  // Seller Flash urun ekleme sayfasi URL'si
  const ADD_PRODUCTS_URL = 'https://panel.sellerflash.com/inventory/newV2';

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
    chrome.storage.local.get(['sfAutoMode', 'sfAutoAsins', 'sfAutoChunk', 'sfAutoStore', 'sfAutoTimestamp', 'sfAutoWaitingSuccess'], data => {
      try {
        if (data.sfAutoMode && data.sfAutoAsins && data.sfAutoAsins.length > 0) {
          const age = Date.now() - (data.sfAutoTimestamp || 0);
          const chunkSize = 5000;
          const totalChunks = Math.ceil(data.sfAutoAsins.length / chunkSize);
          const currentChunk = data.sfAutoChunk || 0;

          console.log('ASIN Scout SF: Auto mode kontrol - Chunk:', currentChunk, '/', totalChunks, '- Age:', Math.round(age/1000), 's');

          // 3 saat timeout
          if (age < 180 * 60 * 1000) {
            const currentPath = window.location.pathname;
            const isOnAddPage = currentPath.includes('/inventory/newV2');

            // Urun ekleme sayfasinda degilsek yonlendir
            if (!isOnAddPage) {
              console.log('ASIN Scout SF: Auto mode aktif, urun ekleme sayfasina yonlendiriliyor...', currentPath);
              window.location.href = ADD_PRODUCTS_URL;
              return;
            }

            // /inventory/newV2 sayfasindayiz - devam et
            allAsins = data.sfAutoAsins;
            storeName = data.sfAutoStore || '';
            currentAutoChunk = currentChunk;
            isAutoMode = true;

            console.log('ASIN Scout SF: Add sayfasinda, chunk yukleniyor:', currentAutoChunk, '/', totalChunks);

            updateToggleButton();
            showPanel();

            // Basari bekliyor muyduk?
            if (data.sfAutoWaitingSuccess) {
              // Sayfa yenilendi, onceki chunk tamamlanmis demektir
              console.log('ASIN Scout SF: Onceki chunk tamamlandi, sonrakine geciliyor');
              chrome.storage.local.remove(['sfAutoWaitingSuccess']);

              const nextChunk = currentChunk + 1;
              if (nextChunk >= totalChunks) {
                console.log('ASIN Scout SF: Tum chunklar tamamlandi!');
                clearAutoMode();
                alert('Tum ASIN\'ler basariyla yuklendi! (' + data.sfAutoAsins.length + ' ASIN)');
                return;
              }

              // Sonraki chunk'a gec
              currentAutoChunk = nextChunk;
              chrome.storage.local.set({
                sfAutoMode: true,
                sfAutoAsins: data.sfAutoAsins,
                sfAutoChunk: nextChunk,
                sfAutoStore: data.sfAutoStore,
                sfAutoTimestamp: Date.now()
              }, () => {
                updatePanel();
                setTimeout(() => processCurrentChunk(), 2000);
              });
              return;
            }

            // Biraz bekle ve chunk'i yukle
            setTimeout(() => {
              continueAutoUpload();
            }, 2000);
          } else {
            console.log('ASIN Scout SF: Timeout - auto mode temizleniyor');
            clearAutoMode();
          }
        }
      } catch (err) {
        console.error('ASIN Scout SF: checkAutoMode hatasi:', err);
      }
    });
  }

  function clearAutoMode() {
    isAutoMode = false;
    currentAutoChunk = 0;
    chrome.storage.local.remove(['sfAutoMode', 'sfAutoAsins', 'sfAutoChunk', 'sfAutoStore', 'sfAutoTimestamp', 'sfAutoWaitingSuccess']);
  }

  function loadAsins() {
    // Oncelik 1: Website'den gelen pending ASIN'ler (SF Yukle butonu)
    chrome.storage.local.get(['pendingAsinsSF', 'pendingStoreNameSF', 'pendingTimestampSF'], data => {
      if (data.pendingAsinsSF && data.pendingAsinsSF.length > 0) {
        // 5 dakikadan eski degilse kullan
        const age = Date.now() - (data.pendingTimestampSF || 0);
        if (age < 5 * 60 * 1000) {
          allAsins = data.pendingAsinsSF;
          storeName = data.pendingStoreNameSF || '';
          updateToggleButton();

          // Paneli otomatik ac
          if (!panelVisible) {
            showPanel();
          } else {
            updatePanel();
          }

          // Kullanildiktan sonra temizle
          chrome.storage.local.remove(['pendingAsinsSF', 'pendingStoreNameSF', 'pendingTimestampSF']);
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
      <span>ASIN Scout</span>
      <span class="asin-scout-toggle-badge" id="asinScoutBadgeSF">0</span>
    `;
    toggleBtn.onclick = togglePanel;
    document.body.appendChild(toggleBtn);
    updateToggleButton();
  }

  function updateToggleButton() {
    const badge = document.getElementById('asinScoutBadgeSF');
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
          <span class="asin-scout-platform">Seller Flash</span>
        </div>
        <button class="asin-scout-close" id="asinScoutCloseSF">&times;</button>
      </div>
      <div class="asin-scout-body">
        <div class="asin-scout-info">
          <div class="asin-scout-total" id="asinScoutTotalSF">0</div>
          <div class="asin-scout-label">Yuklemeye Hazir ASIN</div>
          <div class="asin-scout-store" id="asinScoutStoreSF"></div>
        </div>
        <div class="asin-scout-auto-section" id="asinScoutAutoSectionSF"></div>
        <div class="asin-scout-chunks" id="asinScoutChunksSF"></div>
        <div class="asin-scout-status" id="asinScoutStatusSF" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // Close button
    document.getElementById('asinScoutCloseSF').onclick = hidePanel;

    // Refresh button - panel acildiginda ASIN'leri yenile
    loadAsins();
  }

  function updatePanel() {
    const totalEl = document.getElementById('asinScoutTotalSF');
    const storeEl = document.getElementById('asinScoutStoreSF');
    const autoEl = document.getElementById('asinScoutAutoSectionSF');
    const chunksEl = document.getElementById('asinScoutChunksSF');

    if (!totalEl || !chunksEl) return;

    totalEl.textContent = formatNumber(allAsins.length);
    storeEl.textContent = storeName ? `${storeName}` : '';

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
        <button class="asin-scout-auto-btn" id="asinScoutAutoBtnSF" ${isAutoMode ? 'disabled' : ''}>
          <span class="asin-scout-auto-icon">${isAutoMode ? '⏳' : '🚀'}</span>
          <span>${isAutoMode ? 'Otomatik Yukleme Devam Ediyor...' : 'Tumunu Otomatik Yukle'}</span>
        </button>
        ${isAutoMode ? `
          <button class="asin-scout-stop-btn" id="asinScoutStopBtnSF">
            <span>Durdur</span>
          </button>
        ` : ''}
        <div class="asin-scout-auto-info">
          Otomatik mod tum ${totalChunks} parcayi sirayla yukler
        </div>
      `;

      if (!isAutoMode) {
        document.getElementById('asinScoutAutoBtnSF').onclick = startAutoUpload;
      }

      const stopBtn = document.getElementById('asinScoutStopBtnSF');
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
          <div class="asin-scout-chunk-status">${isDone ? '✓' : isCurrent ? '...' : '>'}</div>
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
      sfAutoMode: true,
      sfAutoAsins: allAsins,
      sfAutoChunk: 0,
      sfAutoStore: storeName,
      sfAutoTimestamp: Date.now()
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

    showStatus(`${formatNumber(chunk.length)} ASIN yuklendi, buton araniyor...`);

    // Biraz bekle, sonra Add Products butonuna bas (form'un hazir olmasini bekle)
    setTimeout(() => {
      clickAddProducts();
    }, 2000);
  }

  function clickAddProducts() {
    // "Add Products" veya benzeri butonu bul - Seller Flash icin ozel
    let addBtn = null;

    // Yontem 1: Buton metnine gore ara
    const buttons = document.querySelectorAll('button, input[type="submit"], a.btn, .button, [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').toLowerCase().trim();
      // "Add", "Submit", "Save", "Ekle", "Kaydet" gibi metinleri ara
      if (text.includes('add') || text.includes('submit') || text.includes('save') ||
          text.includes('ekle') || text.includes('kaydet') || text.includes('yukle') ||
          text.includes('import') || text.includes('upload')) {
        if (!btn.disabled && btn.offsetParent !== null) {
          addBtn = btn;
          console.log('ASIN Scout SF: Buton bulundu (metin):', text);
          break;
        }
      }
    }

    // Yontem 2: Form submit butonu
    if (!addBtn) {
      const form = document.querySelector('form');
      if (form) {
        addBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])');
        if (addBtn) console.log('ASIN Scout SF: Buton bulundu (form submit)');
      }
    }

    // Yontem 3: Primary/ana aksiyon butonu
    if (!addBtn) {
      addBtn = document.querySelector(
        'button.btn-primary, button.primary, button[class*="primary"], ' +
        'button[class*="submit"], button[class*="action"], ' +
        '.btn-primary, .primary-button, button[class*="success"]'
      );
      if (addBtn) console.log('ASIN Scout SF: Buton bulundu (primary class)');
    }

    // Yontem 4: Sayfadaki son/buyuk buton
    if (!addBtn) {
      const allBtns = Array.from(document.querySelectorAll('button:not([disabled])'));
      // Gorunur butonlari filtrele
      const visibleBtns = allBtns.filter(b => b.offsetParent !== null && b.offsetHeight > 30);
      if (visibleBtns.length > 0) {
        addBtn = visibleBtns[visibleBtns.length - 1]; // Son buyuk buton
        console.log('ASIN Scout SF: Buton bulundu (son buton):', addBtn.textContent);
      }
    }

    if (!addBtn) {
      showStatus('Add Products butonu bulunamadi! Manuel olarak tiklayin.', true);
      console.log('ASIN Scout SF: Buton bulunamadi! Sayfadaki butonlar:',
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

        console.log('ASIN Scout SF: Butona tiklandi');
      } catch (e) {
        console.error('ASIN Scout SF: Tiklama hatasi:', e);
      }

      // Onay popup'ini bekle ve onayla
      setTimeout(() => {
        waitForConfirmationPopup();
      }, 1000);
    }, 500);
  }

  function waitForConfirmationPopup() {
    let popupCheckCount = 0;
    const maxPopupChecks = 30; // 30 saniye max popup bekleme

    showStatus('Onay popup\'i bekleniyor...');

    const popupInterval = setInterval(() => {
      popupCheckCount++;

      // Onay popup'ini ara
      const confirmBtn = findConfirmButton();

      if (confirmBtn) {
        clearInterval(popupInterval);
        console.log('ASIN Scout SF: Onay butonu bulundu, tiklaniyor...');
        showStatus('Onay butonuna tiklaniyor...');

        // Onayla butonuna tikla
        try {
          confirmBtn.click();
          confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          console.log('ASIN Scout SF: Onay butonuna tiklandi');
        } catch (e) {
          console.error('ASIN Scout SF: Onay tiklama hatasi:', e);
        }

        // Hemen chunk'i tamamlandi olarak isaretle ve sayfayi yenile
        // Boylece sayfa ne yaparsa yapsin biz kontrol ediyoruz
        setTimeout(() => {
          markChunkCompleteAndRefresh();
        }, 2000);
        return;
      }

      // Popup yok ama belki direkt isleme gecti
      if (popupCheckCount >= 5) {
        // Basari mesaji veya yukleme durumu kontrol et
        const pageText = document.body.textContent.toLowerCase();
        const isLoading = document.querySelector('.loading, .spinner, [class*="loading"], [class*="spinner"]');
        const hasSuccess = pageText.includes('successfully') || pageText.includes('basariyla') ||
                          pageText.includes('eklendi') || pageText.includes('tamamlandi');

        if (isLoading || hasSuccess) {
          clearInterval(popupInterval);
          console.log('ASIN Scout SF: Popup yok, direkt isleme gecildi');
          // 5 saniye bekle ve sonraki chunk'a gec
          setTimeout(() => {
            markChunkCompleteAndRefresh();
          }, 5000);
          return;
        }
      }

      // Timeout - 10 saniye sonra popup yoksa yine de devam et
      if (popupCheckCount >= 10) {
        clearInterval(popupInterval);
        console.log('ASIN Scout SF: Popup bulunamadi, yine de devam ediliyor');
        // Muhtemelen islem tamamlandi, sonraki chunk'a gec
        setTimeout(() => {
          markChunkCompleteAndRefresh();
        }, 3000);
        return;
      }

      showStatus(`Onay popup'i bekleniyor... (${popupCheckCount}s)`);
    }, 1000);
  }

  function findConfirmButton() {
    // "Onayla", "Confirm", "Evet", "Yes", "OK" gibi onay butonlarini ara
    const allButtons = document.querySelectorAll('button, [role="button"], .btn, a.button');

    for (const btn of allButtons) {
      const text = (btn.textContent || '').toLowerCase().trim();
      const isVisible = btn.offsetParent !== null && btn.offsetHeight > 0;

      if (!isVisible) continue;

      // Onay butonlari
      if (text.includes('onayla') || text.includes('confirm') || text.includes('evet') ||
          text.includes('yes') || text === 'ok' || text === 'tamam') {
        // Iptal/Cancel butonlarini disla
        if (!text.includes('iptal') && !text.includes('cancel') && !text.includes('hayir') && !text.includes('no')) {
          console.log('ASIN Scout SF: Onay butonu bulundu:', text);
          return btn;
        }
      }
    }

    // Class'a gore ara (yesil/primary butonlar genelde onay)
    const greenBtn = document.querySelector(
      '.modal button[class*="success"], .modal button[class*="confirm"], ' +
      '.modal button[class*="primary"], .modal button[class*="green"], ' +
      '[class*="modal"] button[class*="success"], [class*="modal"] button[class*="confirm"], ' +
      '[class*="dialog"] button[class*="success"], [class*="dialog"] button[class*="confirm"], ' +
      '.swal2-confirm, .confirm-btn, .btn-confirm'
    );

    if (greenBtn && greenBtn.offsetParent !== null) {
      console.log('ASIN Scout SF: Onay butonu bulundu (class):', greenBtn.textContent);
      return greenBtn;
    }

    return null;
  }

  function markChunkCompleteAndRefresh() {
    const chunkSize = 5000;
    const totalChunks = Math.ceil(allAsins.length / chunkSize);
    const nextChunk = currentAutoChunk + 1;

    console.log('ASIN Scout SF: Chunk tamamlandi, siradaki:', nextChunk, '/', totalChunks);

    if (nextChunk >= totalChunks) {
      // Tum chunklar tamamlandi
      clearAutoMode();
      showStatus('Tum ASIN\'ler basariyla yuklendi!');
      alert('Tum ASIN\'ler basariyla yuklendi! (' + allAsins.length + ' ASIN)');
      return;
    }

    showStatus(`Parca ${nextChunk + 1}/${totalChunks} icin hazirlaniliyor...`);

    // Sonraki chunk'i kaydet
    chrome.storage.local.set({
      sfAutoMode: true,
      sfAutoAsins: allAsins,
      sfAutoChunk: nextChunk,
      sfAutoStore: storeName,
      sfAutoTimestamp: Date.now()
    }, () => {
      console.log('ASIN Scout SF: Sonraki chunk kaydedildi:', nextChunk);
      showStatus(`Sayfa yenileniyor, parca ${nextChunk + 1} yuklenecek...`);

      // 3 saniye bekle ve sayfayi yenile
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    });
  }

  function waitForCompletion() {
    let checkCount = 0;
    const maxChecks = 120; // 120 saniye max (SF daha yavas olabilir)
    let textareaInitialValue = '';

    const textarea = findTextarea();
    if (textarea) {
      textareaInitialValue = textarea.value;
    }

    showStatus('Urunler yukleniyor, lutfen bekleyin...');

    // Basari bekliyor olarak isaretle
    chrome.storage.local.set({ sfAutoWaitingSuccess: true });

    const checkInterval = setInterval(() => {
      checkCount++;

      // Basari mesaji veya loading durumu kontrol et
      const pageText = document.body.textContent.toLowerCase();
      const successIndicators = [
        document.querySelector('.success-message'),
        document.querySelector('.alert-success'),
        document.querySelector('[class*="success"]:not([class*="btn"])'),
        document.querySelector('.toast-success'),
        document.querySelector('.notification-success'),
        document.querySelector('.swal2-success'),
        document.querySelector('[class*="toast"][class*="success"]'),
        pageText.includes('successfully'),
        pageText.includes('basariyla'),
        pageText.includes('added'),
        pageText.includes('eklendi'),
        pageText.includes('imported'),
        pageText.includes('completed'),
        pageText.includes('tamamlandi')
      ];

      const isLoading = document.querySelector('.loading, .spinner, [class*="loading"], [class*="spinner"], [class*="progress"]');

      // Hata mesaji kontrol et
      const errorIndicators = [
        document.querySelector('.error-message'),
        document.querySelector('.alert-danger'),
        document.querySelector('.alert-error'),
        document.querySelector('[class*="error"]:not([class*="btn"])'),
        pageText.includes('error'),
        pageText.includes('failed'),
        pageText.includes('hata')
      ];

      // Hata varsa
      if (errorIndicators.some(Boolean) && !isLoading) {
        clearInterval(checkInterval);
        showStatus('Hata olustu! Lutfen kontrol edin.', true);
        chrome.storage.local.remove(['sfAutoWaitingSuccess']);
        return;
      }

      // Basari durumu
      if (successIndicators.some(Boolean) && !isLoading) {
        clearInterval(checkInterval);
        showStatus('Urunler eklendi! Sonraki parcaya geciliyor...');
        setTimeout(() => markChunkComplete(), 2000);
        return;
      }

      // Textarea bosaldiysa (form submit edilmis demektir)
      const currentTextarea = findTextarea();
      if (currentTextarea && textareaInitialValue && currentTextarea.value.trim() === '' && checkCount > 5) {
        clearInterval(checkInterval);
        showStatus('Form gonderildi! Sonraki parcaya geciliyor...');
        setTimeout(() => markChunkComplete(), 2000);
        return;
      }

      // Modal/popup kapandiysa
      const modalClosed = !document.querySelector('.modal.show, .modal.active, [class*="modal"][class*="open"]');
      if (checkCount > 10 && modalClosed && !isLoading) {
        // Textarea'ya bakalim degisti mi
        if (currentTextarea && currentTextarea.value !== textareaInitialValue) {
          clearInterval(checkInterval);
          showStatus('Islem tamamlandi! Sonraki parcaya geciliyor...');
          setTimeout(() => markChunkComplete(), 2000);
          return;
        }
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
    chrome.storage.local.remove(['sfAutoWaitingSuccess']);
    currentAutoChunk++;

    const chunkSize = 5000;
    const totalChunks = Math.ceil(allAsins.length / chunkSize);

    console.log('ASIN Scout SF: Chunk tamamlandi, siradaki:', currentAutoChunk, '/', totalChunks);

    if (currentAutoChunk >= totalChunks) {
      completeAutoUpload();
      return;
    }

    showStatus(`Parca ${currentAutoChunk}/${totalChunks} tamamlandi! Kaydediliyor...`);

    // Sonraki chunk icin state'i guncelle
    chrome.storage.local.set({
      sfAutoMode: true,
      sfAutoAsins: allAsins,
      sfAutoChunk: currentAutoChunk,
      sfAutoStore: storeName,
      sfAutoTimestamp: Date.now()
    }, () => {
      console.log('ASIN Scout SF: Storage kaydedildi, chunk:', currentAutoChunk);
      showStatus(`Parca ${currentAutoChunk}/${totalChunks} - Sayfa yenileniyor...`);

      // Sayfayi yenile - ayni URL'de kalacak
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    });
  }

  function completeAutoUpload() {
    clearAutoMode();
    showStatus('Tum ASIN\'ler basariyla yuklendi!');
    showToast('Tum ASIN\'ler yuklendi!');
    updatePanel();
  }

  function showStatus(msg, isError) {
    const statusEl = document.getElementById('asinScoutStatusSF');
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
    btn.querySelector('.asin-scout-chunk-status').textContent = '...';

    // Fill textarea
    textarea.value = chunk.join('\n');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // Mark as done
    setTimeout(() => {
      btn.classList.remove('loading');
      btn.classList.add('done');
      btn.querySelector('.asin-scout-chunk-status').textContent = '✓';
      showToast(`${formatNumber(chunk.length)} ASIN yuklendi!`);
    }, 300);
  }

  function findTextarea() {
    // Seller Flash'deki textarea'yi bul
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
    return Number(n || 0).toLocaleString('tr-TR');
  }

  function showToast(msg, isError) {
    let toast = document.querySelector('.asin-scout-toast-sf');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'asin-scout-toast asin-scout-toast-sf';
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
