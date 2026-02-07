// ASIN Scout - Website Integration
// Bu script asinscout.com'da calisir ve SR yuklemesi icin kopru gorevi gorur

(function() {
  'use strict';

  // Website'den gelen "SR Yukle" isteklerini dinle
  window.addEventListener('asinscout-sr-load', async (e) => {
    const { asins, storeName, scanId } = e.detail;

    if (!asins || asins.length === 0) {
      console.log('ASIN Scout: No ASINs to load');
      return;
    }

    // ASIN'leri chrome.storage'a kaydet
    chrome.storage.local.set({
      pendingAsins: asins,
      pendingStoreName: storeName || 'Scan #' + scanId,
      pendingTimestamp: Date.now()
    }, () => {
      console.log('ASIN Scout: ' + asins.length + ' ASINs saved for SR');

      // Seller Running sayfasini ac
      window.open('https://sellerrunning.threecolts.com/inventory/add', '_blank');
    });
  });

  // Extension yuklu oldugunu website'e bildir
  document.documentElement.setAttribute('data-asinscout-extension', 'true');

  console.log('ASIN Scout: Website integration loaded');
})();
