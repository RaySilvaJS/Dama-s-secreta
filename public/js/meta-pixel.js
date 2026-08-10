// ===== META PIXEL — jessi.iphones =====
// Substitua SEU_PIXEL_ID pelo ID do seu Pixel da Meta
// Exemplo: '1234567890123456'

(function () {
  // Evita inicialização duplicada da Google Tag no mesmo documento.
  if (!window.__GOOGLE_TAG_INITIALIZED__) {
    window.__GOOGLE_TAG_INITIALIZED__ = true;

    var GOOGLE_ADS_ID = 'AW-18381740709';
    var gtagScript = document.createElement('script');
    gtagScript.async = true;
    gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GOOGLE_ADS_ID;
    document.head.appendChild(gtagScript);

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () {
      window.dataLayer.push(arguments);
    };

    gtag('js', new Date());
    gtag('config', GOOGLE_ADS_ID);

    console.log('[Google Tag] Inicializada:', GOOGLE_ADS_ID);
  }

  window.GoogleAds = window.GoogleAds || {
    purchaseConversion: function (data) {
      if (typeof gtag !== 'function') return;
      var transactionId = String((data && data.transactionId) || '').trim();
      if (!transactionId) return;
      var key = 'google-ads-purchase-' + transactionId;
      if (localStorage.getItem(key)) {
        console.log('[Google Ads] Conversao ja disparada:', transactionId);
        return;
      }
      localStorage.setItem(key, '1');

      var payload = {
        send_to: 'AW-18381740709/MSweCMfyvN8cEKW1jL1E',
        value: Number(data && data.value) || 0,
        currency: (data && data.currency) || 'BRL',
        transaction_id: transactionId
      };

      if (typeof data.newCustomer === 'boolean') {
        payload.new_customer = data.newCustomer;
      }

      gtag('event', 'conversion', payload);
      console.log('[Google Ads] Conversion:', payload);
    }
  };

  // Evita inicialização duplicada do Pixel no mesmo documento.
  if (window.__META_PIXEL_INITIALIZED__) return;
  window.__META_PIXEL_INITIALIZED__ = true;

  var PIXEL_ID = '1039902935388587';

  !function(f,b,e,v,n,t,s){
    if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)
  }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  console.log('[Meta Pixel] PageView —', window.location.pathname);

  // Removido fallback

  // ===== API PÚBLICA =====
  window.MetaPixel = {

    viewContent: function (data) {
      if (typeof fbq !== 'function') return;
      var payload = {
        content_name: data.name,
        content_ids:  [String(data.id)],
        content_type: 'product',
        value:        Number(data.value) || 0,
        currency:     'BRL'
      };
      fbq('track', 'ViewContent', payload);
      console.log('[Meta Pixel] ViewContent:', payload);
    },

    addToCart: function (data) {
      if (typeof fbq !== 'function') return;
      var payload = {
        content_name: data.name,
        content_ids:  [String(data.id)],
        content_type: 'product',
        value:        Number(data.value) || 0,
        currency:     'BRL'
      };
      fbq('track', 'AddToCart', payload);
      console.log('[Meta Pixel] AddToCart:', payload);
    },

    initiateCheckout: function (data) {
      if (typeof fbq !== 'function') return;
      var payload = {
        value:        Number(data.value) || 0,
        currency:     'BRL',
        content_ids:  data.ids || [],
        content_type: 'product',
        num_items:    data.numItems || 1
      };
      fbq('track', 'InitiateCheckout', payload);
      console.log('[Meta Pixel] InitiateCheckout:', payload);
    },

    purchase: function (data) {
      if (typeof fbq !== 'function') return;
      var key = 'fbq-purchase-' + data.orderId;
      if (localStorage.getItem(key)) {
        console.log('[Meta Pixel] Purchase já disparado — pedido:', data.orderId);
        return;
      }
      localStorage.setItem(key, '1');
      var payload = {
        value:        Number(data.value) || 0,
        currency:     'BRL',
        content_ids:  data.ids || [],
        content_type: 'product',
        num_items:    data.numItems || 1
      };
      fbq('track', 'Purchase', payload);
      console.log('[Meta Pixel] Purchase:', payload);
    },

    completeRegistration: function () {
      if (typeof fbq !== 'function') return;
      fbq('track', 'CompleteRegistration', { currency: 'BRL', status: true });
      console.log('[Meta Pixel] CompleteRegistration');
    },

    lead: function (data) {
      if (typeof fbq !== 'function') return;
      var payload = {
        content_name: data && data.productName ? data.productName : 'Produto',
        value:        Number(data && data.value) || 0,
        currency:     'BRL'
      };
      fbq('track', 'Lead', payload);
      console.log('[Meta Pixel] Lead:', payload);
    }

  };

})();
