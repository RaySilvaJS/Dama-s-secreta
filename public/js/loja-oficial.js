// [LOJA OFICIAL] Utilitário compartilhado — extras dos cards (desconto, brinde, frete grátis)
// Carregado em index.html e product.html antes dos scripts de produto.
(function () {
  var KEY = 'loja-oficial-extras';

  // Extras de marketing falsos foram removidos do site.
  // O utilitário continua existindo para manter compatibilidade,
  // mas agora sempre retorna valores neutros e sem brindes.
  var _cache = {};
  try { _cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { _cache = {}; }

  var _saveTimer = null;

  function getOrCreateCardExtras(productId) {
    var id = String(productId);
    var base = {
      brinde: null,
      descontoHoje: 0,
      freteGratis: false,
      retiradaDisponivel: false,
      stock: Math.floor(Math.random() * 50) + 1,
    };

    if (_cache[id]) {
      _cache[id] = Object.assign({}, base, _cache[id], {
        brinde: null,
        descontoHoje: 0,
        freteGratis: false,
        retiradaDisponivel: false,
      });
    } else {
      _cache[id] = base;
    }

    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(_cache)); } catch (e) {}
    }, 500);

    return _cache[id];
  }

  window.getOrCreateCardExtras = getOrCreateCardExtras;
})();
