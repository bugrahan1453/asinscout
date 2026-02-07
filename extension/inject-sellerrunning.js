// ASIN Scout - Seller Running Integration
(function() {
  'use strict';

  let allAsins = [];
  let storeName = '';
  let panelVisible = false;
  let panel = null;
  let toggleBtn = null;

  // Sayfa yuklendiginde ASIN'leri al
  init();

  function init() {
    // Kisa bekle - sayfa tam yuklensin
    setTimeout(() => {
      loadAsins();
      createToggleButton();
    }, 1000);
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
        <div class="asin-scout-chunks" id="asinScoutChunks"></div>
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
    const chunksEl = document.getElementById('asinScoutChunks');

    if (!totalEl || !chunksEl) return;

    totalEl.textContent = formatNumber(allAsins.length);
    storeEl.textContent = storeName ? `📁 ${storeName}` : '';

    if (allAsins.length === 0) {
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
    let html = '';

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min((i + 1) * chunkSize, allAsins.length);
      const count = end - start;

      html += `
        <div class="asin-scout-chunk-btn" data-start="${start}" data-end="${end}">
          <div>
            <div class="asin-scout-chunk-range">${formatNumber(start + 1)} - ${formatNumber(end)}</div>
            <div class="asin-scout-chunk-count">${formatNumber(count)} ASIN</div>
          </div>
          <div class="asin-scout-chunk-status">📤</div>
        </div>
      `;
    }

    chunksEl.innerHTML = html;

    // Click handlers
    chunksEl.querySelectorAll('.asin-scout-chunk-btn').forEach(btn => {
      btn.onclick = () => loadChunk(btn);
    });
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

  // Periyodik olarak ASIN'leri guncelle
  setInterval(loadAsins, 5000);
})();
