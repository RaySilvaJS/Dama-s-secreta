// mercadopago-checkout.js
// Integração do Mercado Pago Checkout Bricks (Payment Brick) no checkout existente.
// Exposto como window.MPCheckout = { activate, deactivate, refresh }.
// Nunca lida com dados brutos de cartão — tudo é tokenizado pelo próprio Brick.

(function () {
  let mp = null;
  let brickController = null;
  let currentOrderId = null;
  let active = false;
  let mounting = false;
  let lastContext = null;
  let refreshTimer = null;
  let configPromise = null;

  const $ = (id) => document.getElementById(id);

  const STATUS_DETAIL_MESSAGES = {
    cc_rejected_insufficient_amount: 'Saldo insuficiente no cartão.',
    cc_rejected_bad_filled_security_code: 'Código de segurança (CVV) incorreto. Confira e tente novamente.',
    cc_rejected_bad_filled_date: 'Data de validade do cartão incorreta.',
    cc_rejected_bad_filled_card_number: 'Número do cartão incorreto.',
    cc_rejected_bad_filled_other: 'Dados do cartão inválidos. Confira e tente novamente.',
    cc_rejected_call_for_authorize: 'Pagamento não autorizado. Entre em contato com o seu banco.',
    cc_rejected_card_disabled: 'Cartão desabilitado. Entre em contato com o seu banco.',
    cc_rejected_duplicated_payment: 'Já existe um pagamento igual em processamento. Aguarde alguns minutos.',
    cc_rejected_high_risk: 'Pagamento recusado por segurança.',
    cc_rejected_max_attempts: 'Limite de tentativas excedido. Tente outro cartão.',
    cc_rejected_other_reason: 'Pagamento recusado pelo emissor do cartão.',
    cc_rejected_invalid_installments: 'Número de parcelas inválido para este cartão.',
  };

  function friendlyMessage(data) {
    const detail = data && data.statusDetail;
    if (detail && STATUS_DETAIL_MESSAGES[detail]) return STATUS_DETAIL_MESSAGES[detail];
    if (data && data.error) return data.error;
    return 'Pagamento não aprovado. Verifique os dados e tente novamente.';
  }

  function formatBRL(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function paymentMethodLabel(selectedPaymentMethod, formData) {
    const type = selectedPaymentMethod && selectedPaymentMethod.type;
    const installments = formData && formData.installments;
    if (type === 'bank_transfer') return 'Pix';
    if (type === 'ticket') return 'Boleto';
    if (type === 'wallet_purchase') return 'Conta Mercado Pago';
    if (type === 'credit_card') return `Cartão de crédito${installments > 1 ? ' — ' + installments + 'x' : ''}`;
    if (type === 'debit_card') return 'Cartão de débito';
    return 'Mercado Pago';
  }

  // ── Etapa de revisão e confirmação ─────────────────────────────────────────
  // Mostrada depois que o Brick tokeniza os dados (onSubmit) e antes de
  // efetivamente criar a cobrança no backend — dá ao cliente a chance de
  // conferir itens, endereço e forma de pagamento, e cancelar se quiser.
  function showReviewModal({ methodLabel, totalLabel, items, addressLine }) {
    return new Promise((resolve) => {
      const modal = $('co-mp-review-modal');
      const confirmBtn = $('co-mp-review-confirm');
      const cancelBtn = $('co-mp-review-cancel');
      if (!modal || !confirmBtn || !cancelBtn) { resolve(true); return; } // sem modal na página — não bloqueia o pagamento

      const methodEl  = $('co-mp-review-method');
      const totalEl   = $('co-mp-review-total');
      const addrEl    = $('co-mp-review-address');
      const itemsEl   = $('co-mp-review-items');
      if (methodEl) methodEl.textContent = methodLabel || 'Mercado Pago';
      if (totalEl)  totalEl.textContent  = totalLabel || '';
      if (addrEl)   addrEl.textContent   = addressLine || 'Não informado';
      if (itemsEl) {
        itemsEl.innerHTML = (items || []).map((i) => `
          <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;color:#374151;">
            <span>${i.quantidade}x ${escapeHtml(i.nome)}</span>
            <span style="white-space:nowrap;">${formatBRL(i.preco * i.quantidade)}</span>
          </div>`).join('');
      }

      modal.style.display = 'flex';

      const cleanup = () => {
        modal.style.display = 'none';
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
      };
      const onConfirm = () => { cleanup(); resolve(true); };
      const onCancel  = () => { cleanup(); resolve(false); };
      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  function showError(msg) {
    const el = $('co-mp-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    const retry = $('co-mp-retry-btn');
    if (retry) retry.style.display = 'block';
    showLoading(false);
  }

  function clearError() {
    const el = $('co-mp-error');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
    const retry = $('co-mp-retry-btn');
    if (retry) retry.style.display = 'none';
  }

  function showLoading(on) {
    const loading = $('co-mp-loading');
    if (loading) loading.style.display = on ? 'flex' : 'none';
  }

  function getConfig() {
    if (!configPromise) {
      configPromise = fetch('/api/payments/mercado-pago/config')
        .then((r) => r.json())
        .catch(() => ({ configured: false, publicKey: null }));
    }
    return configPromise;
  }

  async function unmountBrick() {
    if (brickController) {
      try { await brickController.unmount(); } catch (e) { /* ignore */ }
      brickController = null;
    }
    const container = $('co-mp-brick-container');
    if (container) container.innerHTML = '';
  }

  async function mountFlow(context) {
    if (mounting) return;
    mounting = true;
    clearError();
    showLoading(true);
    try {
      await unmountBrick();
      currentOrderId = null;

      if (!context || !context.authToken) { showError('Faça login para continuar.'); return; }
      if (!context.items || !context.items.length) { showError('Seu carrinho está vazio.'); return; }

      const cfg = await getConfig();
      if (!cfg || !cfg.configured || !cfg.publicKey) {
        showError('Pagamento via Mercado Pago está temporariamente indisponível. Escolha PIX ou outra forma de pagamento.');
        return;
      }
      if (!window.MercadoPago) {
        showError('Não foi possível carregar o Mercado Pago. Verifique sua conexão e tente novamente.');
        return;
      }
      if (!mp) mp = new window.MercadoPago(cfg.publicKey, { locale: 'pt-BR' });

      const orderRes = await fetch('/api/payments/mercado-pago/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': context.authToken },
        body: JSON.stringify({
          items: context.items,
          addressId: context.addressId,
          couponCode: context.couponCode,
          shippingCost: context.shippingCost,
        }),
      });
      const orderData = await orderRes.json().catch(() => ({}));
      if (!orderRes.ok || !orderData.success) {
        showError(orderData.error || 'Não foi possível preparar o pagamento. Tente novamente.');
        return;
      }
      if (!active) return; // usuário trocou de método enquanto aguardávamos a resposta
      currentOrderId = orderData.orderId;

      let session = null;
      try { session = JSON.parse(localStorage.getItem('user-session') || 'null'); } catch (e) { /* ignore */ }

      let submitting = false;

      brickController = await mp.bricks().create('payment', 'co-mp-brick-container', {
        initialization: {
          amount: orderData.amount,
          payer: session && session.email ? { email: session.email } : undefined,
        },
        customization: {
          paymentMethods: {
            creditCard: 'all',
            debitCard: 'all',
            ticket: 'all',
            bankTransfer: 'all',
            maxInstallments: 12,
          },
        },
        callbacks: {
          onReady: () => { showLoading(false); },
          onError: (error) => {
            console.error('[MercadoPago Brick] onError', error);
            showError('Erro ao carregar o formulário de pagamento. Tente novamente.');
          },
          onSubmit: ({ selectedPaymentMethod, formData }) => {
            if (submitting) return Promise.reject(new Error('already_submitting'));

            return showReviewModal({
              methodLabel: paymentMethodLabel(selectedPaymentMethod, formData),
              totalLabel: formatBRL(orderData.amount),
              items: context.displayItems,
              addressLine: context.addressLine,
            }).then((confirmed) => {
              if (!confirmed) {
                // Cliente clicou em "Voltar" — não cobra nada, apenas devolve o Brick ao estado editável.
                throw new Error('Revise os dados e confirme quando estiver pronto.');
              }

              submitting = true;
              clearError();
              return fetch('/api/payments/mercado-pago', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-auth-token': context.authToken },
                body: JSON.stringify({ orderId: currentOrderId, formData }),
              })
                .then((r) => r.json().then((data) => ({ ok: r.ok, data })).catch(() => ({ ok: false, data: {} })))
                .then(({ ok, data }) => {
                  submitting = false;
                  if (!ok || !data.success) {
                    const msg = friendlyMessage(data);
                    showError(msg);
                    throw new Error(msg);
                  }
                  if (data.status === 'rejected') {
                    const msg = friendlyMessage(data);
                    showError(msg);
                    throw new Error(msg);
                  }
                  // approved / pending / in_process (inclui 3DS "pending_challenge") seguem para a
                  // tela de resultado, que usa o Status Screen Brick para mostrar o desafio/QR/status.
                  if (context.onSuccess) context.onSuccess(data);
                  return undefined;
                })
                .catch((err) => {
                  submitting = false;
                  throw err;
                });
            });
          },
        },
      });
    } catch (err) {
      console.error('[MercadoPago Brick] mountFlow error', err);
      showError('Não foi possível carregar o pagamento agora. Tente novamente.');
    } finally {
      mounting = false;
    }
  }

  function activate(context) {
    active = true;
    lastContext = context;
    mountFlow(context);
  }

  function deactivate() {
    active = false;
    currentOrderId = null;
    clearTimeout(refreshTimer);
    unmountBrick();
  }

  function refresh(context) {
    if (!active) return;
    lastContext = context;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (active) mountFlow(lastContext);
    }, 600);
  }

  const retryBtn = document.getElementById('co-mp-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      if (active && lastContext) mountFlow(lastContext);
    });
  }

  window.MPCheckout = { activate, deactivate, refresh };
})();
