// Webhook público do Mercado Pago — recebe notificações de pagamento.
// Rota pública (sem login), mas com validação rigorosa de assinatura (x-signature).
// Nunca confia no corpo da notificação: sempre consulta o pagamento oficialmente
// na API do Mercado Pago antes de atualizar qualquer pedido.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mercadopago = require('./mercadopago');

const mpOrdersPath = path.join(__dirname, 'data', 'mp_orders.json');
const webhookLogPath = path.join(__dirname, 'data', 'mp_webhook_log.json');

if (!fs.existsSync(mpOrdersPath)) fs.writeFileSync(mpOrdersPath, '[]', 'utf-8');
if (!fs.existsSync(webhookLogPath)) fs.writeFileSync(webhookLogPath, '[]', 'utf-8');

const loadMpOrders = () => { try { return JSON.parse(fs.readFileSync(mpOrdersPath, 'utf-8')); } catch { return []; } };
const saveMpOrders = (o) => fs.writeFileSync(mpOrdersPath, JSON.stringify(o, null, 2), 'utf-8');

// Log de auditoria das notificações recebidas — apenas metadados, nunca dados sensíveis.
const loadWebhookLog = () => { try { return JSON.parse(fs.readFileSync(webhookLogPath, 'utf-8')); } catch { return []; } };
const saveWebhookLog = (l) => fs.writeFileSync(webhookLogPath, JSON.stringify(l.slice(-500), null, 2), 'utf-8');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function appendWebhookLog(entry) {
  const log = loadWebhookLog();
  log.push({ at: new Date().toISOString(), ...entry });
  saveWebhookLog(log);
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

  // Só processamos notificações de pagamento — outros tópicos (merchant_order, etc.) são apenas confirmados.
  const topic = req.query.type || req.query.topic || (req.body && req.body.type);
  if (topic && topic !== 'payment') {
    appendWebhookLog({ type: 'topic_ignored', topic, requestId: xRequestId || null });
    return res.status(200).json({ received: true });
  }

  if (!dataId) {
    appendWebhookLog({ type: 'missing_data_id', requestId: xRequestId || null });
    return res.status(200).json({ received: true });
  }

  // Responde rápido ao MP; processamento já é síncrono e leve (JSON local), então
  // seguimos processando antes de responder — evita retrabalho de reprocessar notificação perdida.
  let mpPayment;
  try {
    const paymentClient = mercadopago.getPaymentClient();
    mpPayment = await paymentClient.get({ id: dataId });
  } catch (err) {
    console.error(`[MP-WEBHOOK] Falha ao consultar pagamento ${dataId}: ${err?.message || 'erro desconhecido'}`);
    appendWebhookLog({ type: 'fetch_failed', paymentId: String(dataId), requestId: xRequestId || null });
    // 200 evita retentativa agressiva por erro nosso; MP também reenvia periodicamente por conta própria.
    return res.status(200).json({ received: true, processed: false });
  }

  const orders = loadMpOrders();
  const idx = orders.findIndex(o => o.externalReference === mpPayment.external_reference);
  if (idx === -1) {
    appendWebhookLog({ type: 'order_not_found', paymentId: String(mpPayment.id), externalReference: mpPayment.external_reference || null });
    return res.status(200).json({ received: true, processed: false });
  }

  const order = orders[idx];
  const notificationKey = `${mpPayment.id}:${mpPayment.status}:${mpPayment.status_detail}`;

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
    appendWebhookLog({ type: 'amount_mismatch', paymentId: String(mpPayment.id), orderId: order.id });
    return res.status(200).json({ received: true, processed: false, reason: 'amount_mismatch' });
  }

  order.mpPaymentId       = String(mpPayment.id);
  order.mpPaymentMethodId = mpPayment.payment_method_id || order.mpPaymentMethodId;
  order.mpPaymentTypeId   = mpPayment.payment_type_id || order.mpPaymentTypeId;
  order.mpStatusDetail    = mpPayment.status_detail || null;
  order.status            = mpPayment.status; // approved | pending | in_process | rejected | cancelled | refunded | charged_back
  if (mpPayment.status === 'approved') {
    order.amountConfirmed = mpPayment.transaction_amount;
    if (!order.paidAt) order.paidAt = new Date().toISOString();
  }
  order.processedNotificationIds = [...(order.processedNotificationIds || []), notificationKey].slice(-50);
  order.auditLog.push({
    at: new Date().toISOString(),
    type: 'webhook_processed',
    details: `status=${mpPayment.status} statusDetail=${mpPayment.status_detail || ''}`,
  });
  order.updatedAt = new Date().toISOString();
  orders[idx] = order;
  saveMpOrders(orders);

  appendWebhookLog({ type: 'processed', paymentId: String(mpPayment.id), orderId: order.id, status: mpPayment.status });

  res.status(200).json({ received: true, processed: true });
});

module.exports = router;
