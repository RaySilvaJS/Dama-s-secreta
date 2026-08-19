// Seletor de endereço de entrega na home — clique em "Envio para todo o Brasil"
// abre um modal com CEP (autofill via ViaCEP, mesma API do checkout) ou
// geolocalização do navegador (reverse geocoding via Nominatim/OpenStreetMap).
// Guest: salva só em localStorage. Logado: também salva na conta (/api/auth/addresses).
(function () {
  var STORAGE_KEY = 'guest-address';

  var UF_BY_STATE_NAME = {
    'acre': 'AC', 'alagoas': 'AL', 'amapá': 'AP', 'amapa': 'AP', 'amazonas': 'AM',
    'bahia': 'BA', 'ceará': 'CE', 'ceara': 'CE', 'distrito federal': 'DF',
    'espírito santo': 'ES', 'espirito santo': 'ES', 'goiás': 'GO', 'goias': 'GO',
    'maranhão': 'MA', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'minas gerais': 'MG', 'pará': 'PA', 'para': 'PA', 'paraíba': 'PB', 'paraiba': 'PB',
    'paraná': 'PR', 'parana': 'PR', 'pernambuco': 'PE', 'piauí': 'PI', 'piaui': 'PI',
    'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS',
    'rondônia': 'RO', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
    'são paulo': 'SP', 'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
  };

  var elRow      = document.getElementById('location-row');
  var elRowText  = document.getElementById('location-row-text');
  var overlay    = document.getElementById('addr-modal-overlay');
  var closeBtn   = document.getElementById('addr-modal-close');
  var geolocBtn  = document.getElementById('addr-geoloc-btn');
  var saveBtn    = document.getElementById('addr-modal-save');
  var errEl      = document.getElementById('addr-modal-error');

  var fCep   = document.getElementById('am-cep');
  var fRua   = document.getElementById('am-rua');
  var fNum   = document.getElementById('am-numero');
  var fComp  = document.getElementById('am-complemento');
  var fBairro= document.getElementById('am-bairro');
  var fCidade= document.getElementById('am-cidade');
  var fEstado= document.getElementById('am-estado');

  if (!elRow || !overlay) return;

  function showErr(msg) {
    errEl.textContent = msg;
    errEl.classList.add('visible');
  }
  function hideErr() {
    errEl.classList.remove('visible');
  }

  function formatSummary(addr) {
    if (!addr) return 'Envio para todo o Brasil';
    var parts = [];
    if (addr.rua) parts.push(addr.rua + (addr.numero ? ', ' + addr.numero : ''));
    if (addr.bairro) parts.push(addr.bairro);
    if (addr.cidade) parts.push(addr.cidade + (addr.estado ? '/' + addr.estado : ''));
    return parts.length ? 'Enviar para ' + parts.join(' - ') : 'Envio para todo o Brasil';
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function render() {
    elRowText.textContent = formatSummary(loadSaved());
  }
  render();

  function openModal() {
    var saved = loadSaved();
    if (saved) {
      fCep.value = saved.cep || '';
      fRua.value = saved.rua || '';
      fNum.value = saved.numero || '';
      fComp.value = saved.complemento || '';
      fBairro.value = saved.bairro || '';
      fCidade.value = saved.cidade || '';
      fEstado.value = saved.estado || '';
    }
    hideErr();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  elRow.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

  // ── Autofill por CEP (ViaCEP — mesma API usada no checkout) ────────────────
  var cepCache = {};
  function setAutoField(el, value) {
    el.value = value || '';
    el.readOnly = !!value;
    el.placeholder = value ? '' : 'Digite manualmente';
  }

  fCep.addEventListener('input', function () {
    var v = fCep.value.replace(/\D/g, '');
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5, 8);
    fCep.value = v;

    var digits = v.replace(/\D/g, '');
    if (digits.length < 8) return;

    hideErr();
    if (cepCache[digits]) return applyCepData(cepCache[digits]);

    fetch('https://viacep.com.br/ws/' + digits + '/json/')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.erro) { showErr('CEP não encontrado.'); return; }
        cepCache[digits] = d;
        applyCepData(d);
      })
      .catch(function () { showErr('Não foi possível consultar o CEP agora.'); });
  });

  function applyCepData(d) {
    setAutoField(fRua, d.logradouro);
    setAutoField(fBairro, d.bairro);
    fCidade.value = d.localidade || '';
    fEstado.value = d.uf || '';
    fCidade.readOnly = true;
    fEstado.readOnly = true;
    if (!d.logradouro) fRua.focus(); else fNum.focus();
  }

  // ── Geolocalização (navigator.geolocation + reverse geocoding Nominatim) ───
  geolocBtn.addEventListener('click', function () {
    hideErr();
    if (!navigator.geolocation) {
      showErr('Seu navegador não suporta geolocalização.');
      return;
    }
    geolocBtn.disabled = true;
    var originalText = geolocBtn.innerHTML;
    geolocBtn.innerHTML = 'Obtendo localização...';

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lat = pos.coords.latitude;
        var lon = pos.coords.longitude;
        fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lon + '&addressdetails=1&accept-language=pt-BR')
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var a = d.address || {};
            var rua = a.road || a.pedestrian || a.residential || '';
            var bairro = a.suburb || a.neighbourhood || a.city_district || '';
            var cidade = a.city || a.town || a.village || a.municipality || '';
            var estadoNome = (a.state || '').toLowerCase();
            var estado = UF_BY_STATE_NAME[estadoNome] || '';
            var cep = (a.postcode || '').replace(/\D/g, '');
            if (cep.length === 8) cep = cep.slice(0, 5) + '-' + cep.slice(5);

            fCep.value = cep;
            setAutoField(fRua, rua);
            setAutoField(fBairro, bairro);
            fCidade.value = cidade;
            fEstado.value = estado;
            fCidade.readOnly = true;
            fEstado.readOnly = true;

            if (!rua && !cidade) showErr('Não conseguimos identificar seu endereço exato. Preencha manualmente.');
            else fNum.focus();
          })
          .catch(function () { showErr('Não foi possível identificar seu endereço. Tente digitar o CEP.'); })
          .finally(function () {
            geolocBtn.disabled = false;
            geolocBtn.innerHTML = originalText;
          });
      },
      function () {
        showErr('Não conseguimos acessar sua localização. Verifique a permissão do navegador ou digite o CEP.');
        geolocBtn.disabled = false;
        geolocBtn.innerHTML = originalText;
      },
      { timeout: 10000 }
    );
  });

  // ── Salvar ───────────────────────────────────────────────────────────────
  saveBtn.addEventListener('click', function () {
    hideErr();
    var addr = {
      cep: fCep.value.replace(/\D/g, ''),
      rua: fRua.value.trim(),
      numero: fNum.value.trim(),
      complemento: fComp.value.trim(),
      bairro: fBairro.value.trim(),
      cidade: fCidade.value.trim(),
      estado: fEstado.value.trim(),
    };

    if (!addr.cep || addr.cep.length < 8) { showErr('Informe um CEP válido.'); return; }
    if (!addr.rua) { showErr('Informe a rua.'); return; }
    if (!addr.numero) { showErr('Informe o número.'); return; }
    if (!addr.cidade || !addr.estado) { showErr('CEP não encontrado. Verifique e tente novamente.'); return; }

    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(addr)); } catch (e) {}
    render();
    closeModal();

    // Se estiver logado, também salva no cadastro (não bloqueia o fluxo se falhar)
    var session = window.Auth && window.Auth.getSession && window.Auth.getSession();
    if (session && session.token) {
      fetch('/api/auth/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': session.token },
        body: JSON.stringify({ nome: 'Casa', cep: addr.cep, rua: addr.rua, numero: addr.numero,
          complemento: addr.complemento, bairro: addr.bairro, cidade: addr.cidade, estado: addr.estado }),
      }).catch(function () {});
    }
  });
})();
