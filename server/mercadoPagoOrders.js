// Rotas de pedido e pagamento via Mercado Pago Payment Brick.
// Mantido separado do fluxo legado (server/payment.js, PIX manual + WhatsApp) —
// os dois convivem lado a lado. Segue o padrão do projeto de helpers duplicados
// por arquivo (ver CLAUDE.md) em vez de um módulo de dados compartilhado.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const mercadopago = require('./mercadopago');
const { validateCoupon } = require('./coupons');

const mpOrdersPath = path.join(__dirname, 'data', 'mp_orders.json');
const usersPath    = path.join(__dirname, 'data', 'users.json');
const productsPath = path.join(__dirname, 'data', 'loja.json');

if (!fs.existsSync(path.dirname(mpOrdersPath))) fs.mkdirSync(path.dirname(mpOrdersPath), { recursive: true });
if (!fs.existsSync(mpOrdersPath)) fs.writeFileSync(mpOrdersPath, '[]', 'utf-8');

const loadMpOrders = () => { try { return JSON.parse(fs.readFileSync(mpOrdersPath, 'utf-8')); } catch { return []; } };
const saveMpOrders = (o) => fs.writeFileSync(mpOrdersPath, JSON.stringify(o, null, 2), 'utf-8');
const loadUsers    = () => { try { return JSON.parse(fs.readFileSync(usersPath, 'utf-8')); } catch { return []; } };
const loadProducts = () => { try { return JSON.parse(fs.readFileSync(productsPath, 'utf-8')); } catch { return []; } };

const findUserByToken = (users, token) => {
  if (!token) return null;
  return users.find(u => {
    if (u.token === token) return true;
    if (Array.isArray(u.sessions) && u.sessions.some(s => s.token === token)) return true;
    return false;
  }) || null;
};

const getAuthUser = (req) => {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token) return null;
  return findUserByToken(loadUsers(), token);
};

// ── Rate limiting básico (mesmo padrão usado em server/index.js) ──────────────
const _windows = new Map();
function rateLimit(maxAttempts, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = ip + req.path;
    const now = Date.now();
    const window = (_windows.get(key) || []).filter(t => now - t < windowMs);
    if (window.length >= maxAttempts) {
      res.set('Retry-After', Math.ceil((windowMs - (now - window[0])) / 1000));
      return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde um instante e tente novamente.' });
    }
    window.push(now);
    _windows.set(key, window);
    next();
  };
}

// ── Helpers de domínio ─────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Recalcula o valor do pedido inteiramente a partir do catálogo no servidor.
// Nunca confia no preço enviado pelo cliente — apenas em id + quantidade.
function computeOrderAmount(items) {
  const products = loadProducts();
  const resolved = [];
  for (const raw of items) {
    const id = String(raw?.id ?? '');
    const quantidade = Math.max(1, Math.min(50, parseInt(raw?.quantidade, 10) || 1));
    if (!id) throw new Error('Item de pedido sem ID.');
    const product = products.find(p => String(p.id) === id);
    if (!product || !(product.price > 0)) throw new Error(`Produto "${id}" não encontrado ou indisponível.`);
    resolved.push({
      id,
      name: product.name,
      unitPrice: round2(product.price),
      quantity: quantidade,
      lineTotal: round2(product.price * quantidade),
    });
  }
  const subtotal = round2(resolved.reduce((s, i) => s + i.lineTotal, 0));
  return { items: resolved, subtotal };
}

function sanitizeShippingCost(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return round2(Math.min(n, 500)); // teto de sanidade — cotação real vem do /api/shipping
}

// ── Rotas ─────────────────────────────────────────────────────────────────────

// Config pública — apenas a Public Key pode ir para o frontend
router.get('/config', (req, res) => {
  res.json({ configured: mercadopago.mpConfigured, publicKey: mercadopago.getPublicKey() });
});

// Cria (ou recupera, se ainda pendente) um pedido com valor validado no servidor
router.post('/orders', rateLimit(20, 5 * 60 * 1000), (req, res) => {
  if (!mercadopago.mpConfigured) {
    return res.status(503).json({ success: false, error: 'Pagamento via Mercado Pago está temporariamente indisponível.' });
  }
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Você precisa estar logado para finalizar a compra.' });

  const { items, addressId, couponCode, shippingCost } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Nenhum item informado.' });
  }

  let resolved, subtotal;
  try {
    ({ items: resolved, subtotal } = computeOrderAmount(items));
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }

  const orders = loadMpOrders();

  let couponDiscount = 0;
  let couponResult = null;
  if (couponCode) {
    const isFirstPurchase = orders.filter(o => o.userId === user.id).length === 0;
    couponResult = validateCoupon(couponCode, {
      amount: subtotal,
      userId: user.id,
      paymentMethod: 'mercadopago',
      isFirstPurchase,
    });
    if (couponResult.valid) couponDiscount = couponResult.discount || 0;
  }

  const shipping = sanitizeShippingCost(shippingCost);
  const amount = round2(Math.max(0, subtotal - couponDiscount + shipping));
  if (amount <= 0) {
    return res.status(400).json({ success: false, error: 'Valor do pedido inválido.' });
  }

  const orderId = uuidv4();
  const externalReference = `MPORD-${orderId}`;
  const now = new Date().toISOString();

  const order = {
    id: orderId,
    externalReference,
    userId: user.id,
    items: resolved,
    addressId: addressId || null,
    subtotal,
    shippingCost: shipping,
    couponCode: (couponResult && couponResult.valid) ? couponResult.code : null,
    couponDiscount,
    amountExpected: amount,
    amountConfirmed: null,
    currency: 'BRL',
    status: 'pending_payment', // pending_payment | pending | in_process | approved | rejected | cancelled | refunded | charged_back
    mpPaymentId: null,
    mpOrderId: null, // ID da Order (Orders API, formato "ORD...") — distinto do ID de pagamento acima
    mpPaymentMethodId: null,
    mpPaymentTypeId: null,
    mpStatusDetail: null,
    attempts: [],
    processedNotificationIds: [],
    auditLog: [{ at: now, type: 'order_created', details: `Pedido criado por ${user.email}` }],
    createdAt: now,
    updatedAt: now,
  };
  orders.push(order);
  saveMpOrders(orders);

  res.json({ success: true, orderId, externalReference, amount, items: resolved });
});

// Cria o pagamento propriamente dito a partir dos dados do Payment Brick
router.post('/', rateLimit(15, 5 * 60 * 1000), async (req, res) => {
  if (!mercadopago.mpConfigured) {
    return res.status(503).json({ success: false, error: 'Pagamento via Mercado Pago está temporariamente indisponível.' });
  }
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Você precisa estar logado para finalizar a compra.' });

  const { orderId, formData } = req.body || {};
  if (!orderId || !formData || typeof formData !== 'object') {
    return res.status(400).json({ success: false, error: 'Dados de pagamento incompletos.' });
  }

  const orders = loadMpOrders();
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });
  const order = orders[idx];

  if (order.userId !== user.id) {
    return res.status(403).json({ success: false, error: 'Este pedido não pertence à sua conta.' });
  }
  if (order.status === 'approved') {
    return res.status(409).json({ success: false, error: 'Este pedido já foi pago.' });
  }

  // ── Sanitiza os dados vindos do Brick — apenas os campos esperados ───────────
  const paymentMethodId = String(formData.payment_method_id || '').trim();
  const token           = formData.token ? String(formData.token) : undefined;
  const installments    = Math.max(1, Math.min(24, parseInt(formData.installments, 10) || 1));
  const issuerId        = formData.issuer_id ? String(formData.issuer_id) : undefined;
  const payerEmail      = (formData.payer && formData.payer.email) || user.email;
  const payerIdentification = (formData.payer && formData.payer.identification && formData.payer.identification.number)
    ? { type: formData.payer.identification.type || 'CPF', number: String(formData.payer.identification.number).replace(/\D/g, '') }
    : (user.cpf ? { type: 'CPF', number: user.cpf } : undefined);

  if (!paymentMethodId) {
    return res.status(400).json({ success: false, error: 'Método de pagamento não informado.' });
  }

  // ── Idempotência: mesma tentativa (mesmo token/método) reaproveita a chave ───
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify({ orderId, token: token || null, paymentMethodId, installments }))
    .digest('hex');

  let attempt = order.attempts.find(a => a.fingerprint === fingerprint);
  if (!attempt) {
    attempt = { fingerprint, idempotencyKey: uuidv4(), createdAt: new Date().toISOString() };
    order.attempts.push(attempt);
  }

  const appUrl = mercadopago.getAppUrl().replace(/\/+$/, '');

  const paymentBody = {
    transaction_amount: order.amountExpected, // NUNCA confia em valor vindo do frontend
    description: `Pedido ${order.externalReference} — DAMA'S SECRETA`,
    payment_method_id: paymentMethodId,
    installments,
    external_reference: order.externalReference,
    notification_url: `${appUrl}/api/webhooks/mercado-pago`,
    statement_descriptor: 'DAMASSECRETA',
    payer: { email: payerEmail, identification: payerIdentification },
  };
  if (token) {
    paymentBody.token = token;
    // Habilita o fluxo 3DS 2.0 do Mercado Pago para pagamentos com cartão — o emissor
    // decide se pede o desafio (challenge) com base no risco da transação.
    paymentBody.three_d_secure_mode = 'optional';
  }
  if (issuerId) paymentBody.issuer_id = issuerId;

  let mpResponse;
  try {
    const paymentClient = mercadopago.getPaymentClient();
    mpResponse = await paymentClient.create({
      body: paymentBody,
      requestOptions: { idempotencyKey: attempt.idempotencyKey },
    });
  } catch (err) {
    // Nunca loga o corpo da requisição (contém token de cartão)
    const status = err?.status || err?.cause?.[0]?.code || 502;
    console.error(`[MERCADO PAGO] Falha ao criar pagamento | pedido=${order.id} | status=${status} | msg=${err?.message || 'erro desconhecido'}`);
    order.auditLog.push({ at: new Date().toISOString(), type: 'payment_error', details: `Falha na criação do pagamento (status ${status})` });
    order.updatedAt = new Date().toISOString();
    orders[idx] = order;
    saveMpOrders(orders);
    return res.status(502).json({ success: false, error: 'Não foi possível processar o pagamento agora. Tente novamente em instantes.' });
  }

  attempt.mpPaymentId = mpResponse.id;
  attempt.status = mpResponse.status;

  order.mpPaymentId       = String(mpResponse.id);
  order.mpPaymentMethodId = mpResponse.payment_method_id || paymentMethodId;
  order.mpPaymentTypeId   = mpResponse.payment_type_id || null;
  order.mpStatusDetail    = mpResponse.status_detail || null;
  // Status só é confirmado (approved) aqui porque veio da API oficial do MP nesta chamada —
  // a confirmação definitiva/duradoura continua sendo feita pelo webhook.
  order.status = mpResponse.status || 'pending';
  if (order.status === 'approved') order.amountConfirmed = mpResponse.transaction_amount;
  order.auditLog.push({ at: new Date().toISOString(), type: 'payment_created', details: `paymentId=${mpResponse.id} status=${mpResponse.status}` });
  order.updatedAt = new Date().toISOString();
  orders[idx] = order;
  saveMpOrders(orders);

  const txData = mpResponse.point_of_interaction && mpResponse.point_of_interaction.transaction_data;
  // Presente quando o emissor pede autenticação 3DS (status pending / status_detail pending_challenge).
  // O Status Screen Brick usa esses dois campos para renderizar o desafio do banco.
  const threeDs = mpResponse.three_ds_info;

  res.json({
    success: true,
    paymentId: String(mpResponse.id),
    orderId: order.id,
    status: mpResponse.status,
    statusDetail: mpResponse.status_detail || null,
    paymentMethodId: order.mpPaymentMethodId,
    externalReference: order.externalReference,
    ...(txData && (txData.qr_code || txData.qr_code_base64) ? {
      pix: {
        qrCode: txData.qr_code || null,
        qrCodeBase64: txData.qr_code_base64 || null,
        ticketUrl: txData.ticket_url || null,
      },
    } : {}),
    ...(txData && txData.ticket_url && !txData.qr_code ? { ticketUrl: txData.ticket_url } : {}),
    ...(threeDs && threeDs.external_resource_url ? {
      threeDsInfo: { externalResourceURL: threeDs.external_resource_url, creq: threeDs.creq || null },
    } : {}),
  });
});

// Consulta de status — sempre pela fonte oficial (Mercado Pago), nunca pelo que o cliente informa
router.get('/:paymentId/status', rateLimit(60, 60 * 1000), async (req, res) => {
  if (!mercadopago.mpConfigured) {
    return res.status(503).json({ success: false, error: 'Pagamento via Mercado Pago está temporariamente indisponível.' });
  }
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Autenticação necessária.' });

  const { paymentId } = req.params;
  const orders = loadMpOrders();
  const order = orders.find(o => o.mpPaymentId === String(paymentId));
  if (!order) return res.status(404).json({ success: false, error: 'Pagamento não encontrado.' });
  if (order.userId !== user.id) return res.status(403).json({ success: false, error: 'Acesso negado.' });

  try {
    const paymentClient = mercadopago.getPaymentClient();
    const mpResponse = await paymentClient.get({ id: paymentId });

    const idx = orders.findIndex(o => o.id === order.id);
    if (idx !== -1 && mpResponse.status && orders[idx].status !== mpResponse.status) {
      orders[idx].status = mpResponse.status;
      orders[idx].mpStatusDetail = mpResponse.status_detail || null;
      if (mpResponse.status === 'approved') orders[idx].amountConfirmed = mpResponse.transaction_amount;
      orders[idx].updatedAt = new Date().toISOString();
      saveMpOrders(orders);
    }

    res.json({
      success: true,
      paymentId: String(mpResponse.id),
      orderId: order.id,
      status: mpResponse.status,
      statusDetail: mpResponse.status_detail || null,
      updatedAt: orders[idx] ? orders[idx].updatedAt : order.updatedAt,
    });
  } catch (err) {
    console.error(`[MERCADO PAGO] Falha ao consultar status | paymentId=${paymentId} | msg=${err?.message || 'erro desconhecido'}`);
    res.status(502).json({ success: false, error: 'Não foi possível consultar o status agora.' });
  }
});

module.exports = router;
module.exports._internal = { loadMpOrders, saveMpOrders, computeOrderAmount, sanitizeShippingCost };
