// [LOJA OFICIAL] Utilitário compartilhado — extras dos cards (desconto, brinde, frete grátis)
// Carregado em index.html e product.html antes dos scripts de produto.
(function () {
  var KEY = 'loja-oficial-extras';
  var BRINDES = ['Cupom de 10% na próxima compra', 'Embalagem presente', 'Kit surpresa'];
  var DESCONTOS = [20, 25, 30];

  // Carrega TODOS os extras do localStorage uma única vez no boot
  // Evita leitura de localStorage por card (O(1) em vez de O(n))
  var _cache = {};
  try { _cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { _cache = {}; }

  var _saveTimer = null;

  function getOrCreateCardExtras(productId) {
    var id = String(productId);
    if (_cache[id]) {
      // backfill: entradas antigas podem não ter campos novos
      if (!_cache[id].stock) {
        _cache[id].stock = Math.floor(Math.random() * 50) + 1;
      }
      if (typeof _cache[id].retiradaDisponivel !== 'boolean') {
        _cache[id].retiradaDisponivel = Math.random() < 0.7;
      }
      if (!_cache[id].brinde) {
        _cache[id].brinde = BRINDES[Math.floor(Math.random() * BRINDES.length)];
      }
      if (typeof _cache[id].descontoHoje !== 'number') {
        _cache[id].descontoHoje = DESCONTOS[Math.floor(Math.random() * DESCONTOS.length)];
      }
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(function () {
        try { localStorage.setItem(KEY, JSON.stringify(_cache)); } catch (e) {}
      }, 500);
      return _cache[id];
    }

    _cache[id] = {
      brinde: BRINDES[Math.floor(Math.random() * BRINDES.length)],
      descontoHoje: DESCONTOS[Math.floor(Math.random() * DESCONTOS.length)],
      freteGratis: Math.random() < 0.5,
      retiradaDisponivel: Math.random() < 0.7,
      stock: Math.floor(Math.random() * 50) + 1,
    };

    // Salva em batch com debounce de 500ms para não bloquear o render
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(_cache)); } catch (e) {}
    }, 500);

    return _cache[id];
  }

  window.getOrCreateCardExtras = getOrCreateCardExtras;
})();
