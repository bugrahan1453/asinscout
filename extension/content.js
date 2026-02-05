// ASIN Scout Pro v11 - MAXIMUM EXTRACTION
// HER ŞEYİ SONUNA KADAR ZORLA - 100K+ HEDEF
(function() {
  'use strict';
  if (window.__asinScoutV11) return;
  window.__asinScoutV11 = true;

  let scanning = false, stopRequested = false;
  const SORTS = ['', 'price-asc-rank', 'price-desc-rank', 'review-rank', 'date-desc-rank'];

  // Adaptive throttle controller - starts fast, backs off on captcha
  const throttle = {
    delay: 50,
    min: 30,
    max: 3000,
    successes: 0,
    captchas: 0,
    onSuccess() {
      this.successes++;
      this.captchas = 0;
      if (this.successes > 3) this.delay = Math.max(this.min, this.delay * 0.85);
    },
    onCaptcha() {
      this.captchas++;
      this.successes = 0;
      this.delay = Math.min(this.max, this.delay * 3);
    },
    onEmpty() {
      this.delay = Math.min(this.max, this.delay * 1.15);
    },
    async wait() { await sleep(this.delay); },
    reset() { this.delay = 50; this.successes = 0; this.captchas = 0; }
  };

  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (msg.action === 'getPageInfo') { send(analyzeCurrentPage()); }
    else if (msg.action === 'scanThisPage') { send({ asins: extractAsinsFromDOM() }); }
    else if (msg.action === 'startFetchScan') {
      scanning = true; stopRequested = false;
      runMaxScan(msg.baseUrl, msg.mode, msg.scanLimit || 999999);
      send({ ok: true });
    }
    else if (msg.action === 'stopFetchScan') { stopRequested = true; scanning = false; send({ ok: true }); }
    return true;
  });

  async function runMaxScan(baseUrl, mode, scanLimit) {
    const allAsins = new Set();
    let scanned = 0;
    const keywords = {};
    const brands = new Set();
    let captchaHits = 0;
    throttle.reset();

    // Limit kontrolü fonksiyonu
    function checkLimit() {
      if (allAsins.size >= scanLimit) {
        report(allAsins, scanned, `✅ Limite ulaşıldı: ${scanLimit} ASIN`);
        stopRequested = true;
        return true;
      }
      return false;
    }

    if (mode === 'single') {
      for (let p = 1; p <= 30 && !stopRequested; p++) {
        const r = await fetchPage(addPage(baseUrl, p));
        scanned++;
        if (r.captcha) { captchaHits++; report(allAsins, scanned, `⚠️ Captcha! Waiting... (${captchaHits}x)`); await sleep(throttle.delay); continue; }
        r.asins.forEach(a => allAsins.add(a));
        report(allAsins, scanned, `${allAsins.size} ASIN | s.${p}`);
        if (checkLimit()) break;
        if (r.asins.length < 3) break;
        await throttle.wait();
      }
      finish(allAsins, scanned);
      return;
    }

    // ============================================
    // FAZ 1: TEMEL TARAMA (Sort varyasyonları)
    // ============================================
    report(allAsins, scanned, `🚀 FAZ 1: Sort varyasyonları...`);
    for (const sort of SORTS) {
      if (stopRequested || checkLimit()) break;
      const url = sort ? addSort(baseUrl, sort) : baseUrl;
      let emptyStreak = 0;
      for (let p = 1; p <= 25 && !stopRequested; p++) {
        const r = await fetchPage(addPage(url, p));
        scanned++;
        if (r.captcha) { captchaHits++; report(allAsins, scanned, `⚠️ Captcha! Auto-recovering... (${Math.round(throttle.delay)}ms)`); await sleep(throttle.delay); continue; }
        harvest(r.titles, keywords, r.brands, brands);
        let nc = 0;
        r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
        if (nc === 0) emptyStreak++; else emptyStreak = 0;
        if (p % 5 === 1) report(allAsins, scanned, `${allAsins.size} | Sort:${sort||'def'} s.${p} +${nc}`);
        if (checkLimit()) break;
        if (r.asins.length < 2 && p > 8) break;
        if (emptyStreak > 3) break;
        await throttle.wait();
      }
    }

    // ============================================
    // FAZ 2: FULL FİYAT TARAMA ($0 - $10,000+)
    // Akıllı adım: Düşük fiyatta ince, yüksekte geniş
    // ============================================
    report(allAsins, scanned, `💰 FAZ 2: Full fiyat tarama ($0-$10K+)...`);

    // Helper: scan a price range with adaptive throttling + captcha recovery
    async function scanPriceRange(ranges, step, maxPages, label) {
      let emptyRanges = 0;
      for (const [lo, hi] of ranges) {
        if (stopRequested || checkLimit()) break;
        if (emptyRanges > 15) break; // Skip if too many empty ranges in a row
        const url = addPriceFilter(baseUrl, lo, hi);
        let rangeNew = 0;
        for (let p = 1; p <= maxPages && !stopRequested; p++) {
          const r = await fetchPage(addPage(url, p));
          scanned++;
          if (r.captcha) { captchaHits++; report(allAsins, scanned, `⚠️ Captcha! Auto-recovering... (${Math.round(throttle.delay)}ms)`); await sleep(throttle.delay); continue; }
          let nc = 0;
          r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; rangeNew++; } });
          if (nc > 0) report(allAsins, scanned, `${allAsins.size} | $${lo}${hi < 1000 ? '-$' + hi : '-$' + hi} s.${p} +${nc}`);
          if (checkLimit()) break;
          if (r.asins.length < 2) break;
          await throttle.wait();
        }
        if (rangeNew === 0) emptyRanges++; else emptyRanges = 0;
      }
    }

    // Build price ranges
    const pr1 = []; for (let lo = 0; lo < 50; lo += 0.25) pr1.push([lo, lo + 0.25]);
    const pr2 = []; for (let lo = 50; lo < 200; lo += 0.5) pr2.push([lo, lo + 0.5]);
    const pr3 = []; for (let lo = 200; lo < 500; lo += 1) pr3.push([lo, lo + 1]);
    const pr4 = []; for (let lo = 500; lo < 1000; lo += 2) pr4.push([lo, lo + 2]);
    const pr5 = []; for (let lo = 1000; lo < 5000; lo += 10) pr5.push([lo, lo + 10]);
    const pr6 = []; for (let lo = 5000; lo < 50000; lo += 100) pr6.push([lo, lo + 100]);

    await scanPriceRange(pr1, 0.25, 10, '$0-$50');
    await scanPriceRange(pr2, 0.5, 8, '$50-$200');
    await scanPriceRange(pr3, 1, 6, '$200-$500');
    await scanPriceRange(pr4, 2, 5, '$500-$1K');
    await scanPriceRange(pr5, 10, 4, '$1K-$5K');
    await scanPriceRange(pr6, 100, 3, '$5K-$50K');
    // ============================================
    // FAZ 3: KATEGORİ × FİYAT × SORT (Üçlü Kombo)
    // ============================================
    if (checkLimit()) { finish(allAsins, scanned, captchaHits); return; }
    report(allAsins, scanned, `📂 FAZ 3: Kategori keşfi...`);
    const cats = await discoverCategories(baseUrl);
    report(allAsins, scanned, `📂 ${cats.length} kategori bulundu`);

    const priceRanges = [[0,5],[5,10],[10,20],[20,35],[35,50],[50,75],[75,100],[100,200],[200,500],[500,2000]];

    for (const cat of cats) {
      if (stopRequested || checkLimit()) break;

      // Önce kategorinin kendisi
      for (const sort of SORTS.slice(0, 3)) {
        if (stopRequested) break;
        const url = sort ? addSort(cat.url, sort) : cat.url;
        let emptyStreak = 0;
        for (let p = 1; p <= 20 && !stopRequested; p++) {
          const r = await fetchPage(addPage(url, p));
          scanned++;
          if (r.captcha) { captchaHits++; report(allAsins, scanned, `⚠️ Captcha! Auto-recovering... (${Math.round(throttle.delay)}ms)`); await sleep(throttle.delay); continue; }
          harvest(r.titles, keywords, r.brands, brands);
          let nc = 0;
          r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
          if (nc === 0) emptyStreak++; else emptyStreak = 0;
          if (nc > 0) report(allAsins, scanned, `${allAsins.size} | ${cat.name.substring(0,15)} ${sort||'def'} s.${p} +${nc}`);
          if (r.asins.length < 2 && p > 3) break;
          if (emptyStreak > 3) break;
          await throttle.wait();
        }
      }

      // Kategori × Fiyat
      for (const [lo, hi] of priceRanges) {
        if (stopRequested) break;
        const url = addPriceFilter(cat.url, lo, hi);
        for (let p = 1; p <= 10 && !stopRequested; p++) {
          const r = await fetchPage(addPage(url, p));
          scanned++;
          if (r.captcha) { captchaHits++; await sleep(throttle.delay); continue; }
          let nc = 0;
          r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
          if (nc > 0) report(allAsins, scanned, `${allAsins.size} | ${cat.name.substring(0,12)} $${lo}-${hi} +${nc}`);
          if (r.asins.length < 2) break;
          await throttle.wait();
        }
      }
    }

    // ============================================
    // FAZ 4: MARKA BAZLI TARAMA
    // ============================================
    if (!stopRequested && !checkLimit() && brands.size > 0) {
      const brandList = Array.from(brands).slice(0, 50);
      report(allAsins, scanned, `🏷️ FAZ 4: ${brandList.length} marka taranıyor...`);

      for (const brand of brandList) {
        if (stopRequested || checkLimit()) break;
        const brandUrl = addBrand(baseUrl, brand);

        for (const sort of SORTS.slice(0, 2)) {
          if (stopRequested) break;
          const url = sort ? addSort(brandUrl, sort) : brandUrl;
          let emptyStreak = 0;
          for (let p = 1; p <= 15 && !stopRequested; p++) {
            const r = await fetchPage(addPage(url, p));
            scanned++;
            if (r.captcha) { captchaHits++; report(allAsins, scanned, `⚠️ Captcha! Auto-recovering...`); await sleep(throttle.delay); continue; }
            let nc = 0;
            r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
            if (nc === 0) emptyStreak++; else emptyStreak = 0;
            if (nc > 0) report(allAsins, scanned, `${allAsins.size} | Marka:${brand.substring(0,12)} +${nc}`);
            if (r.asins.length < 2 && p > 2) break;
            if (emptyStreak > 2) break;
            await throttle.wait();
          }
        }
      }
    }

    // ============================================
    // FAZ 5: RATING + REVIEW COUNT
    // ============================================
    if (checkLimit()) { finish(allAsins, scanned, captchaHits); return; }
    report(allAsins, scanned, `⭐ FAZ 5: Rating & Review filtreleri...`);

    for (const stars of ['4', '3', '2', '1']) {
      if (stopRequested || checkLimit()) break;

      for (const sort of SORTS.slice(0, 3)) {
        if (stopRequested) break;
        let url = addRating(baseUrl, stars);
        if (sort) url = addSort(url, sort);
        let emptyStreak = 0;

        for (let p = 1; p <= 20 && !stopRequested; p++) {
          const r = await fetchPage(addPage(url, p));
          scanned++;
          if (r.captcha) { captchaHits++; report(allAsins, scanned, `⚠️ Captcha! Auto-recovering...`); await sleep(throttle.delay); continue; }
          let nc = 0;
          r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
          if (nc === 0) emptyStreak++; else emptyStreak = 0;
          if (nc > 0) report(allAsins, scanned, `${allAsins.size} | ${stars}★+ ${sort||'def'} +${nc}`);
          if (r.asins.length < 2 && p > 5) break;
          if (emptyStreak > 3) break;
          await throttle.wait();
        }
      }
    }

    // ============================================
    // FAZ 6: MEGA SPIDER CRAWL (3000+ ASIN)
    // ============================================
    if (checkLimit()) { finish(allAsins, scanned, captchaHits); return; }
    const phase5Count = allAsins.size;
    report(allAsins, scanned, `🕷️ FAZ 6: MEGA Spider Crawl başlıyor...`);

    const crawled = new Set();
    const toCrawl = Array.from(allAsins);
    let crawlIndex = 0;
    let newFromCrawl = 0;
    const maxCrawl = 3500;

    while (crawlIndex < Math.min(toCrawl.length, maxCrawl) && !stopRequested && !checkLimit()) {
      const asin = toCrawl[crawlIndex++];
      if (crawled.has(asin)) continue;
      crawled.add(asin);

      const related = await fetchRelated(asin, getOrigin(baseUrl));
      scanned++;

      // Handle captcha from spider
      if (related && related.captcha) {
        captchaHits++;
        report(allAsins, scanned, `⚠️ Spider captcha! Waiting... (${Math.round(throttle.delay)}ms)`);
        await sleep(throttle.delay);
        continue;
      }

      const relatedAsins = Array.isArray(related) ? related : (related?.asins || []);
      let nc = 0;
      for (const ra of relatedAsins) {
        if (!allAsins.has(ra)) {
          allAsins.add(ra);
          nc++;
          newFromCrawl++;
          if (toCrawl.length < 5000 && !crawled.has(ra)) {
            toCrawl.push(ra);
          }
        }
      }

      if (crawlIndex % 50 === 0) {
        report(allAsins, scanned, `${allAsins.size} | 🕷️ ${crawlIndex}/${Math.min(toCrawl.length, maxCrawl)} +${newFromCrawl} yeni`);
      }

      await throttle.wait();
    }
    
    report(allAsins, scanned, `🕷️ Spider bitti: +${newFromCrawl} yeni (${phase5Count} → ${allAsins.size})`);

    // ============================================
    // FAZ 7: KEYWORDS (genişletilmiş)
    // ============================================
    if (checkLimit()) { finish(allAsins, scanned, captchaHits); return; }
    const kws = getTopKw(keywords, 100);
    if (kws.length > 0 && !stopRequested) {
      report(allAsins, scanned, `🔤 FAZ 7: ${kws.length} keyword...`);
      const seller = extractSeller(baseUrl);
      const origin = getOrigin(baseUrl);

      for (const kw of kws) {
        if (stopRequested || checkLimit()) break;
        const kwUrl = `${origin}/s?k=${encodeURIComponent(kw)}${seller ? '&me=' + seller : ''}`;

        for (const sort of SORTS.slice(0, 2)) {
          if (stopRequested) break;
          const url = sort ? addSort(kwUrl, sort) : kwUrl;
          let emptyStreak = 0;
          for (let p = 1; p <= 10 && !stopRequested; p++) {
            const r = await fetchPage(addPage(url, p));
            scanned++;
            if (r.captcha) { captchaHits++; report(allAsins, scanned, `⚠️ Captcha! Auto-recovering...`); await sleep(throttle.delay); continue; }
            let nc = 0;
            r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
            if (nc === 0) emptyStreak++; else emptyStreak = 0;
            if (nc > 0) report(allAsins, scanned, `${allAsins.size} | KW:"${kw.substring(0,10)}" +${nc}`);
            if (r.asins.length < 2 && p > 2) break;
            if (emptyStreak > 2) break;
            await throttle.wait();
          }
        }
      }
    }

    // ============================================
    // FAZ 8: DEAL/DISCOUNT FİLTRESİ
    // ============================================
    if (!stopRequested && !checkLimit()) {
      report(allAsins, scanned, `🏷️ FAZ 8: Deal/Discount filtreleri...`);
      
      const dealFilters = [
        'p_n_deal_type:23566065011', // Today's Deals
        'p_n_deal_type:23566064011', // Lightning Deals
        'p_85:2470955011', // Prime
        'p_n_availability:1', // In Stock
        'p_n_condition-type:6461716011', // New
        'p_n_condition-type:6461718011', // Used
      ];
      
      for (const filter of dealFilters) {
        if (stopRequested) break;
        const url = addRhFilter(baseUrl, filter);
        let emptyStreak = 0;

        for (let p = 1; p <= 15 && !stopRequested; p++) {
          const r = await fetchPage(addPage(url, p));
          scanned++;
          if (r.captcha) { captchaHits++; report(allAsins, scanned, `⚠️ Captcha! Auto-recovering...`); await sleep(throttle.delay); continue; }
          let nc = 0;
          r.asins.forEach(a => { if (!allAsins.has(a)) { allAsins.add(a); nc++; } });
          if (nc === 0) emptyStreak++; else emptyStreak = 0;
          if (nc > 0) report(allAsins, scanned, `${allAsins.size} | Filter s.${p} +${nc}`);
          if (r.asins.length < 2 && p > 3) break;
          if (emptyStreak > 3) break;
          await throttle.wait();
        }
      }
    }

    finish(allAsins, scanned, captchaHits);
  }

  // ===== SPIDER CRAWL =====
  async function fetchRelated(asin, origin) {
    const found = new Set();
    try {
      const resp = await fetch(`${origin}/dp/${asin}`, { credentials: 'include' });
      if (!resp.ok) { throttle.onEmpty(); return []; }
      const html = await resp.text();
      if (html.includes('captcha')) { throttle.onCaptcha(); return { asins: [], captcha: true }; }
      throttle.onSuccess();

      let m;
      for (const p of [/data-asin="([A-Z0-9]{10})"/gi, /\/dp\/([A-Z0-9]{10})/gi, /"asin"\s*:\s*"([A-Z0-9]{10})"/gi]) {
        p.lastIndex = 0;
        while ((m = p.exec(html)) !== null) if (/^[A-Z0-9]{10}$/.test(m[1])) found.add(m[1]);
      }
      found.delete(asin);
    } catch(e) { throttle.onEmpty(); }
    return Array.from(found);
  }

  // ===== KATEGORİ KEŞFİ =====
  async function discoverCategories(baseUrl) {
    const cats = [];
    const seen = new Set();
    const seller = extractSeller(baseUrl);
    
    // 2 seviye recursive
    const queue = [baseUrl];
    let depth = 0;
    
    while (queue.length > 0 && depth < 2 && cats.length < 80) {
      const url = queue.shift();
      const html = await fetchRaw(url);
      if (!html) continue;
      
      const p = /href="([^"]*\/s\?[^"]*)"[^>]*>([^<]{2,40})</gi;
      let m;
      while ((m = p.exec(html)) !== null && cats.length < 80) {
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
      depth++;
      await throttle.wait();
    }
    return cats;
  }

  // ===== FETCH =====
  async function fetchPage(url) {
    try {
      const r = await fetch(url, { credentials: 'include', headers: { 'Accept': 'text/html' } });
      if (!r.ok) { throttle.onEmpty(); return { asins: [], titles: [], brands: [], captcha: false }; }
      const html = await r.text();
      if (!html || html.length < 500) { throttle.onEmpty(); return { asins: [], titles: [], brands: [], captcha: false }; }
      if (html.includes('captcha')) { throttle.onCaptcha(); return { asins: [], titles: [], brands: [], captcha: true }; }
      const result = { asins: extractAsins(html), titles: extractTitles(html), brands: extractBrands(html), captcha: false };
      if (result.asins.length > 0) throttle.onSuccess(); else throttle.onEmpty();
      return result;
    } catch(e) { throttle.onEmpty(); return { asins: [], titles: [], brands: [], captcha: false }; }
  }

  // Fetch multiple pages concurrently (2 at a time)
  async function fetchPages(urls) {
    const results = [];
    for (let i = 0; i < urls.length && !stopRequested; i += 2) {
      const batch = urls.slice(i, Math.min(i + 2, urls.length));
      const br = await Promise.all(batch.map(u => fetchPage(u)));
      results.push(...br);
      if (br.some(r => r.captcha)) {
        report(null, 0, `⚠️ Captcha detected! Slowing down... (${Math.round(throttle.delay)}ms)`);
        await sleep(throttle.delay);
      } else {
        await throttle.wait();
      }
    }
    return results;
  }

  async function fetchRaw(url) {
    try { const r = await fetch(url, { credentials: 'include' }); return r.ok ? await r.text() : ''; } catch(e) { return ''; }
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

  // ===== KEYWORD/BRAND HARVEST =====
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
  function addRhFilter(u,f){try{const x=new URL(u);const rh=x.searchParams.get('rh')||'';x.searchParams.set('rh',rh?rh+','+f:f);return x.toString();}catch(e){return u+'&rh='+f;}}
  function getOrigin(u){try{return new URL(u).origin;}catch(e){return '';}}
  function extractSeller(u){const m=u.match(/[?&]me=([^&]+)/);return m?m[1]:null;}
  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
  function report(a,s,st){try{chrome.runtime.sendMessage({action:'progressUpdate',asins:a?Array.from(a):[],scanned:s,status:st});}catch(e){}}
  function finish(a,s,captchas){scanning=false;const reason=stopRequested?'Durduruldu':'Tamamlandı';chrome.runtime.sendMessage({action:'scanComplete',asins:Array.from(a),scanned:s,reason,captchas:captchas||0});}

  function analyzeCurrentPage(){
    const u=location.href;
    return{url:u,isAmazon:/amazon\.\w+/.test(u),pageType:/[?&]me=/.test(u)?'store':'search',
      sellerName:document.querySelector('[class*="store-name"],.stores-header-desktop-text')?.textContent?.trim()||'',
      currentAsins:extractAsinsFromDOM()};
  }
})();
