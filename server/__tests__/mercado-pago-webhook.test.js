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

test('webhook ignora tópicos diferentes de payment', async () => {
  const r = await fetch(`${baseUrl}/api/webhooks/mercado-pago?data.id=123&type=merchant_order`, {
    method: 'POST',
    headers: { 'x-signature': buildSignature('123', 'req-topic', process.env.MERCADO_PAGO_WEBHOOK_SECRET), 'x-request-id': 'req-topic' },
  });
  assert.equal(r.status, 200);
});
