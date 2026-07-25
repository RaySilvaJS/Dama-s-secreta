// Testes da rota de webhook do Mercado Pago.
// O SDK do Mercado Pago é sempre mockado — nenhuma chamada real à API é feita.

process.env.MERCADO_PAGO_ACCESS_TOKEN = 'TEST-access-token';
process.env.MERCADO_PAGO_PUBLIC_KEY = 'TEST-public-key';
process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.APP_URL = 'http://localhost:4000';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const mercadopago = require('../mercadopago');
const mpWebhookRouter = require('../mercadoPagoWebhook');

const mpOrdersPath = path.join(__dirname, '..', 'data', 'mp_orders.json');

let server, baseUrl, originalOrders;

test.before(async () => {
  originalOrders = fs.readFileSync(mpOrdersPath, 'utf-8');

  const app = express();
  app.use(express.json());
  app.use('/api/webhooks/mercado-pago', mpWebhookRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(async () => {
  fs.writeFileSync(mpOrdersPath, originalOrders);
  await new Promise((resolve) => server.close(resolve));
});

function loadOrders() { return JSON.parse(fs.readFileSync(mpOrdersPath, 'utf-8')); }
function saveOrders(o) { fs.writeFileSync(mpOrdersPath, JSON.stringify(o, null, 2)); }

function seedOrder(overrides = {}) {
  const orders = loadOrders();
  const order = {
    id: uuidv4(),
    externalReference: 'MPORD-' + uuidv4(),
    userId: 'seed-user',
    items: [{ id: 'X', name: 'Produto', unitPrice: 100, quantity: 1, lineTotal: 100 }],
    subtotal: 100,
    shippingCost: 0,
    couponCode: null,
    couponDiscount: 0,
    amountExpected: 100,
    amountConfirmed: null,
    currency: 'BRL',
    status: 'pending_payment',
    mpPaymentId: null,
    mpPaymentMethodId: null,
    mpPaymentTypeId: null,
    mpStatusDetail: null,
    attempts: [],
    processedNotificationIds: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  orders.push(order);
  saveOrders(orders);
  return order;
}

function buildSignature(dataId, requestId, secret, ts = Date.now()) {
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${hash}`;
}

function mockGet(fn) {
  mercadopago.getPaymentClient = () => ({ get: fn, create: async () => { throw new Error('não usado neste teste'); } });
}

function mockOrderGet(fn) {
  mercadopago.getOrderClient = () => ({ get: fn });
}

test('webhook rejeita assinatura ausente', async () => {
  const r = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=123&type=payment`, { method: 'POST', headers: { 'x-request-id': 'req-1' } });
  assert.equal(r.status, 401);
});

test('webhook rejeita assinatura inválida (secret errado)', async () => {
  const dataId = '999888';
  const requestId = 'req-invalid';
  const badSignature = buildSignature(dataId, requestId, 'secret-errado');
  const r = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: { 'x-signature': badSignature, 'x-request-id': requestId },
  });
  assert.equal(r.status, 401);
});

test('webhook válido atualiza o pedido para aprovado', async () => {
  const order = seedOrder({ amountExpected: 250, currency: 'BRL' });
  const dataId = '700001';
  const requestId = 'req-approved';
  const signature = buildSignature(dataId, requestId, process.env.MERCADO_PAGO_WEBHOOK_SECRET);

  mockGet(async ({ id }) => ({
    id: Number(id),
    status: 'approved',
    status_detail: 'accredited',
    payment_method_id: 'pix',
    payment_type_id: 'bank_transfer',
    transaction_amount: 250,
    currency_id: 'BRL',
    external_reference: order.externalReference,
  }));

  const r = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: { 'x-signature': signature, 'x-request-id': requestId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'payment.updated', data: { id: dataId } }),
  });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.processed, true);

  const saved = loadOrders().find(o => o.id === order.id);
  assert.equal(saved.status, 'approved');
  assert.equal(saved.amountConfirmed, 250);
  assert.ok(saved.paidAt);
});

test('webhook duplicado não reprocessa a mesma notificação', async () => {
  const order = seedOrder({ amountExpected: 80 });
  const dataId = '700002';
  const requestId = 'req-dup';
  const signature = buildSignature(dataId, requestId, process.env.MERCADO_PAGO_WEBHOOK_SECRET);

  mockGet(async ({ id }) => ({
    id: Number(id),
    status: 'approved',
    status_detail: 'accredited',
    payment_method_id: 'pix',
    transaction_amount: 80,
    currency_id: 'BRL',
    external_reference: order.externalReference,
  }));

  const first = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: { 'x-signature': signature, 'x-request-id': requestId },
  });
  const firstData = await first.json();
  assert.equal(firstData.processed, true);

  const second = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: { 'x-signature': signature, 'x-request-id': requestId },
  });
  const secondData = await second.json();
  assert.equal(secondData.processed, false);
  assert.equal(secondData.duplicate, true);

  const saved = loadOrders().find(o => o.id === order.id);
  assert.equal(saved.auditLog.filter(l => l.type === 'webhook_processed').length, 1);
});

test('webhook não aprova pedido quando o valor não confere com o esperado', async () => {
  const order = seedOrder({ amountExpected: 500 });
  const dataId = '700003';
  const requestId = 'req-mismatch';
  const signature = buildSignature(dataId, requestId, process.env.MERCADO_PAGO_WEBHOOK_SECRET);

  mockGet(async ({ id }) => ({
    id: Number(id),
    status: 'approved',
    status_detail: 'accredited',
    payment_method_id: 'visa',
    transaction_amount: 1, // valor divergente — tentativa de fraude/erro
    currency_id: 'BRL',
    external_reference: order.externalReference,
  }));

  const r = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: { 'x-signature': signature, 'x-request-id': requestId },
  });
  const data = await r.json();
  assert.equal(data.processed, false);
  assert.equal(data.reason, 'amount_mismatch');

  const saved = loadOrders().find(o => o.id === order.id);
  assert.equal(saved.status, 'pending_payment'); // não deve ter sido marcado como aprovado
});

test('webhook ignora tópicos diferentes de payment/order', async () => {
  const r = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=123&type=merchant_order`, {
    method: 'POST',
    headers: { 'x-signature': buildSignature('123', 'req-topic', process.env.MERCADO_PAGO_WEBHOOK_SECRET), 'x-request-id': 'req-topic' },
  });
  assert.equal(r.status, 200);
});

// ── GET de diagnóstico ───────────────────────────────────────────────────────

test('GET /api/webhooks/mercado-pago retorna diagnóstico sem expor credenciais', async () => {
  const r = await fetch(`${baseUrl}/api/webhooks/mercado-pago`);
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.status, 'online');
  assert.equal(data.configured, true);
  assert.equal(JSON.stringify(data).includes(process.env.MERCADO_PAGO_ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(data).includes(process.env.MERCADO_PAGO_WEBHOOK_SECRET), false);
});

// ── Tópico "order" (Orders API) ─────────────────────────────────────────────

test('webhook de order (Orders API) aprova o pedido a partir de status "processed"', async () => {
  const order = seedOrder({ amountExpected: 300, currency: 'BRL' });
  const dataId = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
  const requestId = 'req-order-approved';
  const signature = buildSignature(dataId, requestId, process.env.MERCADO_PAGO_WEBHOOK_SECRET);

  mockOrderGet(async ({ id }) => ({
    id,
    status: 'processed',
    status_detail: 'accredited',
    total_amount: '300.00',
    currency: 'BRL',
    external_reference: order.externalReference,
    transactions: {
      payments: [
        { id: 'PAY01JS2V6CM8KJ0EC4H504R7YE34', status: 'processed', status_detail: 'accredited', amount: '300.00', payment_method: { id: 'pix', type: 'bank_transfer' } },
      ],
    },
  }));

  const r = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataId}&type=order`, {
    method: 'POST',
    headers: { 'x-signature': signature, 'x-request-id': requestId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'order.updated', type: 'order', data: { id: dataId } }),
  });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.processed, true);

  const saved = loadOrders().find(o => o.id === order.id);
  assert.equal(saved.status, 'approved');
  assert.equal(saved.mpOrderId, dataId);
  assert.equal(saved.mpPaymentId, 'PAY01JS2V6CM8KJ0EC4H504R7YE34');
  assert.equal(saved.mpPaymentMethodId, 'pix');
  assert.equal(saved.amountConfirmed, 300);
  assert.ok(saved.paidAt);
});

test('webhook de order mapeia "action_required" para pending e "failed" para rejected', async () => {
  const orderPending = seedOrder({ amountExpected: 40 });
  const dataIdPending = 'ORD-pending-1';
  const sigPending = buildSignature(dataIdPending, 'req-order-pending', process.env.MERCADO_PAGO_WEBHOOK_SECRET);
  mockOrderGet(async ({ id }) => ({
    id, status: 'action_required', status_detail: 'waiting_payment', total_amount: '40.00', currency: 'BRL',
    external_reference: orderPending.externalReference, transactions: { payments: [] },
  }));
  await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataIdPending}&type=order`, {
    method: 'POST', headers: { 'x-signature': sigPending, 'x-request-id': 'req-order-pending' },
  });
  assert.equal(loadOrders().find(o => o.id === orderPending.id).status, 'pending');

  const orderFailed = seedOrder({ amountExpected: 40 });
  const dataIdFailed = 'ORD-failed-1';
  const sigFailed = buildSignature(dataIdFailed, 'req-order-failed', process.env.MERCADO_PAGO_WEBHOOK_SECRET);
  mockOrderGet(async ({ id }) => ({
    id, status: 'failed', status_detail: 'cc_rejected_other_reason', total_amount: '40.00', currency: 'BRL',
    external_reference: orderFailed.externalReference, transactions: { payments: [] },
  }));
  await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataIdFailed}&type=order`, {
    method: 'POST', headers: { 'x-signature': sigFailed, 'x-request-id': 'req-order-failed' },
  });
  assert.equal(loadOrders().find(o => o.id === orderFailed.id).status, 'rejected');
});

test('webhook de order não aprova quando o valor total diverge do esperado', async () => {
  const order = seedOrder({ amountExpected: 999 });
  const dataId = 'ORD-mismatch-1';
  const signature = buildSignature(dataId, 'req-order-mismatch', process.env.MERCADO_PAGO_WEBHOOK_SECRET);

  mockOrderGet(async ({ id }) => ({
    id, status: 'processed', status_detail: 'accredited', total_amount: '1.00', currency: 'BRL',
    external_reference: order.externalReference, transactions: { payments: [] },
  }));

  const r = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataId}&type=order`, {
    method: 'POST',
    headers: { 'x-signature': signature, 'x-request-id': 'req-order-mismatch' },
  });
  const data = await r.json();
  assert.equal(data.processed, false);
  assert.equal(data.reason, 'amount_mismatch');
  assert.equal(loadOrders().find(o => o.id === order.id).status, 'pending_payment');
});

test('webhook de order é idempotente para a mesma notificação', async () => {
  const order = seedOrder({ amountExpected: 60 });
  const dataId = 'ORD-dup-1';
  const signature = buildSignature(dataId, 'req-order-dup', process.env.MERCADO_PAGO_WEBHOOK_SECRET);

  mockOrderGet(async ({ id }) => ({
    id, status: 'processed', status_detail: 'accredited', total_amount: '60.00', currency: 'BRL',
    external_reference: order.externalReference, transactions: { payments: [] },
  }));

  await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataId}&type=order`, {
    method: 'POST', headers: { 'x-signature': signature, 'x-request-id': 'req-order-dup' },
  });
  const second = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=${dataId}&type=order`, {
    method: 'POST', headers: { 'x-signature': signature, 'x-request-id': 'req-order-dup' },
  });
  const secondData = await second.json();
  assert.equal(secondData.duplicate, true);

  const saved = loadOrders().find(o => o.id === order.id);
  assert.equal(saved.auditLog.filter(l => l.type === 'webhook_processed').length, 1);
});
