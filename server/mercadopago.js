// Integração Mercado Pago — Checkout Bricks (Payment Brick)
// Cliente oficial do SDK (pacote "mercadopago", v2) + validação de assinatura de webhook.
//
// Credenciais podem vir de duas fontes, nessa ordem de prioridade:
//   1. Variáveis de ambiente (MERCADO_PAGO_ACCESS_TOKEN, etc.) — usadas em produção.
//   2. Painel DevOps (/devops → Financeiro → Mercado Pago) — salvas em server/data/config.json,
//      pensado para facilitar configurar/trocar as credenciais sem mexer no .env / redeploy.
// A leitura é sempre dinâmica (nunca cacheada em módulo), para refletir mudanças feitas
// pelo painel sem precisar reiniciar o servidor.
//
// IMPORTANTE: este módulo nunca deve logar o Access Token nem o Webhook Secret.
// Apenas a Public Key pode circular no frontend.

const fs = require('fs');
const path = require('path');
const { MercadoPagoConfig, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError } = require('mercadopago');

const configPath = path.join(__dirname, 'data', 'config.json');
const loadAppConfig = () => { try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { return {}; } };

const FIELD_TO_ENV = {
  accessToken:   'MERCADO_PAGO_ACCESS_TOKEN',
  publicKey:     'MERCADO_PAGO_PUBLIC_KEY',
  webhookSecret: 'MERCADO_PAGO_WEBHOOK_SECRET',
  appUrl:        'APP_URL',
};

/**
 * Credenciais efetivas — env var vence; se ausente, cai para o painel DevOps.
 * source indica de onde cada campo veio, útil para exibir no painel.
 */
function getCreds() {
  const panel = loadAppConfig().mpConfig || {};
  const creds = {};
  const source = {};
  for (const [field, envKey] of Object.entries(FIELD_TO_ENV)) {
    const envVal = process.env[envKey];
    if (envVal && String(envVal).trim()) {
      creds[field] = String(envVal).trim();
      source[field] = 'env';
    } else if (panel[field] && String(panel[field]).trim()) {
      creds[field] = String(panel[field]).trim();
      source[field] = 'panel';
    } else {
      creds[field] = '';
      source[field] = null;
    }
  }
  return { creds, source };
}

function checkConfig() {
  const { creds, source } = getCreds();
  const missing = Object.entries(FIELD_TO_ENV)
    .filter(([field]) => !creds[field])
    .map(([, envKey]) => envKey);
  return { ok: missing.length === 0, missing, creds, source };
}

// Aviso único no boot — reflete o estado no momento em que o servidor sobe.
// Como a leitura é sempre dinâmica, configurar via painel depois resolve sem reiniciar.
(function logBootStatus() {
  const { ok, missing } = checkConfig();
  if (!ok) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('[MERCADO PAGO] Configuração incompleta — pagamentos via Mercado Pago DESATIVADOS.');
    console.error(`[MERCADO PAGO] Faltando: ${missing.join(', ')}`);
    console.error('[MERCADO PAGO] Configure em /devops → Financeiro → Mercado Pago, ou defina no .env.');
    console.error('[MERCADO PAGO] As rotas /api/payments/mercado-pago e /api/webhooks/mercado-pago');
    console.error('[MERCADO PAGO] responderão 503 até que a configuração seja completada.');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } else {
    console.log('[MERCADO PAGO] Configuração OK. Payment Brick habilitado.');
  }
})();

function getPaymentClient() {
  const { ok, creds } = checkConfig();
  if (!ok) throw new Error('Mercado Pago não está configurado no servidor.');
  const config = new MercadoPagoConfig({
    accessToken: creds.accessToken,
    options: { timeout: 15000 },
  });
  return new Payment(config);
}

// Somente a Public Key pode ser exposta ao frontend.
function getPublicKey() {
  const { creds } = getCreds();
  return creds.publicKey || null;
}

/**
 * Valida a assinatura do webhook usando o validador oficial do SDK.
 * Lança InvalidWebhookSignatureError quando a assinatura é inválida/ausente.
 */
function verifyWebhookSignature({ xSignature, xRequestId, dataId }) {
  const { creds } = getCreds();
  if (!creds.webhookSecret) throw new Error('Mercado Pago não está configurado no servidor.');
  WebhookSignatureValidator.validate({
    xSignature,
    xRequestId,
    dataId,
    secret: creds.webhookSecret,
    toleranceSeconds: 5 * 60,
  });
}

module.exports = {
  // Getter dinâmico — cada acesso reavalia env + config.json, refletindo mudanças
  // feitas no painel DevOps sem precisar reiniciar o servidor.
  get mpConfigured() { return checkConfig().ok; },
  get mpMissingVars() { return checkConfig().missing; },
  getAppUrl() { return getCreds().creds.appUrl || ''; },
  getCredsSource() { return checkConfig().source; },
  getPaymentClient,
  getPublicKey,
  verifyWebhookSignature,
  InvalidWebhookSignatureError,
};
