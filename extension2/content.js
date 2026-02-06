// ASIN Scout Pro v2 TURBO - PARALLEL FETCHING
// 5x daha hızlı tarama - Paralel sayfa çekme
(function() {
  'use strict';
  if (window.__asinScoutTurbo) return;
  window.__asinScoutTurbo = true;

  let scanning = false, stopRequested = false, pauseRequested = false;
  const SORTS = ['', 'price-asc-rank', 'price-desc-rank', 'review-rank', 'date-desc-rank'];
  const PARALLEL_COUNT = 2; // Aynı anda 2 sayfa (5 çok agresifti, Amazon engelliyor)

  // Pencere kapatma uyarısı
  function beforeUnloadHandler(e) {
    if (scanning && !stopRequested) {
      e.preventDefault();
      e.returnValue = 'Tarama devam ediyor! Sayfayı kapatmak istediğinizden emin misiniz?';
      return e.returnValue;
    }
  }

  // Tarama başladığında uyarıyı aktifleştir
  function enableCloseWarning() {
    window.addEventListener('beforeunload', beforeUnloadHandler);
  }

  // Tarama bittiğinde uyarıyı kaldır
  function disableCloseWarning() {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
  }

  // Adaptive throttle controller - daha konservatif
  const throttle = {
    delay: 150,      // Başlangıç gecikmesi (daha yavaş)
    min: 100,        // Minimum gecikme (asla bunun altına düşme)
    max: 8000,       // Maksimum gecikme
    successes: 0,
    captchas: 0,
    errors: 0,
    lastCaptchaTime: 0,

    onSuccess() {
      this.successes++;
      this.errors = 0;
      // Captcha'dan 30 saniye geçtiyse yavaşça hızlan
      if (this.successes > 10 && Date.now() - this.lastCaptchaTime > 30000) {
        this.delay = Math.max(this.min, this.delay * 0.95);
      }
    },

    onCaptcha() {
      this.captchas++;
      this.successes = 0;
      this.lastCaptchaTime = Date.now();
      // Captcha'da ÇOK agresif yavaşla
      this.delay = Math.min(this.max, this.delay * 5);
    },

    onError() {
      this.errors++;
      if (this.errors > 2) {
        this.delay = Math.min(this.max, this.delay * 2);
      }
    },

    onEmpty() {
      this.delay = Math.min(this.max, this.delay * 1.05);
    },

    async wait() {
      await sleep(this.delay);
    },

    // Paralel istekler arasında bekleme
    async parallelWait() {
      await sleep(Math.max(100, this.delay));
    },

    reset() {
      this.delay = 150;
      this.successes = 0;
      this.captchas = 0;
      this.errors = 0;
      this.lastCaptchaTime = 0;
    },

    getStatus() {
      return `${Math.round(this.delay)}ms | ${this.captchas} captcha`;
    }
  };

  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (msg.action === 'getPageInfo') { send(analyzeCurrentPage()); }
    else if (msg.action === 'scanThisPage') { send({ asins: extractAsinsFromDOM() }); }
    else if (msg.action === 'startFetchScan') {
      scanning = true; stopRequested = false; pauseRequested = false;
      enableCloseWarning(); // Pencere kapatma uyarısını aktifleştir
      runTurboScan(msg.baseUrl, msg.mode, msg.scanLimit || 999999, msg.resumeFrom || 0);
      send({ ok: true });
    }
    else if (msg.action === 'pauseFetchScan') { pauseRequested = true; send({ ok: true }); }
    else if (msg.action === 'resumeFetchScan') { pauseRequested = false; send({ ok: true }); }
    else if (msg.action === 'stopFetchScan') { stopRequested = true; scanning = false; disableCloseWarning(); send({ ok: true }); }
    return true;
  });

  // ===== TURBO PARALLEL SCAN =====
  async function runTurboScan(baseUrl, mode, scanLimit, resumeFrom) {
    const allAsins = new Set();
    let scanned = resumeFrom || 0;
    const keywords = {};
    const brands = new Set();
    let captchaHits = 0;
    const startTime = Date.now();
    throttle.reset();

    // Pause check helper
    async function checkPause() {
      while (pauseRequested && !stopRequested) {
        report(allAsins, scanned, `⏸️ Duraklatıldı - ${allAsins.size} ASIN`);
        await sleep(500);
      }
    }

    // Limit check
    function checkLimit() {
      if (allAsins.size >= scanLimit) {
        report(allAsins, scanned, `✅ Limite ulaşıldı: ${scanLimit} ASIN`);
        stopRequested = true;
        return true;
      }
      return false;
    }

    // ===== PARALLEL PAGE FETCHER =====
    async function fetchPagesParallel(urls) {
      const results = [];
      let hasCaptcha = false;

      // Batch halinde paralel çek
      for (let i = 0; i < urls.length && !stopRequested; i += PARALLEL_COUNT) {
        await checkPause();
        if (stopRequested) break;

        const batch = urls.slice(i, Math.min(i + PARALLEL_COUNT, urls.length));

        // Paralel fetch - istekler arasında 100ms fark
        const promises = batch.map(async (url, idx) => {
          await sleep(idx * 100); // İstekler arasında 100ms fark
          return fetchPage(url);
        });

        const batchResults = await Promise.all(promises);
        results.push(...batchResults);

        // Captcha kontrolü
        if (batchResults.some(r => r.captcha)) {
          hasCaptcha = true;
          report(allAsins, scanned, `⚠️ Captcha! 5sn bekleniyor... (${throttle.getStatus()})`);
          await sleep(5000); // Captcha'da 5 saniye bekle
        } else {
          await throttle.parallelWait();
        }
      }

      return { results, hasCaptcha };
    }

    // ===== PHASE 1: TURBO SORT SCAN =====
    report(allAsins, scanned, `🚀 TURBO FAZ 1: Sort varyasyonları (${PARALLEL_COUNT}x paralel)...`);

    for (const sort of SORTS) {
      if (stopRequested || checkLimit()) break;
      await checkPause();

      const url = sort ? addSort(baseUrl, sort) : baseUrl;

      // 25 sayfayı 5'erli gruplar halinde paralel çek
      const pageUrls = [];
      for (let p = 1; p <= 25; p++) {
        pageUrls.push(addPage(url, p));
      }

      const { results } = await fetchPagesParallel(pageUrls);

      let emptyStreak = 0;
      for (const r of results) {
        if (stopRequested) break;
        scanned++;

        if (r.captcha) {
          captchaHits++;
          continue;
        }

        harvest(r.titles, keywords, r.brands, brands);
        let nc = 0;
        r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });

        if (nc === 0) emptyStreak++; else emptyStreak = 0;
        if (emptyStreak > 5) break;
      }

      report(allAsins, scanned, `${allAsins.size} ASIN | Sort:${sort||'default'} (${throttle.getStatus()})`);
      if (checkLimit()) break;
    }

    // ===== PHASE 2: TURBO PRICE SCAN =====
    if (!stopRequested && !checkLimit()) {
      report(allAsins, scanned, `💰 TURBO FAZ 2: Fiyat tarama (paralel)...`);

      // Fiyat aralıklarını paralel tara
      const priceRanges = [];
      for (let lo = 0; lo < 100; lo += 5) priceRanges.push([lo, lo + 5]);
      for (let lo = 100; lo < 500; lo += 25) priceRanges.push([lo, lo + 25]);
      for (let lo = 500; lo < 2000; lo += 100) priceRanges.push([lo, lo + 100]);

      for (const [lo, hi] of priceRanges) {
        if (stopRequested || checkLimit()) break;
        await checkPause();

        const url = addPriceFilter(baseUrl, lo, hi);
        const pageUrls = [];
        for (let p = 1; p <= 10; p++) {
          pageUrls.push(addPage(url, p));
        }

        const { results } = await fetchPagesParallel(pageUrls);

        for (const r of results) {
          if (stopRequested) break;
          scanned++;
          if (r.captcha) { captchaHits++; continue; }

          let nc = 0;
          r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
          if (nc > 0) {
            report(allAsins, scanned, `${allAsins.size} | $${lo}-$${hi} +${nc}`);
          }
        }
      }
    }

    // ===== PHASE 3: CATEGORY SCAN =====
    if (!stopRequested && !checkLimit()) {
      report(allAsins, scanned, `📂 TURBO FAZ 3: Kategori tarama...`);
      const cats = await discoverCategories(baseUrl);
      report(allAsins, scanned, `📂 ${cats.length} kategori bulundu`);

      for (const cat of cats) {
        if (stopRequested || checkLimit()) break;
        await checkPause();

        // Her kategori için 15 sayfayı paralel çek
        const pageUrls = [];
        for (let p = 1; p <= 15; p++) {
          pageUrls.push(addPage(cat.url, p));
        }

        const { results } = await fetchPagesParallel(pageUrls);

        for (const r of results) {
          if (stopRequested) break;
          scanned++;
          if (r.captcha) { captchaHits++; continue; }

          harvest(r.titles, keywords, r.brands, brands);
          let nc = 0;
          r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
          if (nc > 0) {
            report(allAsins, scanned, `${allAsins.size} | ${cat.name.substring(0,15)} +${nc}`);
          }
        }
      }
    }

    // ===== PHASE 4: BRAND SCAN =====
    if (!stopRequested && !checkLimit() && brands.size > 0) {
      const brandList = Array.from(brands).slice(0, 30);
      report(allAsins, scanned, `🏷️ TURBO FAZ 4: ${brandList.length} marka (paralel)...`);

      for (const brand of brandList) {
        if (stopRequested || checkLimit()) break;
        await checkPause();

        const brandUrl = addBrand(baseUrl, brand);
        const pageUrls = [];
        for (let p = 1; p <= 10; p++) {
          pageUrls.push(addPage(brandUrl, p));
        }

        const { results } = await fetchPagesParallel(pageUrls);

        for (const r of results) {
          if (stopRequested) break;
          scanned++;
          if (r.captcha) { captchaHits++; continue; }

          let nc = 0;
          r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
          if (nc > 0) {
            report(allAsins, scanned, `${allAsins.size} | Marka:${brand.substring(0,12)} +${nc}`);
          }
        }
      }
    }

    // ===== PHASE 5: RATING SCAN =====
    if (!stopRequested && !checkLimit()) {
      report(allAsins, scanned, `⭐ TURBO FAZ 5: Rating filtreleri (paralel)...`);

      for (const stars of ['4', '3', '2', '1']) {
        if (stopRequested || checkLimit()) break;
        await checkPause();

        const url = addRating(baseUrl, stars);
        const pageUrls = [];
        for (let p = 1; p <= 15; p++) {
          pageUrls.push(addPage(url, p));
        }

        const { results } = await fetchPagesParallel(pageUrls);

        for (const r of results) {
          if (stopRequested) break;
          scanned++;
          if (r.captcha) { captchaHits++; continue; }

          let nc = 0;
          r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
          if (nc > 0) {
            report(allAsins, scanned, `${allAsins.size} | ${stars}★+ +${nc}`);
          }
        }
      }
    }

    // ===== PHASE 6: SPIDER CRAWL =====
    if (!stopRequested && !checkLimit()) {
      report(allAsins, scanned, `🕷️ TURBO FAZ 6: Spider Crawl (paralel)...`);

      const crawled = new Set();
      const toCrawl = Array.from(allAsins);
      let crawlIndex = 0;
      let newFromCrawl = 0;
      const maxCrawl = 2000;
      const origin = getOrigin(baseUrl);

      while (crawlIndex < Math.min(toCrawl.length, maxCrawl) && !stopRequested && !checkLimit()) {
        await checkPause();

        // 5 ASIN'i paralel crawl et
        const batch = [];
        for (let i = 0; i < PARALLEL_COUNT && crawlIndex < Math.min(toCrawl.length, maxCrawl); i++) {
          const asin = toCrawl[crawlIndex++];
          if (!crawled.has(asin)) {
            crawled.add(asin);
            batch.push(asin);
          }
        }

        if (batch.length === 0) continue;

        // Paralel related fetch
        const promises = batch.map((asin, idx) => {
          return new Promise(async (resolve) => {
            await sleep(idx * 50);
            const related = await fetchRelated(asin, origin);
            resolve({ asin, related });
          });
        });

        const results = await Promise.all(promises);
        scanned += batch.length;

        for (const { asin, related } of results) {
          if (related && related.captcha) {
            captchaHits++;
            continue;
          }

          const relatedAsins = Array.isArray(related) ? related : (related?.asins || []);
          for (const ra of relatedAsins) {
            if (!allAsins.has(ra)) {
              allAsins.add(ra);
              newFromCrawl++;
              if (toCrawl.length < 3000 && !crawled.has(ra)) {
                toCrawl.push(ra);
              }
            }
          }
        }

        if (crawlIndex % 50 === 0) {
          report(allAsins, scanned, `${allAsins.size} | 🕷️ ${crawlIndex}/${Math.min(toCrawl.length, maxCrawl)} +${newFromCrawl}`);
        }

        await throttle.parallelWait();
      }

      report(allAsins, scanned, `🕷️ Spider: +${newFromCrawl} yeni ASIN`);
    }

    // ===== PHASE 7: KEYWORD SCAN =====
    if (!stopRequested && !checkLimit()) {
      const kws = getTopKw(keywords, 50);
      if (kws.length > 0) {
        report(allAsins, scanned, `🔤 TURBO FAZ 7: ${kws.length} keyword (paralel)...`);
        const seller = extractSeller(baseUrl);
        const origin = getOrigin(baseUrl);

        for (const kw of kws) {
          if (stopRequested || checkLimit()) break;
          await checkPause();

          const kwUrl = `${origin}/s?k=${encodeURIComponent(kw)}${seller ? '&me=' + seller : ''}`;
          const pageUrls = [];
          for (let p = 1; p <= 8; p++) {
            pageUrls.push(addPage(kwUrl, p));
          }

          const { results } = await fetchPagesParallel(pageUrls);

          for (const r of results) {
            if (stopRequested) break;
            scanned++;
            if (r.captcha) { captchaHits++; continue; }

            let nc = 0;
            r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
            if (nc > 0) {
              report(allAsins, scanned, `${allAsins.size} | KW:"${kw.substring(0,10)}" +${nc}`);
            }
          }
        }
      }
    }

    // ===== FINISH =====
    const duration = Math.round((Date.now() - startTime) / 1000);
    finish(allAsins, scanned, captchaHits, duration);
  }

  // ===== FETCH FUNCTIONS =====
  async function fetchPage(url) {
    try {
      const r = await fetch(url, { credentials: 'include', headers: { 'Accept': 'text/html' } });
      if (!r.ok) { throttle.onError(); return { asins: [], titles: [], brands: [], captcha: false }; }
      const html = await r.text();
      if (!html || html.length < 500) { throttle.onEmpty(); return { asins: [], titles: [], brands: [], captcha: false }; }
      if (html.includes('captcha') || html.includes('robot')) {
        throttle.onCaptcha();
        return { asins: [], titles: [], brands: [], captcha: true };
      }
      const result = { asins: extractAsins(html), titles: extractTitles(html), brands: extractBrands(html), captcha: false };
      if (result.asins.length > 0) throttle.onSuccess(); else throttle.onEmpty();
      return result;
    } catch(e) {
      throttle.onError();
      return { asins: [], titles: [], brands: [], captcha: false };
    }
  }

  async function fetchRelated(asin, origin) {
    const found = new Set();
    try {
      const resp = await fetch(`${origin}/dp/${asin}`, { credentials: 'include' });
      if (!resp.ok) { throttle.onError(); return []; }
      const html = await resp.text();
      if (html.includes('captcha') || html.includes('robot')) {
        throttle.onCaptcha();
        return { asins: [], captcha: true };
      }
      throttle.onSuccess();

      let m;
      for (const p of [/data-asin="([A-Z0-9]{10})"/gi, /\/dp\/([A-Z0-9]{10})/gi, /"asin"\s*:\s*"([A-Z0-9]{10})"/gi]) {
        p.lastIndex = 0;
        while ((m = p.exec(html)) !== null) if (/^[A-Z0-9]{10}$/.test(m[1])) found.add(m[1]);
      }
      found.delete(asin);
    } catch(e) { throttle.onError(); }
    return Array.from(found);
  }

  async function discoverCategories(baseUrl) {
    const cats = [];
    const seen = new Set();
    const seller = extractSeller(baseUrl);
    const queue = [baseUrl];
    let depth = 0;

    while (queue.length > 0 && depth < 2 && cats.length < 50) {
      const url = queue.shift();
      try {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) continue;
        const html = await r.text();

        const p = /href="([^"]*\/s\?[^"]*)"[^>]*>([^<]{2,40})</gi;
        let m;
        while ((m = p.exec(html)) !== null && cats.length < 50) {
          let href = m[1].replace(/&amp;/g, '&');
          const name = m[2].trim();
          if (seen.has(name.toLowerCase()) || name.length < 2) continue;
          if (!href.includes('rh=') && !href.includes('node=')) continue;
          seen.add(name.toLowerCase());
          let fullUrl = href.startsWith('/') ? getOrigin(baseUrl) + href : href;
          if (seller && !fullUrl.includes('me=')) fullUrl += '&me=' + seller;
          cats.push({ name, url: fullUrl });
          if (depth < 1) queue.push(fullUrl);
        }
      } catch(e) {}
      depth++;
      await throttle.wait();
    }
    return cats;
  }

  // ===== EXTRACTION =====
  function extractAsins(html) {
    const f = new Set(); let m;
    for (const p of [/data-asin="([A-Z0-9]{10})"/gi, /\/dp\/([A-Z0-9]{10})/gi, /"asin"\s*:\s*"([A-Z0-9]{10})"/gi]) {
      p.lastIndex = 0; while ((m = p.exec(html)) !== null) if (/^[A-Z0-9]{10}$/.test(m[1])) f.add(m[1]);
    }
    return Array.from(f);
  }

  function extractTitles(html) {
    const t = []; const p = /class="[^"]*a-text-normal[^"]*"[^>]*>([^<]{10,150})</gi; let m;
    while ((m = p.exec(html)) !== null) t.push(m[1].trim());
    return t;
  }

  function extractBrands(html) {
    const b = []; const p = /by\s+<[^>]*>([^<]{2,40})</gi; let m;
    while ((m = p.exec(html)) !== null) { const n = m[1].trim(); if (n.length > 1) b.push(n); }
    return b;
  }

  function extractAsinsFromDOM() {
    const f = new Set();
    document.querySelectorAll('[data-asin]').forEach(e => { const a = (e.getAttribute('data-asin')||'').trim(); if (/^[A-Z0-9]{10}$/.test(a)) f.add(a); });
    return Array.from(f);
  }

  // ===== HELPERS =====
  function harvest(titles, kw, brandArr, brandSet) {
    const stop = new Set(['the','a','an','and','or','for','to','in','on','of','with','by','from','is','it','this','new','set','pack','pcs','size','color']);
    for (const t of titles || []) {
      const ws = t.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w));
      ws.forEach(w => kw[w] = (kw[w]||0) + 1);
      for (let i = 0; i < ws.length - 1; i++) { const ph = ws[i]+' '+ws[i+1]; kw[ph] = (kw[ph]||0) + 1; }
    }
    for (const b of brandArr || []) brandSet.add(b);
  }

  function getTopKw(kw, n) { return Object.entries(kw).filter(([k,v])=>v>=2).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k])=>k); }

  // ===== URL HELPERS =====
  function addPage(u,p){try{const x=new URL(u);x.searchParams.set('page',p);return x.toString();}catch(e){return u+'&page='+p;}}
  function addSort(u,s){try{const x=new URL(u);x.searchParams.set('s',s);return x.toString();}catch(e){return u+'&s='+s;}}
  function addPriceFilter(u,lo,hi){try{const x=new URL(u);x.searchParams.set('low-price',lo);x.searchParams.set('high-price',hi);return x.toString();}catch(e){return u+`&low-price=${lo}&high-price=${hi}`;}}
  function addRating(u,s){try{const x=new URL(u);x.searchParams.set('rh',`p_72:${s}`);return x.toString();}catch(e){return u+'&rh=p_72:'+s;}}
  function addBrand(u,b){try{const x=new URL(u);const rh=x.searchParams.get('rh')||'';x.searchParams.set('rh',rh?rh+',p_89:'+encodeURIComponent(b):'p_89:'+encodeURIComponent(b));return x.toString();}catch(e){return u+'&rh=p_89:'+encodeURIComponent(b);}}
  function getOrigin(u){try{return new URL(u).origin;}catch(e){return '';}}
  function extractSeller(u){const m=u.match(/[?&]me=([^&]+)/);return m?m[1]:null;}
  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

  function report(a,s,st){
    try{
      chrome.runtime.sendMessage({
        action:'progressUpdate',
        asins:a?Array.from(a):[],
        scanned:s,
        status:st
      });
    }catch(e){}
  }

  function finish(a,s,captchas,duration){
    scanning=false;
    disableCloseWarning(); // Pencere kapatma uyarısını kaldır
    const reason=stopRequested?'Durduruldu':'Tamamlandı';
    chrome.runtime.sendMessage({
      action:'scanComplete',
      asins:Array.from(a),
      scanned:s,
      reason,
      captchas:captchas||0,
      duration:duration||0
    });
  }

  function analyzeCurrentPage(){
    const u=location.href;
    return{
      url:u,
      isAmazon:/amazon\.\w+/.test(u),
      pageType:/[?&]me=/.test(u)?'store':'search',
      sellerName:document.querySelector('[class*="store-name"],.stores-header-desktop-text')?.textContent?.trim()||'',
      currentAsins:extractAsinsFromDOM()
    };
  }
})();
