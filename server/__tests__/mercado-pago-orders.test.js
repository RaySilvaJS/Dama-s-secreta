// Testes das rotas de pedido/pagamento do Mercado Pago.
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
const express = require('express');

const mercadopago = require('../mercadopago');
const mpOrdersRouter = require('../mercadoPagoOrders');

const usersPath    = path.join(__dirname, '..', 'data', 'users.json');
const mpOrdersPath = path.join(__dirname, '..', 'data', 'mp_orders.json');
const productsPath = path.join(__dirname, '..', 'data', 'loja.json');

const TEST_PRODUCT_ID = 'TESTE-PIX-1REAL';
const TEST_TOKEN  = 'test-token-mp-orders';
const TEST_USER_ID = 'test-user-mp-orders';
const OTHER_TOKEN  = 'other-token-mp-orders';
const OTHER_USER_ID = 'other-user-mp-orders';

let server, baseUrl, originalUsers, originalOrders, productPrice;

test.before(async () => {
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
  const product = products.find(p => p.id === TEST_PRODUCT_ID);
  assert.ok(product, `Produto de teste "${TEST_PRODUCT_ID}" deve existir em loja.json`);
  productPrice = product.price;

  originalUsers  = fs.readFileSync(usersPath, 'utf-8');
  originalOrders = fs.readFileSync(mpOrdersPath, 'utf-8');

  const users = JSON.parse(originalUsers);
  users.push({ id: TEST_USER_ID, nome: 'Teste MP', email: 'teste-mp-orders@example.com', cpf: '11111111111', token: TEST_TOKEN, createdAt: new Date().toISOString() });
  users.push({ id: OTHER_USER_ID, nome: 'Outro MP', email: 'outro-mp-orders@example.com', token: OTHER_TOKEN, createdAt: new Date().toISOString() });
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

  const app = express();
  app.use(express.json());
  app.use('/api/payments/mercado-pago', mpOrdersRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

test.after(async () => {
  fs.writeFileSync(usersPath, originalUsers);
  fs.writeFileSync(mpOrdersPath, originalOrders);
  await new Promise((resolve) => server.close(resolve));
});

async function createOrder(token, items, extra = {}) {
  const r = await fetch(`${baseUrl}/api/payments/mercado-pago/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
    body: JSON.stringify({ items, ...extra }),
  });
  const data = await r.json();
  return { status: r.status, data };
}

function mockPaymentClient({ create, get } = {}) {
  mercadopago.getPaymentClient = () => ({
    create: create || (async () => { throw new Error('create não mockado'); }),
    get: get || (async () => { throw new Error('get não mockado'); }),
  });
}

// ── Criação de pedido ───────────────────────────────────────────────────────

test('POST /orders exige autenticação', async () => {
  const r = await fetch(`${baseUrl}/api/payments/mercado-pago/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ id: TEST_PRODUCT_ID, quantidade: 1 }] }),
  });
  assert.equal(r.status, 401);
});

test('POST /orders rejeita pedido sem itens', async () => {
  const { status, data } = await createOrder(TEST_TOKEN, []);
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('POST /orders rejeita produto inexistente', async () => {
  const { status, data } = await createOrder(TEST_TOKEN, [{ id: 'produto-que-nao-existe-xyz', quantidade: 1 }]);
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('POST /orders calcula o valor a partir do catálogo no servidor, ignorando preço enviado pelo cliente', async () => {
  const quantidade = 3;
  const { status, data } = await createOrder(TEST_TOKEN, [
    { id: TEST_PRODUCT_ID, quantidade, price: 999999 }, // "price" forjado deve ser ignorado
  ]);
  assert.equal(status, 200);
  assert.equal(data.success, true);
  const expected = Math.round(productPrice * quantidade * 100) / 100;
  assert.equal(data.amount, expected);
  assert.ok(data.orderId);
});

// ── Criação de pagamento ────────────────────────────────────────────────────

test('POST / retorna 404 para pedido inexistente', async () => {
  const r = await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': TEST_TOKEN },
    body: JSON.stringify({ orderId: 'pedido-inexistente-000', formData: { payment_method_id: 'pix' } }),
  });
  assert.equal(r.status, 404);
});

test('POST / retorna 403 quando o pedido pertence a outro usuário', async () => {
  const { data: order } = await createOrder(TEST_TOKEN, [{ id: TEST_PRODUCT_ID, quantidade: 1 }]);
  const r = await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': OTHER_TOKEN },
    body: JSON.stringify({ orderId: order.orderId, formData: { payment_method_id: 'pix' } }),
  });
  assert.equal(r.status, 403);
});

test('POST / — pagamento aprovado atualiza o status do pedido', async () => {
  const { data: order } = await createOrder(TEST_TOKEN, [{ id: TEST_PRODUCT_ID, quantidade: 1 }]);
  mockPaymentClient({
    create: async ({ body }) => ({
      id: 555001,
      status: 'approved',
      status_detail: 'accredited',
      payment_method_id: 'visa',
      payment_type_id: 'credit_card',
      transaction_amount: body.transaction_amount,
    }),
  });

  const r = await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': TEST_TOKEN },
    body: JSON.stringify({ orderId: order.orderId, formData: { payment_method_id: 'visa', token: 'card-token-abc', installments: 1 } }),
  });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.status, 'approved');
  assert.equal(data.paymentId, '555001');

  const orders = JSON.parse(fs.readFileSync(mpOrdersPath, 'utf-8'));
  const saved = orders.find(o => o.id === order.orderId);
  assert.equal(saved.status, 'approved');
  assert.equal(saved.amountConfirmed, order.amount);
});

test('POST / — pagamento pendente (Pix) retorna QR code e código copia-e-cola', async () => {
  const { data: order } = await createOrder(TEST_TOKEN, [{ id: TEST_PRODUCT_ID, quantidade: 1 }]);
  mockPaymentClient({
    create: async ({ body }) => ({
      id: 555002,
      status: 'pending',
      status_detail: 'pending_waiting_transfer',
      payment_method_id: 'pix',
      payment_type_id: 'bank_transfer',
      transaction_amount: body.transaction_amount,
      point_of_interaction: {
        transaction_data: {
          qr_code: '000201...copia-e-cola...6304ABCD',
          qr_code_base64: 'iVBORw0KGgoAAAANSU',
          ticket_url: 'https://mercadopago.com/ticket/555002',
        },
      },
    }),
  });

  const r = await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': TEST_TOKEN },
    body: JSON.stringify({ orderId: order.orderId, formData: { payment_method_id: 'pix' } }),
  });
  const data = await r.json();
  assert.equal(data.status, 'pending');
  assert.ok(data.pix);
  assert.equal(data.pix.qrCode, '000201...copia-e-cola...6304ABCD');
  assert.ok(data.pix.qrCodeBase64);
});

test('POST / — pagamento recusado retorna status rejected e status_detail', async () => {
  const { data: order } = await createOrder(TEST_TOKEN, [{ id: TEST_PRODUCT_ID, quantidade: 1 }]);
  mockPaymentClient({
    create: async ({ body }) => ({
      id: 555003,
      status: 'rejected',
      status_detail: 'cc_rejected_insufficient_amount',
      payment_method_id: 'visa',
      transaction_amount: body.transaction_amount,
    }),
  });

  const r = await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': TEST_TOKEN },
    body: JSON.stringify({ orderId: order.orderId, formData: { payment_method_id: 'visa', token: 'card-token-def', installments: 1 } }),
  });
  const data = await r.json();
  assert.equal(data.success, true); // a chamada em si funcionou — o pagamento é que foi recusado
  assert.equal(data.status, 'rejected');
  assert.equal(data.statusDetail, 'cc_rejected_insufficient_amount');
});

test('POST / — idempotência: a mesma tentativa reaproveita a mesma idempotency key', async () => {
  const { data: order } = await createOrder(TEST_TOKEN, [{ id: TEST_PRODUCT_ID, quantidade: 1 }]);
  const seenKeys = [];
  mockPaymentClient({
    create: async ({ body, requestOptions }) => {
      seenKeys.push(requestOptions.idempotencyKey);
      return {
        id: 555004,
        status: 'in_process',
        status_detail: 'pending_review_manual',
        payment_method_id: 'visa',
        transaction_amount: body.transaction_amount,
      };
    },
  });

  const formData = { payment_method_id: 'visa', token: 'same-card-token', installments: 2 };
  await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': TEST_TOKEN },
    body: JSON.stringify({ orderId: order.orderId, formData }),
  });
  await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': TEST_TOKEN },
    body: JSON.stringify({ orderId: order.orderId, formData }),
  });

  assert.equal(seenKeys.length, 2);
  assert.equal(seenKeys[0], seenKeys[1]);

  // Uma tentativa diferente (token novo) deve gerar uma chave diferente
  await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': TEST_TOKEN },
    body: JSON.stringify({ orderId: order.orderId, formData: { ...formData, token: 'different-card-token' } }),
  });
  assert.notEqual(seenKeys[0], seenKeys[2] || undefined);
});

test('POST / bloqueia nova cobrança quando o pedido já está aprovado', async () => {
  const { data: order } = await createOrder(TEST_TOKEN, [{ id: TEST_PRODUCT_ID, quantidade: 1 }]);
  mockPaymentClient({
    create: async ({ body }) => ({ id: 555005, status: 'approved', status_detail: 'accredited', payment_method_id: 'pix', transaction_amount: body.transaction_amount }),
  });
  await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': TEST_TOKEN },
    body: JSON.stringify({ orderId: order.orderId, formData: { payment_method_id: 'pix' } }),
  });

  const r2 = await fetch(`${baseUrl}/api/payments/mercado-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': TEST_TOKEN },
    body: JSON.stringify({ orderId: order.orderId, formData: { payment_method_id: 'pix' } }),
  });
  assert.equal(r2.status, 409);
});
