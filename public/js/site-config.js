(function () {
  var DEFAULT_NAME = "DAMA'S SECRETA";
  var DEFAULTS = {
    siteName: DEFAULT_NAME,
    whatsappNumber: '5521988631029',
    instagramUrl: 'https://www.instagram.com/luar.seducao/',
    logoUrl: ''
  };

  function applyLogo(cfg) {
    var els = document.querySelectorAll('.logo, .site-logo, .pay-logo, .footer-brand h2, .brand');
    els.forEach(function (el) {
      if (cfg.logoUrl) {
        el.innerHTML = '';
        var img = document.createElement('img');
        img.src = cfg.logoUrl;
        img.alt = cfg.siteName;
        img.className = 'site-logo-img';
        var fontSize = parseFloat(getComputedStyle(el).fontSize) || 20;
        var h = Math.round(fontSize * 2.2);
        img.style.height = h + 'px';
        img.style.width = 'auto';
        img.style.maxWidth = '260px';
        img.style.objectFit = 'contain';
        img.style.verticalAlign = 'middle';
        el.appendChild(img);
      } else if (cfg.siteName !== DEFAULT_NAME) {
        var parts = cfg.siteName.trim().split(/\s+/);
        var last = parts.pop();
        el.innerHTML = (parts.length ? parts.join(' ') + ' ' : '') + '<span>' + last + '</span>';
      }
    });
  }

  function applyWhatsApp(cfg) {
    var defaultTextName = DEFAULT_NAME.replace(/ /g, '+');
    var newTextName = cfg.siteName.replace(/ /g, '+');
    document.querySelectorAll('a[href*="wa.me/"]').forEach(function (a) {
      var href = a.getAttribute('href');
      href = href.replace(/wa\.me\/\d+/, 'wa.me/' + cfg.whatsappNumber);
      if (defaultTextName !== newTextName) {
        href = href.split(defaultTextName).join(newTextName);
      }
      a.setAttribute('href', href);
    });
  }

  function applyInstagram(cfg) {
    if (!cfg.instagramUrl) return;
    document.querySelectorAll('a[href*="instagram.com/"]').forEach(function (a) {
      a.setAttribute('href', cfg.instagramUrl);
    });
  }

  function applyTextAndMeta(cfg) {
    if (cfg.siteName === DEFAULT_NAME) return;

    document.title = document.title.split(DEFAULT_NAME).join(cfg.siteName);

    document.querySelectorAll('meta[property^="og:"], meta[name="description"]').forEach(function (m) {
      var content = m.getAttribute('content');
      if (content && content.indexOf(DEFAULT_NAME) !== -1) {
        m.setAttribute('content', content.split(DEFAULT_NAME).join(cfg.siteName));
      }
    });

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      if (node.nodeValue.indexOf(DEFAULT_NAME) !== -1) {
        node.nodeValue = node.nodeValue.split(DEFAULT_NAME).join(cfg.siteName);
      }
    });
  }

  function applyConfig(cfg) {
    applyLogo(cfg);
    applyWhatsApp(cfg);
    applyInstagram(cfg);
    applyTextAndMeta(cfg);
    window.__siteConfig = cfg;
  }

  fetch('/api/site-config')
    .then(function (r) { return r.ok ? r.json() : DEFAULTS; })
    .catch(function () { return DEFAULTS; })
    .then(function (cfg) {
      applyConfig(Object.assign({}, DEFAULTS, cfg));
    });
})();
