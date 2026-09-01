// Webhook público do Mercado Pago — POST /api/webhooks/mercado-pago
// Recebe notificações dos tópicos "payment" (Payments API, usada hoje pela criação
// de pagamento deste app) e "order" (Orders API — Checkout Bricks + Orders).
// Rota pública (sem login), mas com validação rigorosa de assinatura (x-signature).
// Nunca confia no corpo da notificação: sempre consulta o recurso oficialmente
// na API do Mercado Pago antes de atualizar qualquer pedido.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mercadopago = require('./mercadopago');
const { getSocket, getGroupId } = require('./whatsapp');

const mpOrdersPath = path.join(__dirname, 'data', 'mp_orders.json');
const webhookLogPath = path.join(__dirname, 'data', 'mp_webhook_log.json');
const usersPath = path.join(__dirname, 'data', 'users.json');
const configPath = path.join(__dirname, 'data', 'config.json');
const loadConfig = () => { try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { return {}; } };

if (!fs.existsSync(mpOrdersPath)) fs.writeFileSync(mpOrdersPath, '[]', 'utf-8');
if (!fs.existsSync(webhookLogPath)) fs.writeFileSync(webhookLogPath, '[]', 'utf-8');

const loadMpOrders = () => { try { return JSON.parse(fs.readFileSync(mpOrdersPath, 'utf-8')); } catch { return []; } };
const saveMpOrders = (o) => fs.writeFileSync(mpOrdersPath, JSON.stringify(o, null, 2), 'utf-8');
const loadUsers = () => { try { return JSON.parse(fs.readFileSync(usersPath, 'utf-8')); } catch { return []; } };

const formatBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatCpfDisplay = (cpf) => {
  if (!cpf) return 'Não informado';
  const d = String(cpf).replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
};
const formatPhoneDisplay = (phone) => {
  if (!phone) return 'Não informado';
  const d = String(phone).replace(/\D/g, '');
  const n = d.startsWith('55') ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return phone;
};

// ── Rastreamento de pedidos (ver server/admin.js pro modelo completo — duplicado
// aqui de propósito, seguindo o padrão do projeto de helpers por arquivo) ──────────
const TRACKING_STATUS_LABELS = {
  PEDIDO_REALIZADO: 'Pedido realizado', PAGAMENTO_APROVADO: 'Pagamento aprovado',
  PREPARANDO_ENVIO: 'Preparando pedido', AGUARDANDO_POSTAGEM: 'Aguardando envio',
  ENVIADO: 'Pedido enviado', ENTREGUE: 'Entregue', CANCELADO: 'Pedido cancelado',
};

function newTrackingObject() {
  return { codigo: null, transportadora: null, statusAtual: 'PEDIDO_REALIZADO', dataEnvio: null, previsaoPostagem: null, previsaoEntrega: null, notifiedStatuses: [], eventos: [] };
}

function appendTrackingEvent(order, { status, descricao, localizacao, origem, data }) {
  if (!order.tracking) order.tracking = newTrackingObject();
  const t = order.tracking;
  const now = data || new Date().toISOString();
  const last = t.eventos[t.eventos.length - 1];
  const isDuplicate = last && last.status === status && (localizacao || null) === (last.localizacao || null) && (descricao || TRACKING_STATUS_LABELS[status] || status) === last.descricao;
  if (!isDuplicate) {
    t.eventos.push({ status, descricao: descricao || TRACKING_STATUS_LABELS[status] || status, data: now, localizacao: localizacao || null, origem: origem || 'sistema' });
  }
  t.statusAtual = status;
  if (status === 'ENVIADO')   { order.fulfillmentStatus = 'shipped';   order.shippedAt = now;   t.dataEnvio = now; }
  if (status === 'ENTREGUE')  { order.fulfillmentStatus = 'delivered'; order.deliveredAt = now; }
}

function addBusinessDays(fromIso, days, holidays) {
  const holidaySet = new Set(holidays || []);
  const d = new Date(fromIso);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    const iso = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(iso)) added++;
  }
  return d.toISOString();
}

// Ao aprovar o pagamento, avança automaticamente até "aguardando postagem" — só o
// cadastro do código de rastreio (via DevOps) marca como ENVIADO de fato.
function markOrderApprovedTracking(order) {
  if (!order.tracking) order.tracking = newTrackingObject();
  appendTrackingEvent(order, { status: 'PAGAMENTO_APROVADO', descricao: 'Pagamento confirmado', origem: 'sistema' });
  appendTrackingEvent(order, { status: 'PREPARANDO_ENVIO', descricao: 'Pedido em preparação para envio', origem: 'sistema' });
  const trackCfg = Object.assign({ prazoPostagemDiasUteis: 1, feriados: [] }, loadConfig().trackingConfig || {});
  const previsao = addBusinessDays(new Date().toISOString(), trackCfg.prazoPostagemDiasUteis, trackCfg.feriados);
  order.tracking.previsaoPostagem = previsao;
  const previsaoFmt = new Date(previsao).toLocaleDateString('pt-BR');
  appendTrackingEvent(order, { status: 'AGUARDANDO_POSTAGEM', descricao: `Aguardando postagem — previsão até ${previsaoFmt}`, origem: 'sistema' });
}

// Notifica o grupo admin do WhatsApp quando um pedido do Mercado Pago é aprovado —
// o fluxo legado (payment.js, PIX manual) já faz isso, mas esse aqui nunca fazia,
// deixando vendas reais via Mercado Pago totalmente invisíveis pra loja.
async function notifyGroupOrderApproved(order) {
  const sock = getSocket();
  const groupId = getGroupId();
  if (!sock || !groupId) {
    console.error(`[MP-WEBHOOK] WhatsApp offline — pedido ${order.externalReference} aprovado sem notificação.`);
    return;
  }

  const users = loadUsers();
  const user = users.find(u => u.id === order.userId) || {};
  const address = (user.enderecos || []).find(a => a.id === order.addressId) || null;
  const addrLine = address
    ? `${address.rua}, ${address.numero}${address.complemento ? ' ' + address.complemento : ''} — ${address.bairro}, ${address.cidade}/${address.estado} · CEP ${address.cep}`
    : 'Não informado';
  const itemsLines = (order.items || []).map(i => `  • ${i.quantity}x ${i.name} — ${formatBRL(i.lineTotal)}`).join('\n');
  const shortDisplay = order.externalReference ? order.externalReference.replace('MPORD-', '').slice(0, 8).toUpperCase() : order.id.slice(0, 8);

  const lines = [
    '✅ *PAGAMENTO APROVADO — MERCADO PAGO*',
    '━━━━━━━━━━━━━━━',
    '',
    `📋 *Pedido:* #${shortDisplay}`,
    `🆔 *ID:* ${order.id}`,
    '',
    '🛍️ *Itens*',
    itemsLines || '  —',
    `💰 *Total:* ${formatBRL(order.amountConfirmed ?? order.amountExpected)}`,
    order.mpPaymentTypeId ? `💳 *Forma de pagamento:* ${order.mpPaymentTypeId}` : null,
    '',
    '👤 *Dados do Cliente*',
    `Nome:     ${user.nome || 'Não informado'}`,
    `CPF:      ${formatCpfDisplay(user.cpf)}`,
    `Telefone: ${formatPhoneDisplay(user.whatsapp)}`,
    `E-mail:   ${user.email || 'Não informado'}`,
    '',
    '📦 *Endereço de Entrega*',
    addrLine,
    '━━━━━━━━━━━━━━━',
  ].filter(l => l !== null).join('\n');

  try {
    await sock.sendMessage(groupId, { text: lines });
    console.log(`[MP-WEBHOOK] Pedido ${order.externalReference} aprovado — grupo notificado.`);
  } catch (err) {
    console.error('[MP-WEBHOOK] Erro ao notificar grupo:', err.message);
  }
}

// Log de auditoria das notificações recebidas — apenas metadados, nunca dados sensíveis.
const loadWebhookLog = () => { try { return JSON.parse(fs.readFileSync(webhookLogPath, 'utf-8')); } catch { return []; } };
const saveWebhookLog = (l) => fs.writeFileSync(webhookLogPath, JSON.stringify(l.slice(-500), null, 2), 'utf-8');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function appendWebhookLog(entry) {
  const log = loadWebhookLog();
  log.push({ at: new Date().toISOString(), ...entry });
  saveWebhookLog(log);
}

// Traduz os status da Orders API para o vocabulário interno usado em mp_orders.json
// (o mesmo já usado pelo fluxo baseado na Payments API, para manter tudo consistente).
// Referência: GET /v1/orders/{id} → status: created | processing | processed |
// action_required | canceled | expired | failed | refunded | charged_back.
function mapOrderApiStatus(status) {
  switch (status) {
    case 'processed':       return 'approved';
    case 'processing':      return 'in_process';
    case 'action_required': return 'pending';
    case 'created':         return 'pending';
    case 'canceled':        return 'cancelled';
    case 'expired':         return 'cancelled';
    case 'failed':          return 'rejected';
    case 'refunded':        return 'refunded';
    case 'charged_back':    return 'charged_back';
    default:                return status;
  }
}

// ── GET de diagnóstico — confirma que o endpoint está no ar, sem expor credenciais ──
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    endpoint: '/api/webhooks/mercado-pago',
    configured: mercadopago.mpConfigured,
    time: new Date().toISOString(),
  });
});

// ── Tópico "payment" (Payments API — /v1/payments) ─────────────────────────────
async function handlePaymentNotification(dataId, xRequestId, res) {
  let mpPayment;
  try {
    const paymentClient = mercadopago.getPaymentClient();
    mpPayment = await paymentClient.get({ id: dataId });
  } catch (err) {
    console.error(`[MP-WEBHOOK] Falha ao consultar pagamento ${dataId}: ${err?.message || 'erro desconhecido'}`);
    appendWebhookLog({ type: 'fetch_failed', topic: 'payment', paymentId: String(dataId), requestId: xRequestId || null });
    // 200 evita retentativa agressiva por erro nosso; MP também reenvia periodicamente por conta própria.
    return res.status(200).json({ received: true, processed: false });
  }

  const orders = loadMpOrders();
  const idx = orders.findIndex(o => o.externalReference === mpPayment.external_reference);
  if (idx === -1) {
    appendWebhookLog({ type: 'order_not_found', topic: 'payment', paymentId: String(mpPayment.id), externalReference: mpPayment.external_reference || null });
    return res.status(200).json({ received: true, processed: false });
  }

  const order = orders[idx];
  const notificationKey = `payment:${mpPayment.id}:${mpPayment.status}:${mpPayment.status_detail}`;

  // Idempotência: mesma transição de status já processada — não reexecuta nada.
  if ((order.processedNotificationIds || []).includes(notificationKey)) {
    return res.status(200).json({ received: true, processed: false, duplicate: true });
  }

  // Confere valor e moeda contra o que foi calculado no servidor na criação do pedido —
  // nunca aceita o status como pago se o valor não bater.
  const amountMatches = Math.abs(round2(mpPayment.transaction_amount) - order.amountExpected) < 0.01;
  const currencyMatches = (mpPayment.currency_id || 'BRL') === (order.currency || 'BRL');

  if (!amountMatches || !currencyMatches) {
    console.error(`[MP-WEBHOOK] Divergência de valor/moeda | pedido=${order.id} | esperado=${order.amountExpected} recebido=${mpPayment.transaction_amount}`);
    order.auditLog.push({
      at: new Date().toISOString(),
      type: 'amount_mismatch',
      details: `esperado=${order.amountExpected} recebido=${mpPayment.transaction_amount} moeda=${mpPayment.currency_id}`,
    });
    order.processedNotificationIds = [...(order.processedNotificationIds || []), notificationKey].slice(-50);
    order.updatedAt = new Date().toISOString();
    orders[idx] = order;
    saveMpOrders(orders);
    appendWebhookLog({ type: 'amount_mismatch', topic: 'payment', paymentId: String(mpPayment.id), orderId: order.id });
    return res.status(200).json({ received: true, processed: false, reason: 'amount_mismatch' });
  }

  order.mpPaymentId       = String(mpPayment.id);
  order.mpPaymentMethodId = mpPayment.payment_method_id || order.mpPaymentMethodId;
  order.mpPaymentTypeId   = mpPayment.payment_type_id || order.mpPaymentTypeId;
  order.mpStatusDetail    = mpPayment.status_detail || null;
  order.status            = mpPayment.status; // approved | pending | in_process | rejected | cancelled | refunded | charged_back
  const wasAlreadyPaid = !!order.paidAt;
  if (mpPayment.status === 'approved') {
    order.amountConfirmed = mpPayment.transaction_amount;
    if (!order.paidAt) order.paidAt = new Date().toISOString();
    if (!wasAlreadyPaid) markOrderApprovedTracking(order);
  }
  order.processedNotificationIds = [...(order.processedNotificationIds || []), notificationKey].slice(-50);
  order.auditLog.push({
    at: new Date().toISOString(),
    type: 'webhook_processed',
    details: `topic=payment status=${mpPayment.status} statusDetail=${mpPayment.status_detail || ''}`,
  });
  order.updatedAt = new Date().toISOString();
  orders[idx] = order;
  saveMpOrders(orders);

  appendWebhookLog({ type: 'processed', topic: 'payment', paymentId: String(mpPayment.id), orderId: order.id, status: mpPayment.status });

  if (mpPayment.status === 'approved' && !wasAlreadyPaid) {
    notifyGroupOrderApproved(order).catch(err => console.error('[MP-WEBHOOK] Falha ao notificar WhatsApp:', err.message));
  }

  return res.status(200).json({ received: true, processed: true });
}

// ── Tópico "order" (Orders API — /v1/orders) ────────────────────────────────────
async function handleOrderNotification(dataId, xRequestId, res) {
  let mpOrder;
  try {
    const orderClient = mercadopago.getOrderClient();
    mpOrder = await orderClient.get({ id: dataId });
  } catch (err) {
    console.error(`[MP-WEBHOOK] Falha ao consultar order ${dataId}: ${err?.message || 'erro desconhecido'}`);
    appendWebhookLog({ type: 'fetch_failed', topic: 'order', mpOrderId: String(dataId), requestId: xRequestId || null });
    return res.status(200).json({ received: true, processed: false });
  }

  const orders = loadMpOrders();
  const idx = orders.findIndex(o => o.externalReference === mpOrder.external_reference);
  if (idx === -1) {
    appendWebhookLog({ type: 'order_not_found', topic: 'order', mpOrderId: String(mpOrder.id), externalReference: mpOrder.external_reference || null });
    return res.status(200).json({ received: true, processed: false });
  }

  const order = orders[idx];
  const notificationKey = `order:${mpOrder.id}:${mpOrder.status}:${mpOrder.status_detail}`;

  // Idempotência: mesma transição de status já processada — não reexecuta nada.
  if ((order.processedNotificationIds || []).includes(notificationKey)) {
    return res.status(200).json({ received: true, processed: false, duplicate: true });
  }

  // Confere valor e moeda contra o que foi calculado no servidor na criação do pedido —
  // nunca aceita o status como pago se o valor não bater. total_amount vem como string.
  const totalAmount = Number(mpOrder.total_amount);
  const amountMatches = Number.isFinite(totalAmount) && Math.abs(round2(totalAmount) - order.amountExpected) < 0.01;
  const orderCurrency = mpOrder.currency || 'BRL';
  const currencyMatches = orderCurrency === (order.currency || 'BRL');

  if (!amountMatches || !currencyMatches) {
    console.error(`[MP-WEBHOOK] Divergência de valor/moeda (order) | pedido=${order.id} | esperado=${order.amountExpected} recebido=${mpOrder.total_amount}`);
    order.auditLog.push({
      at: new Date().toISOString(),
      type: 'amount_mismatch',
      details: `esperado=${order.amountExpected} recebido=${mpOrder.total_amount} moeda=${orderCurrency}`,
    });
    order.processedNotificationIds = [...(order.processedNotificationIds || []), notificationKey].slice(-50);
    order.updatedAt = new Date().toISOString();
    orders[idx] = order;
    saveMpOrders(orders);
    appendWebhookLog({ type: 'amount_mismatch', topic: 'order', mpOrderId: String(mpOrder.id), orderId: order.id });
    return res.status(200).json({ received: true, processed: false, reason: 'amount_mismatch' });
  }

  // Transações de pagamento associadas à order (pode haver mais de uma tentativa) —
  // usamos a mais recente só para exibição; a fonte da verdade de status é a order em si.
  const payments = (mpOrder.transactions && mpOrder.transactions.payments) || [];
  const lastPayment = payments[payments.length - 1];

  const mappedStatus = mapOrderApiStatus(mpOrder.status);

  order.mpOrderId         = String(mpOrder.id);
  order.mpPaymentId       = lastPayment ? String(lastPayment.id) : order.mpPaymentId;
  order.mpPaymentMethodId = (lastPayment && lastPayment.payment_method && lastPayment.payment_method.id) || order.mpPaymentMethodId;
  order.mpPaymentTypeId   = (lastPayment && lastPayment.payment_method && lastPayment.payment_method.type) || order.mpPaymentTypeId;
  order.mpStatusDetail    = mpOrder.status_detail || null;
  order.status            = mappedStatus; // approved | pending | in_process | rejected | cancelled | refunded | charged_back
  const wasAlreadyPaid = !!order.paidAt;
  if (mappedStatus === 'approved') {
    order.amountConfirmed = totalAmount;
    if (!order.paidAt) order.paidAt = new Date().toISOString();
    if (!wasAlreadyPaid) markOrderApprovedTracking(order);
  }
  order.processedNotificationIds = [...(order.processedNotificationIds || []), notificationKey].slice(-50);
  order.auditLog.push({
    at: new Date().toISOString(),
    type: 'webhook_processed',
    details: `topic=order mpStatus=${mpOrder.status} statusDetail=${mpOrder.status_detail || ''} mappedStatus=${mappedStatus}`,
  });
  order.updatedAt = new Date().toISOString();
  orders[idx] = order;
  saveMpOrders(orders);

  appendWebhookLog({ type: 'processed', topic: 'order', mpOrderId: String(mpOrder.id), orderId: order.id, status: mappedStatus });

  if (mappedStatus === 'approved' && !wasAlreadyPaid) {
    notifyGroupOrderApproved(order).catch(err => console.error('[MP-WEBHOOK] Falha ao notificar WhatsApp:', err.message));
  }

  return res.status(200).json({ received: true, processed: true });
}

router.post('/', async (req, res) => {
  if (!mercadopago.mpConfigured) {
    // Responde 200 para não gerar retentativas infinitas do MP enquanto o servidor
    // ainda não tem credenciais configuradas — mas nada é processado.
    return res.status(200).json({ received: false, reason: 'not_configured' });
  }

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  const dataId = req.query['data.id'] || req.query.id || (req.body && req.body.data && req.body.data.id);

  try {
    mercadopago.verifyWebhookSignature({ xSignature, xRequestId, dataId });
  } catch (err) {
    console.warn(`[MP-WEBHOOK] Assinatura inválida | reason=${err?.reason || 'unknown'} | request-id=${xRequestId || '?'}`);
    appendWebhookLog({ type: 'signature_rejected', reason: err?.reason || 'unknown', requestId: xRequestId || null });
    return res.status(401).json({ error: 'Assinatura inválida.' });
  }

  if (!dataId) {
    appendWebhookLog({ type: 'missing_data_id', requestId: xRequestId || null });
    return res.status(200).json({ received: true });
  }

  const topic = req.query.type || req.query.topic || (req.body && req.body.type);

  if (topic === 'order') {
    return handleOrderNotification(dataId, xRequestId, res);
  }
  if (!topic || topic === 'payment') {
    return handlePaymentNotification(dataId, xRequestId, res);
  }

  // Outros tópicos (merchant_order, chargebacks isolados, etc.) — apenas confirmamos o recebimento.
  appendWebhookLog({ type: 'topic_ignored', topic, requestId: xRequestId || null });
  return res.status(200).json({ received: true });
});

module.exports = router;
