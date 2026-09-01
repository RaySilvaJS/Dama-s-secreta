// checkout.js
document.addEventListener('DOMContentLoaded', () => {
  // Guest checkout — não exige login prévio; lê de localStorage e sessionStorage
  let authSession = (() => {
    try {
      const ls = JSON.parse(localStorage.getItem('user-session'));
      if (ls && ls.token) return ls;
      const ss = JSON.parse(sessionStorage.getItem('user-session'));
      if (ss && ss.token) return ss;
    } catch {}
    return null;
  })();

  // ── Items ─────────────────────────────────────────────────────────────────────
  const query       = new URLSearchParams(window.location.search);
  const source      = query.get('source');
  const storedCart  = JSON.parse(localStorage.getItem('cart')    || '[]');
  const storedBuyNow= JSON.parse(localStorage.getItem('buy-now') || 'null');
  const insurance   = JSON.parse(sessionStorage.getItem('buy-insurance')        || 'null');

  const orderItems = source === 'buy'
    ? storedBuyNow ? [storedBuyNow] : []
    : source === 'cart'
    ? storedCart
    : storedCart.length ? storedCart : storedBuyNow ? [storedBuyNow] : [];

  const historicoLocal   = localStorage.getItem('historico-pedidos');
  const isPrimeiraCompra = !historicoLocal || JSON.parse(historicoLocal || '[]').length === 0;

  // ── State ─────────────────────────────────────────────────────────────────────
  let selectedAddressId = null;
  let addresses         = [];
  let shippingData      = null;
  let payMethod         = 'mercadopago'; // único método de pagamento disponível no checkout
  let couponDiscount    = 0;
  let subtotal          = orderItems.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const insuranceAmt    = insurance ? insurance.price : 0;

  // Frete grátis: compras a partir de R$ 299, ou 1ª compra em produtos com o selo "freteGratis"
  const FRETE_GRATIS_MIN         = 299;
  const freteGratisPorValor      = subtotal >= FRETE_GRATIS_MIN;
  const freteGratisPrimeiraCompra = isPrimeiraCompra && orderItems.some(item => item.freteGratis);
  const hasFreteGratis           = freteGratisPorValor || freteGratisPrimeiraCompra;
  const freteGratisLabel         = freteGratisPorValor
    ? `Frete grátis — compra acima de R$ ${FRETE_GRATIS_MIN}!`
    : '1ª compra — Frete grátis!';

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmt = (v) => (v == null ? 'R$ 0,00' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const addrLine = (a) =>
    `${esc(a.rua)}, ${esc(a.numero)}${a.complemento ? ' – ' + esc(a.complemento) : ''} — ${esc(a.bairro)}, ${esc(a.cidade)}/${esc(a.estado)} — CEP ${esc(a.cep)}`;

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const itemsList     = $('co-items-list');
  const itemsEmpty    = $('co-items-empty');
  const addrList      = $('co-addr-list');
  const shipResults   = $('co-ship-results');
  const subtotalEl    = $('co-subtotal');
  const shippingValEl = $('co-shipping-val');
  const totalEl       = $('co-total');
  const payBtn        = $('co-pay-btn');
  const billingBody   = $('co-billing-body');
  const insRow        = $('co-insurance-row');
  const insLabel      = $('co-insurance-label');
  const insVal        = $('co-insurance-val');
  const savingsLine   = $('co-savings-line');
  const savingsAmt    = $('co-savings-amt');

  // ── Render items ──────────────────────────────────────────────────────────────
  function renderItems() {
    if (!orderItems.length) {
      itemsEmpty.style.display = 'block';
      itemsList.innerHTML = '';
      return;
    }
    itemsEmpty.style.display = 'none';
    itemsList.innerHTML = orderItems.map(item => `
      <div style="display:flex;gap:12px;align-items:center;padding:14px 18px;border-bottom:1px solid #F3F4F6">
        <img src="${esc(item.imagem)}" alt="${esc(item.nome)}" style="width:62px;height:62px;object-fit:contain;border:1px solid #E5E7EB;border-radius:8px;background:#FAFAFA;padding:4px;flex-shrink:0"/>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px">${esc(item.nome)}</div>
          ${Number(item.descontoHoje || 0) > 0 ? `<div style="font-size:11px;color:#16A34A;font-weight:700">${item.descontoHoje}% OFF hoje</div>` : ''}
          <div style="font-size:12px;color:#6B7280;margin-top:3px">Qtd: ${item.quantidade}</div>
        </div>
        <div style="font-size:15px;font-weight:800;color:#111827;flex-shrink:0">${fmt(item.preco * item.quantidade)}</div>
      </div>`).join('') +
      (insurance ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:#F0FDF4;border-top:1px solid #DCFCE7;font-size:13px">
        <span style="color:#16A34A;font-weight:600">+ ${esc(insurance.label)}</span>
        <span style="font-weight:700;color:#111827">${fmt(insurance.price)}</span>
      </div>` : '');
  }

  // ── Render addresses ──────────────────────────────────────────────────────────
  function renderAddresses() {
    if (!addresses.length) {
      // No addresses: show inline form immediately
      addrList.innerHTML = '';
      const newAddrForm = $('co-new-addr-form');
      if (newAddrForm) newAddrForm.classList.add('open');
      const showBtn = $('co-show-new-addr-btn');
      if (showBtn) showBtn.style.display = 'none';
      updateTotal();
      return;
    }

    // Has addresses: show radio list
    addrList.innerHTML = addresses.map(a => `
      <label class="co-addr-opt${a.principal ? ' selected' : ''}" data-id="${esc(a.id)}">
        <input type="radio" name="co-addr" value="${esc(a.id)}" ${a.principal ? 'checked' : ''}/>
        <div>
          <span class="co-addr-name">${esc(a.nome)}</span>${a.principal ? '<span class="co-addr-badge">PRINCIPAL</span>' : ''}
          <div class="co-addr-line">${addrLine(a)}</div>
        </div>
      </label>`).join('');

    addrList.querySelectorAll('.co-addr-opt').forEach(el => {
      el.addEventListener('click', () => selectAddress(el.dataset.id));
    });

    const showBtn = $('co-show-new-addr-btn');
    if (showBtn) showBtn.style.display = 'inline-flex';

    const principal = addresses.find(a => a.principal) || addresses[0];
    selectAddress(principal.id);
  }

  function selectAddress(id) {
    selectedAddressId = id;
    addrList.querySelectorAll('.co-addr-opt').forEach(el => {
      const sel = el.dataset.id === id;
      el.classList.toggle('selected', sel);
      const radio = el.querySelector('input[type=radio]');
      if (radio) radio.checked = sel;
    });

    // Auto-calc frete when address selected
    const addr = addresses.find(a => a.id === id);
    if (addr && addr.cep) {
      calcFreteFromCep(addr.cep.replace(/\D/g, ''));
    }
  }

  async function loadAddresses() {
    if (!authSession?.token) { addresses = []; renderAddresses(); return; }
    try {
      const r = await fetch('/api/auth/addresses', {
        headers: { 'x-auth-token': authSession.token }
      });
      const data = await r.json();
      addresses = (data && data.addresses) || [];
    } catch { addresses = []; }
    renderAddresses();
  }

  // ── Toggle new address form ───────────────────────────────────────────────────
  window.toggleNewAddrForm = function() {
    const form = $('co-new-addr-form');
    if (!form) return;
    const isOpen = form.classList.contains('open');
    form.classList.toggle('open', !isOpen);
    const showBtn = $('co-show-new-addr-btn');
    if (!showBtn) return;
    if (isOpen) {
      showBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Adicionar outro endereço';
    } else {
      showBtn.innerHTML = '✕ Cancelar';
    }
  };

  // ── Auto-fill address by CEP (viacep.com.br) ─────────────────────────────────
  const _viaCepCache = new Map();

  function setAddrField(id, value, ok = true) {
    const el = $(id);
    if (!el) return;
    el.value = value || '';
    el.readOnly = true;
    el.classList.toggle('co-field-ok', ok && !!value);
    el.placeholder = value ? '' : 'Não encontrado';
  }

  function clearAddrAutoFields() {
    ['addr-rua', 'addr-bairro', 'addr-cidade', 'addr-estado'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.value = '';
      el.readOnly = true;
      el.classList.remove('co-field-ok');
      el.placeholder = 'Aguardando CEP...';
    });
  }

  async function lookupCep(cep) {
    if (_viaCepCache.has(cep)) return _viaCepCache.get(cep);
    const r = await fetch('https://viacep.com.br/ws/' + cep + '/json/');
    const d = await r.json();
    _viaCepCache.set(cep, d);
    return d;
  }

  // Debounce do CEP: evita disparar ViaCEP + cálculo de frete a cada tecla —
  // só dispara ~500ms depois que o cliente para de digitar. O "seq" descarta
  // respostas de requisições antigas caso o cliente corrija o CEP no meio do caminho.
  let cepDebounceTimer = null;
  let cepReqSeq = 0;

  function setupCepAutoFill() {
    const cepInput = $('addr-cep');
    const spinner  = $('addr-cep-spinner');
    if (!cepInput) return;

    cepInput.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5, 8);
      e.target.value = v;

      const digits = v.replace(/\D/g, '');
      clearTimeout(cepDebounceTimer);
      cepReqSeq++;

      if (digits.length < 8) {
        clearAddrAutoFields();
        if (spinner) spinner.classList.remove('active');
        shippingData = null;
        shipResults.innerHTML = '<p class="co-muted">Informe o endereço acima para ver as opções de envio.</p>';
        updateTotal();
        return;
      }

      spinner.classList.add('active');
      clearAddrAutoFields();
      shipResults.innerHTML = '<p class="co-muted"><span class="co-spinner dark" style="display:inline-block;width:14px;height:14px;border-width:2px;vertical-align:middle;margin-right:6px;"></span>Calculando frete...</p>';

      const mySeq = cepReqSeq;
      cepDebounceTimer = setTimeout(async () => {
        try {
          const d = await lookupCep(digits);
          if (mySeq !== cepReqSeq) return; // CEP mudou enquanto a busca rodava — descarta

          if (!d || d.erro) {
            ['addr-rua', 'addr-bairro', 'addr-cidade', 'addr-estado'].forEach(id => {
              const el = $(id);
              if (el) el.placeholder = 'CEP não encontrado';
            });
            shipResults.innerHTML = '<p class="co-muted" style="color:#DC2626">CEP não encontrado. Verifique e tente novamente.</p>';
            shippingData = null;
            updateTotal();
            return;
          }

          setAddrField('addr-rua',    d.logradouro || '');
          setAddrField('addr-bairro', d.bairro     || '');
          setAddrField('addr-cidade', d.localidade || '');
          setAddrField('addr-estado', d.uf         || '');

          // Se rua estiver vazia (CEP de localidade), libera para digitação
          if (!d.logradouro) {
            const ruaEl = $('addr-rua');
            if (ruaEl) {
              ruaEl.readOnly = false;
              ruaEl.placeholder = 'Digite a rua';
              ruaEl.classList.remove('co-field-ok');
            }
          }
          if (!d.bairro) {
            const bairroEl = $('addr-bairro');
            if (bairroEl) {
              bairroEl.readOnly = false;
              bairroEl.placeholder = 'Digite o bairro';
              bairroEl.classList.remove('co-field-ok');
            }
          }

          // Focus no número após preencher
          const numEl = $('addr-numero');
          if (numEl) setTimeout(() => numEl.focus(), 100);

          // CEP válido — calcula o frete automaticamente, sem precisar clicar em nada
          await calcFreteFromCep(digits);

        } catch {
          if (mySeq !== cepReqSeq) return;
          clearAddrAutoFields();
          shipResults.innerHTML = '<p class="co-muted" style="color:#DC2626">Não foi possível calcular o frete agora. Tente novamente.</p>';
          shippingData = null;
          updateTotal();
        } finally {
          if (mySeq === cepReqSeq && spinner) spinner.classList.remove('active');
        }
      }, 500);
    });
  }

  // ── Save new address ──────────────────────────────────────────────────────────
  window.saveNewAddress = async function() {
    const btn    = $('co-save-addr-btn');
    const errEl  = $('co-addr-err');
    const badge  = $('co-addr-saved-badge');

    const nome        = ($('addr-nome')?.value        || '').trim() || 'Casa';
    const cepRaw      = ($('addr-cep')?.value         || '').replace(/\D/g, '');
    const numero      = ($('addr-numero')?.value      || '').trim();
    const rua         = ($('addr-rua')?.value         || '').trim();
    const bairro      = ($('addr-bairro')?.value      || '').trim();
    const cidade      = ($('addr-cidade')?.value      || '').trim();
    const estado      = ($('addr-estado')?.value      || '').trim();
    const complemento = ($('addr-complemento')?.value || '').trim();

    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    if (!cepRaw || cepRaw.length < 8) {
      showAddrErr('Informe um CEP válido.'); return;
    }
    if (!numero) {
      showAddrErr('Informe o número da residência.'); return;
    }
    if (!rua) {
      showAddrErr('Informe a rua.'); return;
    }
    if (!cidade || !estado) {
      showAddrErr('CEP não encontrado. Verifique e tente novamente.'); return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="co-spinner"></span> Salvando...';

    try {
      // Se guest ainda não autenticado, coleta dados primeiro
      if (!authSession?.token) {
        const authed = await ensureAuth();
        if (!authed || !authSession?.token) { showAddrErr('Por favor, preencha seus dados pessoais.'); return; }
      }

      const res = await fetch('/api/auth/addresses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': authSession ? authSession.token : ''
        },
        body: JSON.stringify({ nome, cep: cepRaw, rua, numero, complemento, bairro, cidade, estado, principal: addresses.length === 0 })
      });
      const data = await res.json();

      if (!data.success) {
        showAddrErr(data.error || 'Erro ao salvar endereço.'); return;
      }

      addresses = data.addresses || addresses;

      // Show saved badge
      if (badge) badge.classList.add('visible');
      btn.style.display = 'none';

      // Select the new address
      const newAddr = data.address;
      selectedAddressId = newAddr.id;

      // Re-render address list (hide form, show saved address)
      addrList.innerHTML = `
        <label class="co-addr-opt selected">
          <input type="radio" name="co-addr" value="${esc(newAddr.id)}" checked/>
          <div>
            <span class="co-addr-name">${esc(newAddr.nome)}</span><span class="co-addr-badge">PRINCIPAL</span>
            <div class="co-addr-line">${addrLine(newAddr)}</div>
          </div>
        </label>`;

      // Collapse new addr form
      const form = $('co-new-addr-form');
      if (form) form.classList.remove('open');

      const showBtn = $('co-show-new-addr-btn');
      if (showBtn) { showBtn.style.display = 'inline-flex'; showBtn.textContent = '+ Adicionar outro endereço'; }

      // Auto-calc frete
      calcFreteFromCep(cepRaw);

    } catch {
      showAddrErr('Erro de conexão. Tente novamente.');
      btn.disabled = false;
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Usar este endereço e calcular frete';
    }
  };

  function showAddrErr(msg) {
    const errEl = $('co-addr-err');
    const btn   = $('co-save-addr-btn');
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Usar este endereço e calcular frete';
    }
  }

  // ── Frete calculation ─────────────────────────────────────────────────────────
  function renderFreteOpt(s) {
    const freteReal = hasFreteGratis ? 0 : s.price;
    shippingData = { ...s };
    shipResults.innerHTML = '';
    const opt = document.createElement('div');
    opt.className = 'co-ship-opt selected';
    opt.innerHTML = `
      <input type="radio" name="coship" checked/>
      <div class="co-ship-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      </div>
      <div class="co-ship-info">
        <div class="co-ship-name">${esc(s.region)}</div>
        <div class="co-ship-eta">Entrega em ${esc(s.deadline)}</div>
        ${hasFreteGratis ? `<div style="font-size:11px;font-weight:700;color:#16A34A;margin-top:2px">${esc(freteGratisLabel)}</div>` : ''}
      </div>
      ${hasFreteGratis
        ? `<div><s style="color:#9CA3AF;font-size:11px">${fmt(s.price)}</s><br><span class="co-ship-free">GRÁTIS</span></div>`
        : `<span class="co-ship-price">${fmt(s.price)}</span>`}`;
    shipResults.appendChild(opt);
    const summary = buildSummary(freteReal, s.deadline);
    localStorage.setItem('shipping', JSON.stringify({ cep: s.cep || '', frete: freteReal, prazo: s.deadline, total: summary.total_final, source }));
    localStorage.setItem('checkout-summary', JSON.stringify(summary));
    updateTotal();
  }

  async function calcFreteFromCep(cep) {
    if (!cep || cep.length < 8) return;
    shipResults.innerHTML = '<p class="co-muted"><span class="co-spinner dark" style="display:inline-block;width:14px;height:14px;border-width:2px;vertical-align:middle;margin-right:6px;"></span>Calculando frete...</p>';

    try {
      const r = await fetch('/api/shipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cep, subtotal })
      });
      const data = await r.json().catch(() => ({}));

      if (r.ok) {
        // API retorna array de opções; usa a mais barata disponível
        const opts = Array.isArray(data) ? data : (data.options || data.services || []);
        const valid = opts.filter(o => o && !o.error && (o.price || o.custom_price));
        if (valid.length > 0) {
          const best = valid.reduce((a, b) => (Number(a.price||a.custom_price) <= Number(b.price||b.custom_price) ? a : b));
          const price = Number(best.price || best.custom_price || 0);
          const days  = best.delivery_time || best.custom_delivery_time || best.days || '?';
          renderFreteOpt({ region: best.name || 'Entrega', price, deadline: `${days} dias úteis`, cep });
          return;
        }
      }

      shipResults.innerHTML = `<p class="co-muted" style="color:#DC2626">${esc(data.error) || 'Frete não disponível para este CEP no momento. Entre em contato pelo WhatsApp.'}</p>`;
      shippingData = null;
      updateTotal();
    } catch (_) {
      shipResults.innerHTML = '<p class="co-muted" style="color:#DC2626">Não foi possível calcular o frete agora. Tente novamente.</p>';
      shippingData = null;
      updateTotal();
    }
  }

  // ── Billing ───────────────────────────────────────────────────────────────────
  function renderBilling() {
    if (!authSession) {
      // Formulário inline — coleta dados antes do endereço, sem modal interruptivo
      const loginUrl = 'login.html?redirect=' + encodeURIComponent(window.location.href);
      billingBody.innerHTML = `
        <p style="margin:0 0 12px;font-size:13px;color:#6B7280;">Preencha seus dados para continuar. Nenhuma senha necessária.</p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <input id="billing-nome" type="text" placeholder="Nome completo *" autocomplete="name"
            style="padding:11px 13px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;font-family:inherit;outline:none;width:100%;box-sizing:border-box;"/>
          <input id="billing-whatsapp" type="tel" placeholder="WhatsApp (DDD + número) *" inputmode="numeric" autocomplete="tel"
            style="padding:11px 13px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;font-family:inherit;outline:none;width:100%;box-sizing:border-box;"/>
          <input id="billing-cpf" type="text" placeholder="CPF (opcional — para nota fiscal)" inputmode="numeric" maxlength="14"
            style="padding:11px 13px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;font-family:inherit;outline:none;width:100%;box-sizing:border-box;"/>
          <p id="billing-err" style="margin:0;font-size:12px;color:#DC2626;display:none;"></p>
          <button id="billing-submit" onclick="submitBillingData()"
            style="background:#2563EB;color:#fff;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">
            Confirmar dados e continuar →
          </button>
          <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">Já tem conta? <a href="${loginUrl}" style="color:#2563EB;font-weight:600">Fazer login</a></p>
        </div>`;

      const cpfEl = document.getElementById('billing-cpf');
      const waEl  = document.getElementById('billing-whatsapp');
      if (cpfEl) cpfEl.addEventListener('input', e => {
        let v = e.target.value.replace(/\D/g,'').slice(0,11);
        if (v.length>9) v=v.slice(0,3)+'.'+v.slice(3,6)+'.'+v.slice(6,9)+'-'+v.slice(9);
        else if (v.length>6) v=v.slice(0,3)+'.'+v.slice(3,6)+'.'+v.slice(6);
        else if (v.length>3) v=v.slice(0,3)+'.'+v.slice(3);
        e.target.value=v;
      });
      if (waEl) waEl.addEventListener('input', e => {
        let v = e.target.value.replace(/\D/g,'').slice(0,11);
        if (v.length>7) v='('+v.slice(0,2)+') '+v.slice(2,7)+'-'+v.slice(7);
        else if (v.length>2) v='('+v.slice(0,2)+') '+v.slice(2);
        e.target.value=v;
      });
      return;
    }
    const cpfRaw  = authSession.cpf || '';
    const cpfMask = cpfRaw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    const isGuest = authSession.email && authSession.email.includes('@guest.local');
    billingBody.innerHTML = `
      <div class="co-billing-line"><span class="co-billing-key">Nome</span><span class="co-billing-val">${esc(authSession.name || authSession.nome || '')}</span></div>
      ${!isGuest ? `<div class="co-billing-line"><span class="co-billing-key">E-mail</span><span class="co-billing-val">${esc(authSession.email || '')}</span></div>` : ''}
      <div class="co-billing-line"><span class="co-billing-key">WhatsApp</span><span class="co-billing-val">${esc(authSession.whatsapp || '')}</span></div>
      ${cpfRaw ? `<div class="co-billing-line"><span class="co-billing-key">CPF</span><span class="co-billing-val">${esc(cpfMask)}</span></div>` : ''}
      ${isGuest ? `<p style="margin:8px 0 0;font-size:11px;color:#9CA3AF;">Compra como visitante · <a href="login.html" style="color:#2563EB;font-weight:600">Criar conta completa</a></p>` : ''}`;
  }

  // Submete dados pessoais do guest de forma inline (sem modal)
  window.submitBillingData = async function() {
    const nome     = (document.getElementById('billing-nome')?.value     || '').trim();
    const whatsapp = (document.getElementById('billing-whatsapp')?.value || '');
    const cpf      = (document.getElementById('billing-cpf')?.value      || '');
    const errEl    = document.getElementById('billing-err');
    const btn      = document.getElementById('billing-submit');

    if (errEl) { errEl.style.display = 'none'; }
    if (!nome || nome.length < 3)               { if(errEl){errEl.textContent='Informe o nome completo.';errEl.style.display='block';} return; }
    if (whatsapp.replace(/\D/g,'').length < 10) { if(errEl){errEl.textContent='WhatsApp inválido.';errEl.style.display='block';} return; }
    if (cpf && cpf.replace(/\D/g,'').length > 0 && cpf.replace(/\D/g,'').length !== 11) { if(errEl){errEl.textContent='CPF inválido.';errEl.style.display='block';} return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Aguarde...'; }
    try {
      const r = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, whatsapp: whatsapp.replace(/\D/g,''), cpf: cpf.replace(/\D/g,'') }),
      });
      const d = await r.json();
      if (!d.success) {
        if (errEl) { errEl.textContent = d.error || 'Erro ao salvar dados.'; errEl.style.display = 'block'; }
        if (btn)   { btn.disabled = false; btn.textContent = 'Confirmar dados e continuar →'; }
        return;
      }
      authSession = { ...d.user, token: d.token, name: d.user.nome };
      localStorage.setItem('user-session', JSON.stringify(authSession));
      renderBilling();
      loadAddresses();
    } catch {
      if (errEl) { errEl.textContent = 'Erro de conexão. Tente novamente.'; errEl.style.display = 'block'; }
      if (btn)   { btn.disabled = false; btn.textContent = 'Confirmar dados e continuar →'; }
    }
  };

  // ── Totals ────────────────────────────────────────────────────────────────────
  function updateTotal() {
    const efectiveFrete = hasFreteGratis || couponFreeShipping;
    const frete   = shippingData ? (efectiveFrete ? 0 : shippingData.price) : null;
    const total   = subtotal + insuranceAmt + (frete || 0) - couponDiscount;

    subtotalEl.textContent = fmt(subtotal);

    if (insuranceAmt) {
      insRow.style.display = '';
      insLabel.textContent = insurance.label;
      insVal.textContent   = fmt(insuranceAmt);
    } else {
      insRow.style.display = 'none';
    }

    if (frete === null) {
      shippingValEl.textContent = 'A calcular';
      shippingValEl.className   = 'co-sum-val';
    } else if (frete === 0) {
      const tag = couponFreeShipping ? 'GRÁTIS (cupom)' : 'GRÁTIS';
      shippingValEl.innerHTML = `<span style="color:#16A34A;font-weight:700">${tag}</span>`;
    } else {
      shippingValEl.textContent = fmt(frete);
      shippingValEl.className   = 'co-sum-val';
    }

    totalEl.textContent = fmt(Math.max(0, total));

    if (couponDiscount > 0.5) {
      savingsLine.style.display = 'flex';
      savingsAmt.textContent = fmt(couponDiscount);
    } else {
      savingsLine.style.display = 'none';
    }

    refreshPayBtn();

    if (window.MPCheckout) {
      window.MPCheckout.refresh(getMpContext());
    }
  }

  // payBtn permanece sempre oculto (o Mercado Pago é o único método, com botão próprio
  // dentro do Brick) — mantido só para preencher o hint de dados pendentes, se algum.
  function refreshPayBtn() {
    const ready = orderItems.length > 0 && selectedAddressId && shippingData;
    if (payBtn) payBtn.disabled = !ready;

    const hintEl = $('co-btn-hint');
    if (!ready && hintEl) {
      const missing = [];
      if (!authSession) missing.push('seus dados (seção acima)');
      if (!selectedAddressId) missing.push('endereço de entrega');
      if (!shippingData) missing.push('cálculo do frete');
      hintEl.textContent = missing.length ? '⚠ Preencha: ' + missing.join(' • ') : '';
      hintEl.style.display = missing.length ? 'block' : 'none';
    } else if (hintEl) {
      hintEl.style.display = 'none';
    }
  }

  // ── Mercado Pago Payment Brick — contexto usado por mercadopago-checkout.js ───
  function getMpContext() {
    const address = addresses.find(a => a.id === selectedAddressId);
    return {
      items: orderItems.map(i => ({ id: i.id, quantidade: i.quantidade })),
      // Dados só para exibição na etapa de revisão — o valor cobrado nunca vem daqui
      displayItems: orderItems.map(i => ({ nome: i.nome, preco: i.preco, quantidade: i.quantidade })),
      addressLine: address ? addrLine(address) : '',
      addressId: selectedAddressId,
      couponCode: appliedCouponCode || null,
      shippingCost: shippingData ? ((hasFreteGratis || couponFreeShipping) ? 0 : shippingData.price) : 0,
      authToken: authSession ? authSession.token : null,
      onSuccess: function(result) {
        localStorage.setItem('cart', '[]');
        localStorage.removeItem('buy-now');
        sessionStorage.setItem('mp-payment-result', JSON.stringify(result));
        const qs = new URLSearchParams({ orderId: result.orderId, status: result.status || '' });
        if (result.paymentId) qs.set('paymentId', result.paymentId);
        window.location.href = 'pagamento-mercadopago.html?' + qs.toString();
      },
    };
  }
  window.__getMpContext = getMpContext;

  // ── Payment method selection ────────────────────────────────────────────────
  // Mercado Pago é o único método disponível — a função existe (e continua sendo
  // chamada pelo onclick do card) para reaproveitar a ativação/desativação do Brick.
  // "mpOpened" controla se o cliente já abriu essa seção (e portanto o Brick já foi
  // montado) — sem isso o botão fixo "Finalizar Compra" ficava sempre habilitado e
  // sem função assim que endereço+frete estavam prontos, mesmo sem forma de pagamento
  // escolhida, porque o card já vinha marcado como "selected" no HTML por padrão.
  let mpOpened = false;

  window.selectPayMethod = async function() {
    try {
      if (!orderItems.length || !selectedAddressId || !shippingData) {
        alert('Selecione o endereço de entrega e aguarde o cálculo do frete antes de continuar.');
        return;
      }
      const authed = await ensureAuth();
      if (!authed || !authSession?.token) return;

      payMethod = 'mercadopago';
      const mpOpt = $('co-mp-opt');
      if (mpOpt) {
        mpOpt.classList.add('selected');
        const input = mpOpt.querySelector('input');
        if (input) input.checked = true;
      }

      const mpWrap = $('co-mp-brick-wrap');
      if (mpWrap) mpWrap.style.display = 'block';
      if (payBtn) payBtn.style.display = 'none';
      const btnHint = $('co-btn-hint');
      if (btnHint) btnHint.style.display = 'none';

      if (!window.MPCheckout) throw new Error('Módulo de pagamento não carregado.');
      window.MPCheckout.activate(getMpContext());
      mpOpened = true;

      updateTotal();
    } catch (err) {
      console.error('[Checkout] Erro ao abrir forma de pagamento:', err);
      const btnHint = $('co-btn-hint');
      if (btnHint) {
        btnHint.textContent = 'Não foi possível abrir o pagamento agora. Recarregue a página e tente novamente.';
        btnHint.style.display = 'block';
      }
    }
  };

  // Botão fixo "Finalizar Compra com Segurança": some assim que o Brick é aberto
  // (selectPayMethod esconde ele). Enquanto visível, sua única função é garantir que
  // o cliente não fique sem feedback nenhum se clicar antes de escolher a forma de
  // pagamento — abre a seção e mostra uma mensagem clara, em vez de não fazer nada.
  if (payBtn) {
    payBtn.addEventListener('click', async (e) => {
      try {
        if (payBtn.disabled) return;
        if (mpOpened) return; // Brick já assumiu o fluxo — este botão nem deveria estar visível
        e.preventDefault();

        const btnHint = $('co-btn-hint');
        if (btnHint) {
          btnHint.textContent = 'Selecione uma forma de pagamento para continuar.';
          btnHint.style.display = 'block';
        }
        await window.selectPayMethod();
        const mpOpt = $('co-mp-opt');
        if (mpOpt) {
          mpOpt.scrollIntoView({ behavior: 'smooth', block: 'center' });
          mpOpt.style.animation = 'none';
          void mpOpt.offsetWidth; // reinicia a animação se o cliente clicar de novo
          mpOpt.style.animation = 'coPayHighlight 1s ease';
        }
      } catch (err) {
        console.error('[Checkout] Erro ao finalizar compra:', err);
        alert('Ocorreu um erro ao processar seu pedido. Tente novamente ou entre em contato pelo WhatsApp.');
      }
    });
  }

  // ── Coupon ────────────────────────────────────────────────────────────────────
  let appliedCouponCode = null;
  let couponFreeShipping = false;

  window.applyCoupon = async function() {
    const btn       = document.querySelector('.co-coupon-btn');
    const code      = ($('co-coupon')?.value || '').trim().toUpperCase();
    const couponMsg = $('co-coupon-msg');
    const couponRow = $('co-coupon-row');
    const couponVal = $('co-coupon-val');

    if (!code) {
      if (couponMsg) { couponMsg.textContent = 'Digite o código do cupom.'; couponMsg.style.color = '#DC2626'; couponMsg.style.display = 'block'; }
      return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="co-spinner dark" style="display:inline-block;width:12px;height:12px;border-width:2px;vertical-align:middle;margin-right:4px;"></span>Validando...'; }
    if (couponMsg) couponMsg.style.display = 'none';

    try {
      const r = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': authSession?.token || '' },
        body: JSON.stringify({
          code,
          amount: subtotal,
          paymentMethod: payMethod,
          source: new URLSearchParams(window.location.search).get('utm_source') || null,
        }),
      });
      const data = await r.json();

      if (!data.success) {
        couponDiscount = 0;
        appliedCouponCode = null;
        couponFreeShipping = false;
        if (couponRow) couponRow.style.display = 'none';
        if (couponMsg) { couponMsg.textContent = data.error || 'Cupom inválido.'; couponMsg.style.color = '#DC2626'; couponMsg.style.display = 'block'; }
      } else {
        couponDiscount = data.discount || 0;
        appliedCouponCode = data.code;
        couponFreeShipping = data.freeShipping || false;

        if (couponRow) couponRow.style.display = '';
        if (couponVal) couponVal.textContent = couponFreeShipping ? 'Frete grátis' : '- ' + fmt(couponDiscount);
        if (couponMsg) {
          const desc = data.description || `Cupom ${data.code} aplicado!`;
          couponMsg.textContent = '✓ ' + desc;
          couponMsg.style.color = '#16A34A';
          couponMsg.style.display = 'block';
        }
        updateTotal();
      }
    } catch {
      if (couponMsg) { couponMsg.textContent = 'Erro ao validar cupom. Tente novamente.'; couponMsg.style.color = '#DC2626'; couponMsg.style.display = 'block'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Aplicar'; btn.style.opacity = ''; }
    }
  };

  // Aplicar cupom com Enter
  const couponInput = $('co-coupon');
  if (couponInput) {
    couponInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); window.applyCoupon(); } });
    // Limpa desconto se apagar o código
    couponInput.addEventListener('input', () => {
      if (!couponInput.value.trim()) {
        couponDiscount = 0;
        appliedCouponCode = null;
        couponFreeShipping = false;
        const row = $('co-coupon-row');
        const msg = $('co-coupon-msg');
        if (row) row.style.display = 'none';
        if (msg) msg.style.display = 'none';
        updateTotal();
      }
    });
  }

  // ── Build summary ─────────────────────────────────────────────────────────────
  function buildSummary(frete, prazo) {
    const efectiveFrete = (hasFreteGratis || couponFreeShipping) ? 0 : (frete || 0);
    return {
      produto: orderItems.map(item => ({
        id: item.id || null,
        nome: item.nome, preco: item.preco,
        precoOriginal: item.precoOriginal || null,
        descontoHoje: item.descontoHoje || 0,
        brinde: item.brinde || null,
        quantidade: item.quantidade,
        subtotal: item.preco * item.quantidade,
        freteGratis: item.freteGratis || false,
        retiradaDisponivel: item.retiradaDisponivel === true,
      })),
      quantidade: orderItems.reduce((s, i) => s + i.quantidade, 0),
      subtotal,
      frete: efectiveFrete,
      prazo,
      seguro: insuranceAmt || 0,
      seguroLabel: insurance ? insurance.label : null,
      descontoCupom: couponDiscount,
      couponCode: appliedCouponCode || null,
      couponFreeShipping,
      total_final: Math.max(0, subtotal + insuranceAmt + efectiveFrete - couponDiscount),
      hasFreteGratis: hasFreteGratis || couponFreeShipping,
      hasRetiradaDisponivel: orderItems.some(item => item.retiradaDisponivel === true),
      source,
      paymentMethod: payMethod,
    };
  }

  // ── Guest checkout — coleta dados e cria conta automaticamente ───────────────
  async function ensureAuth() {
    // Se já tem sessão, está ok
    if (authSession && authSession.token) return true;

    // Mostra modal de dados do guest
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'guest-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,.25);">
          <h3 style="margin:0 0 4px;font-size:18px;font-weight:800;color:#111827;">Quase lá! 🎉</h3>
          <p style="margin:0 0 18px;font-size:13px;color:#6B7280;">Informe seus dados para finalizar a compra. Não é necessário criar uma senha.</p>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <input id="guest-nome" type="text" placeholder="Nome completo *" autocomplete="name"
              style="padding:12px 14px;border:1.5px solid #D1D5DB;border-radius:10px;font-size:14px;font-family:inherit;outline:none;"/>
            <input id="guest-whatsapp" type="tel" placeholder="WhatsApp (DDD + número) *" inputmode="numeric" autocomplete="tel"
              style="padding:12px 14px;border:1.5px solid #D1D5DB;border-radius:10px;font-size:14px;font-family:inherit;outline:none;"/>
            <input id="guest-cpf" type="text" placeholder="CPF (opcional — para nota fiscal)" inputmode="numeric" maxlength="14"
              style="padding:12px 14px;border:1.5px solid #D1D5DB;border-radius:10px;font-size:14px;font-family:inherit;outline:none;"/>
            <p id="guest-err" style="margin:0;font-size:12px;color:#DC2626;display:none;"></p>
            <button id="guest-submit" style="background:#16A34A;color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">
              Continuar com a compra
            </button>
            <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">Seus dados são protegidos com SSL e nunca serão compartilhados.</p>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      // CPF mask
      const cpfEl = overlay.querySelector('#guest-cpf');
      cpfEl.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g,'').slice(0,11);
        if (v.length > 9) v = v.slice(0,3)+'.'+v.slice(3,6)+'.'+v.slice(6,9)+'-'+v.slice(9);
        else if (v.length > 6) v = v.slice(0,3)+'.'+v.slice(3,6)+'.'+v.slice(6);
        else if (v.length > 3) v = v.slice(0,3)+'.'+v.slice(3);
        e.target.value = v;
      });
      // WhatsApp mask
      const waEl = overlay.querySelector('#guest-whatsapp');
      waEl.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g,'').slice(0,11);
        if (v.length > 7) v = '('+v.slice(0,2)+') '+v.slice(2,7)+'-'+v.slice(7);
        else if (v.length > 2) v = '('+v.slice(0,2)+') '+v.slice(2);
        e.target.value = v;
      });

      overlay.querySelector('#guest-submit').addEventListener('click', async () => {
        const nome     = overlay.querySelector('#guest-nome').value.trim();
        const whatsapp = overlay.querySelector('#guest-whatsapp').value;
        const cpf      = overlay.querySelector('#guest-cpf').value;
        const errEl    = overlay.querySelector('#guest-err');
        const btn      = overlay.querySelector('#guest-submit');

        if (!nome || nome.length < 3)          { errEl.textContent = 'Informe o nome completo.'; errEl.style.display='block'; return; }
        if (whatsapp.replace(/\D/g,'').length < 10) { errEl.textContent = 'WhatsApp inválido.'; errEl.style.display='block'; return; }
        if (cpf && cpf.replace(/\D/g,'').length > 0 && cpf.replace(/\D/g,'').length !== 11) { errEl.textContent = 'CPF inválido.'; errEl.style.display='block'; return; }

        btn.disabled = true;
        btn.textContent = 'Aguarde...';

        try {
          const r = await fetch('/api/auth/guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, whatsapp: whatsapp.replace(/\D/g,''), cpf: cpf.replace(/\D/g,'') }),
          });
          const d = await r.json();
          if (!d.success) {
            errEl.textContent = d.error || 'Erro ao continuar.';
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Continuar com a compra';
            return;
          }
          // Salva sessão
          authSession = { ...d.user, token: d.token, name: d.user.nome };
          localStorage.setItem('user-session', JSON.stringify(authSession));
          overlay.remove();
          renderBilling();
          // Salva endereço se já foi preenchido mas não tinha conta
          resolve(true);
        } catch {
          errEl.textContent = 'Erro de conexão. Tente novamente.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Continuar com a compra';
        }
      });
    });
  }

  // Nota: o botão fixo (co-pay-btn) fica sempre oculto — a cobrança agora acontece
  // pelo Payment Brick (Mercado Pago), que tem seu próprio botão de envio.
  // O fluxo antigo (POST /api/payment/generate, PIX manual/cartão via WhatsApp) foi removido daqui.

  // ── Init ──────────────────────────────────────────────────────────────────────
  renderItems();
  renderBilling();
  setupCepAutoFill();
  loadAddresses();
  updateTotal();
});
