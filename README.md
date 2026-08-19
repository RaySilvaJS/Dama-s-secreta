
# 🌸 DAMA'S SECRETA — Loja Online

E-commerce de lingerie e moda íntima com catálogo dinâmico, carrinho de compras (com variação de tamanho/cor), pagamentos via PIX/Mercado Pago, painel administrativo (DevOps) e atendimento via WhatsApp.

## ✨ Funcionalidades

### 🛍️ Catálogo de Produtos
- Grid responsivo alimentado por `public/data/loja.json` (gerenciado pelo Catalog Manager do DevOps)
- Cards com badges: "Novo", "Promoção", "Estoque Baixo", "Frete Grátis"
- Rating visual com ⭐
- Preço original vs. desconto ("De: / Por:")
- Variações de cor e tamanho por produto

### 🔍 Página de Produto
- Galeria com miniaturas e zoom
- Seleção de variação (cor/tamanho) refletida no carrinho
- Produtos relacionados

### 🛒 Carrinho de Compras
- Adicionar/remover produtos (linhas separadas por tamanho)
- Ajustar quantidades
- Drawer lateral (mobile-friendly) + página de carrinho dedicada
- Persistência com LocalStorage
- Checkout com cálculo de frete (Melhor Envio)

### ❤️ Favoritos
- Sistema de favoritos persistido em LocalStorage (`favorites`)
- Notificações ao adicionar/remover

### 💬 Chat WhatsApp
- Widget de chat flutuante
- Bot via Baileys (grupo administrativo) com resposta contextual por pedido

### 🔐 Contas e Pedidos
- Cadastro/login de clientes (token de sessão)
- Histórico de pedidos ("Meus Pedidos")

### 🛠️ Painel DevOps
- Acessível em `/devops`, autenticado por `ADMIN_TOKEN`
- Catalog Manager, gestão de pedidos, usuários, cupons, segurança (bloqueio de IP), logs e analytics

## 🚀 Instalação

### Pré-requisitos
- Node.js 14+
- npm

### Setup

```bash
# Clonar repositório
git clone <seu-repo>
cd damas-secreta-site

# Instalar dependências
npm install

# Rodar em desenvolvimento
npm run dev

# Rodar em produção
npm start
```

Acesse: **http://localhost:4000**

## 📁 Estrutura

```
damas-secreta-site/
├── public/
│   ├── index.html          # Página principal
│   ├── product.html        # Página de produto
│   ├── cart.html           # Carrinho
│   ├── checkout.html       # Checkout
│   ├── devops/index.html   # Painel administrativo
│   ├── app.js, cart.js     # Lógica principal / carrinho
│   ├── pages/               # JS por página (index-*.js, product-*.js)
│   ├── js/                 # Módulos auxiliares (auth, checkout, payment...)
│   └── data/loja.json      # Catálogo de produtos (espelho de server/data/loja.json)
├── server/
│   ├── index.js            # Servidor Express (rotas principais)
│   ├── admin.js            # API do painel DevOps
│   ├── payment.js          # Pagamentos/pedidos
│   ├── whatsapp.js         # Bot Baileys
│   └── data/                # Persistência em JSON (loja.json, users.json, payments.json...)
└── package.json
```

## 🔧 API Endpoints

### Produtos
- `GET /api/products` - Listar produtos (com filtros)
- `GET /api/catalog/product/:id` - Detalhes do produto (+ variações e relacionados)

### Chat
- `POST /api/chat` - Enviar mensagem via WhatsApp

### Admin (`/api/admin/*`)
- Autenticado por `ADMIN_TOKEN` — ver `server/admin.js`

### Pagamentos Mercado Pago (ver seção dedicada abaixo)
- `GET  /api/payments/mercado-pago/config` - Public Key + status da configuração
- `POST /api/payments/mercado-pago/orders` - Cria pedido (valor calculado no servidor)
- `POST /api/payments/mercado-pago` - Cria o pagamento a partir do Payment Brick
- `GET  /api/payments/mercado-pago/:paymentId/status` - Consulta status (autenticado, dono do pedido)
- `POST /api/webhooks/mercado-pago` - Webhook de notificações (tópicos `payment` e `order`, assinatura validada)
- `GET  /api/webhooks/mercado-pago` - Diagnóstico público (endpoint online? credenciais configuradas?) — sem expor segredos

## 📊 Estrutura de Dados

### Product Object
```json
{
  "id": "MLB7131903700",
  "name": "Pijama Croped Manga Longa",
  "model": "Pijama croped longo",
  "price": 72.19,
  "priceOriginal": 75,
  "condition": "Novo",
  "color": "Rosa",
  "stock": 1,
  "sold": false,
  "rating": 5,
  "reviews": 1,
  "isNew": true,
  "isPromo": true,
  "promoPercent": 5,
  "images": ["url1", "url2", "url3"],
  "specs": {
    "Marca": "Elegante",
    "Gênero": "Feminino",
    "Material principal": "Poliéster com elastano"
  },
  "description": "Conjunto de 2 peças..."
}
```

## 🌐 Requisitos de Browser

- Chrome/Edge (últimas 2 versões)
- Firefox (últimas 2 versões)
- Safari (últimas 2 versões)
- Mobile browsers

## 🔐 Variáveis de Ambiente

Ver `.env.example` para a lista completa (WhatsApp, Mercado Pago, Melhor Envio, Telegram, ADMIN_TOKEN etc.).

## 📝 Customização

### Editar Produtos
1. Acesse `/devops` → Catalog Manager, ou
2. Edite diretamente `server/data/loja.json` e reinicie o servidor

### Mudar Cores
Cada página HTML define suas próprias variáveis CSS inline (`:root`), não há folha de estilo compartilhada exceto `styles.css` (usado pelo `admin.html`):
```css
:root {
  --blue: #2563EB;
  --yellow: #F59E0B;
  --green: #16A34A;
  --bg: #F1F5F9;
}
```

## 💳 Pagamentos via Mercado Pago (Checkout Bricks — Payment Brick)

Integração adicional de pagamento, que convive com o fluxo manual existente (PIX próprio + aprovação via WhatsApp). O cliente pode escolher a opção **"Cartão, Pix ou Boleto"** no checkout, que processa o pagamento automaticamente via Mercado Pago.

**Fluxo completo:** Payment Brick (tokeniza os dados) → etapa de revisão e confirmação própria (nosso modal, não depende do Review Flow nativo do Brick, que hoje não é garantido para o Brasil) → criação do pagamento no backend (com suporte a 3DS 2.0) → tela de resultado com o **Status Screen Brick** oficial (mostra aprovado/pendente/recusado, QR Pix, boleto e o desafio 3DS quando o emissor exige).

**Fora do escopo desta versão, por decisão explícita:** não salvamos cartões (`CardToken`/`CustomerCard`) nem criamos clientes no Mercado Pago (`Customer`) — cada pagamento usa um token de cartão avulso, de uso único, gerado pelo próprio Brick.

### Pacotes instalados
- `mercadopago` (SDK oficial Node.js v2) — cliente da API, criação/consulta de pagamentos e validação de assinatura de webhook.
- Frontend: SDK oficial via `<script src="https://sdk.mercadopago.com/js/v2"></script>` (Checkout Bricks — Payment Brick + Status Screen Brick), carregado em `public/checkout.html` e `public/pagamento-mercadopago.html`.

### Arquivos criados
- `server/mercadopago.js` — configuração do cliente, validação das credenciais (env + painel), validação de assinatura de webhook.
- `server/mercadoPagoOrders.js` — rotas `POST /api/payments/mercado-pago/orders`, `POST /api/payments/mercado-pago` (com `three_d_secure_mode: 'optional'` para pagamentos com cartão), `GET /api/payments/mercado-pago/:paymentId/status`, `GET /api/payments/mercado-pago/config`.
- `server/mercadoPagoWebhook.js` — `POST /api/webhooks/mercado-pago` (tópicos `payment` e `order`) + `GET /api/webhooks/mercado-pago` (diagnóstico, sem credenciais).
- `server/data/mp_orders.json` — pedidos do fluxo Mercado Pago (gerado automaticamente; ignorado pelo git).
- `public/js/mercadopago-checkout.js` — monta/desmonta o Payment Brick, cria o pedido, mostra a etapa de revisão/confirmação antes de cobrar, envia o pagamento, trata erros/retry.
- `public/pagamento-mercadopago.html` — tela de resultado que monta o **Status Screen Brick** oficial (aprovado/pendente/recusado, Pix, boleto, desafio 3DS), com checagem de que o pagamento pertence ao usuário logado antes de exibir.
- `server/__tests__/mercado-pago-orders.test.js`, `server/__tests__/mercado-pago-webhook.test.js` — testes automatizados (SDK sempre mockado).

### Etapa de revisão e confirmação
O Payment Brick nativo tem um "Review Flow" opcional (`customization.enableReviewStep`), mas a documentação oficial não confirma disponibilidade para o Brasil. Por isso, implementamos a nossa própria etapa de revisão: quando o Brick tokeniza os dados (`onSubmit`), um modal (`#co-mp-review-modal` em `checkout.html`) mostra os itens, o endereço de entrega, a forma de pagamento escolhida e o total antes de qualquer cobrança ser efetivada. Se o cliente clicar em "Voltar", nada é enviado ao Mercado Pago e o Brick volta ao estado editável.

### 3DS 2.0 (autenticação de cartão)
Toda cobrança com token de cartão é criada com `three_d_secure_mode: 'optional'` — o próprio emissor decide, com base no risco, se pede o desafio (challenge). Quando pede, a resposta do Mercado Pago vem com `status: 'pending'`, `status_detail: 'pending_challenge'` e um objeto `three_ds_info` (`external_resource_url` + `creq`), que o backend repassa ao frontend como `threeDsInfo`. Na tela de resultado, esses dois campos são passados para o **Status Screen Brick**, que renderiza e conduz o desafio do banco automaticamente — não construímos nenhuma UI de challenge manualmente.

### Webhook — tópicos `payment` e `order`
`POST /api/webhooks/mercado-pago` aceita as notificações de dois tópicos, cada um consultando a API correspondente antes de confiar em qualquer dado:
- **`payment`** (Payments API) — consulta `GET /v1/payments/:id` via `paymentClient.get()`. É o tópico usado hoje pela criação de pagamento deste app (`server/mercadoPagoOrders.js`, que chama `POST /v1/payments`).
- **`order`** (Orders API) — consulta `GET /v1/orders/:id` via `orderClient.get()`. Os status da Orders API (`created`, `processing`, `processed`, `action_required`, `canceled`, `expired`, `failed`, `refunded`, `charged_back`) são mapeados para o mesmo vocabulário interno já usado pelo tópico `payment` (`mapOrderApiStatus()` em `mercadoPagoWebhook.js`).

Em ambos os casos: idempotência por `topic:id:status:statusDetail` (gravado em `processedNotificationIds`), comparação de valor + moeda contra o pedido interno (`external_reference`) antes de aprovar, e nenhuma tentativa de "confiar" no corpo da notificação — o servidor sempre busca o dado oficial no Mercado Pago.

> **Importante — acoplamento com a criação de pagamento:** a criação de pagamento deste app hoje usa a **Payments API** (`POST /v1/payments`), não a Orders API. Isso significa que o Mercado Pago só vai mandar notificações `type=order` para pagamentos que tenham sido criados via `POST /v1/orders` — o que este app ainda não faz. O suporte ao tópico `order` no webhook está pronto e testado (veja `server/__tests__/mercado-pago-webhook.test.js`), mas só vai receber tráfego real se/quando a criação de pagamento for migrada para a Orders API. Migrar a criação é uma mudança maior (a Payment Brick com Orders API monta `transactions.payments[]` em vez de campos soltos) que não foi feita nesta rodada para não arriscar quebrar o fluxo de cartão/Pix/3DS já testado — avise se quiser que eu faça essa migração também.

### Diagnóstico do webhook
`GET /api/webhooks/mercado-pago` (sem autenticação) retorna `{ status: "online", configured: true|false, time }` — útil para confirmar que a rota está publicada e acessível, sem expor nenhuma credencial.

### Arquivos alterados
`server/index.js` (rotas montadas + webhook liberado durante manutenção), `server/admin.js` (rotas `GET/POST /api/admin/mercadopago-config`), `public/devops/index.html` (card de configuração na aba Financeiro), `public/checkout.html` (novo método de pagamento + container do Brick), `public/js/checkout.js` (seleção do método, contexto do pedido, redirecionamento pós-pagamento), `.env`, `.env.example`, `package.json` (dependência + script `test`).

### Onde configurar as credenciais

Há duas formas, e **a variável de ambiente sempre vence** quando definida:

1. **Painel DevOps (recomendado para o dia a dia)** — acesse `/devops` → aba **Financeiro** → card **"Mercado Pago — Cartão / Pix / Boleto"**. Preencha Access Token, Public Key, Webhook Secret e URL do site, e salve. Aplica na hora, sem reiniciar o servidor. Fica salvo em `server/data/config.json` (arquivo local, fora do git, nunca exposto ao frontend — só a Public Key circula no cliente).
2. **Variáveis de ambiente** (`.env`) — para produção/deploy automatizado:

```bash
MERCADO_PAGO_ACCESS_TOKEN=       # NUNCA exponha no frontend — apenas no servidor
MERCADO_PAGO_PUBLIC_KEY=         # Pode ir ao frontend — usada para inicializar o Brick
MERCADO_PAGO_WEBHOOK_SECRET=     # Chave secreta de assinatura do webhook
APP_URL=http://localhost:4000    # Usada para montar a notification_url do webhook
```

Se nenhuma das duas fontes tiver todos os 4 campos preenchidos, o servidor imprime um aviso claro no boot (e o card no DevOps mostra "⚠ Incompleto") e as rotas `/api/payments/mercado-pago*` e `/api/webhooks/mercado-pago` respondem `503` — o restante do site continua funcionando normalmente.

### Como obter as credenciais
1. Acesse o [painel de desenvolvedores do Mercado Pago](https://www.mercadopago.com.br/developers/panel/app) e crie/selecione uma aplicação.
2. Em **Credenciais de teste**, copie o `Access Token` e a `Public Key`. Use sempre credenciais **TEST-** em desenvolvimento.
3. Em **Sua integração → Webhooks**, configure a URL `https://SEU_DOMINIO/api/webhooks/mercado-pago` e copie a **Chave secreta de assinatura**.
4. Cole os 4 valores no card do DevOps (ou no `.env`, conforme a seção acima).

### Como configurar o evento "Order" no painel
Em **Sua integração → Webhooks → Configurar notificações**, marque os eventos que você quer receber. Para o tópico `order` (Orders API), marque a opção **"Orders"** (pode aparecer como "Pedidos" ou listada junto de "Pagamentos", dependendo da região/idioma do painel). Deixe também **"Pagamentos"** marcado — é o tópico `payment` que o app usa hoje de fato (ver aviso de acoplamento acima). Depois de salvar, o Mercado Pago te dá a opção de simular/testar o envio de uma notificação para essa URL direto do painel.

### Testando com HTTPS/túnel local
O Mercado Pago não notifica webhooks para `localhost`. Para testar localmente:
```bash
npx localtunnel --port 4000   # ou ngrok http 4000
```
Use a URL pública gerada como `APP_URL` no `.env` e cadastre `https://SUA-URL/api/webhooks/mercado-pago` no painel de Webhooks do Mercado Pago.

### Testando Pix, cartão e 3DS (modo teste)
- **Pix:** escolha Pix no Brick → confirme na etapa de revisão → o **Status Screen Brick**, na tela de resultado, mostra o QR Code e o código copia-e-cola nativamente.
- **Cartão:** use os [cartões de teste oficiais do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-api/additional-content/your-integrations/test/cards) (ex.: `APRO` no nome do titular aprova, `OTHE` recusa).
- **3DS:** em contas de teste, o Mercado Pago disponibiliza cartões que forçam o desafio (`pending_challenge`) para validar o fluxo completo — consulte a documentação oficial de "Integrate 3DS with Checkout Bricks" para os números específicos, já que mudam com frequência. Quando o desafio é exigido, ele aparece dentro do Status Screen Brick na tela de resultado.

### Rodando os testes
```bash
npm test
```
Os testes usam `node:test` (nativo do Node, sem dependência nova) e **mockam o SDK do Mercado Pago** — nenhuma cobrança real é feita. Cobrem: validação/cálculo do pedido, autorização entre usuários, idempotência, aprovação/pendência/recusa, Pix, envio de `three_d_secure_mode` e repasse de `threeDsInfo` em desafios 3DS, assinatura de webhook (válida/inválida/duplicada) e divergência de valor.

### Checklist antes de ir para produção
- [ ] Trocar `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_PUBLIC_KEY` pelas credenciais de **produção** (sem prefixo `TEST-`) — feito apenas pelo `.env`, sem alterar código.
- [ ] Atualizar `APP_URL` para o domínio real (HTTPS).
- [ ] Recadastrar a URL de webhook de produção no painel do Mercado Pago e gerar uma nova `MERCADO_PAGO_WEBHOOK_SECRET`.
- [ ] Rodar `npm test` e conferir os fluxos de Pix/cartão manualmente em produção com um pedido de baixo valor.
- [ ] Confirmar que `.env` com as credenciais reais não é exposto publicamente (ver observação de segurança abaixo).

> **Observação de segurança:** hoje o `.env` deste projeto é versionado no git intencionalmente (é assim que o `deploy.sh` leva variáveis de ambiente ao servidor via `git reset --hard`). Isso significa que qualquer credencial colocada nele fica no histórico do repositório. Para o Mercado Pago, isso é aceitável apenas enquanto as credenciais forem de **teste**; antes de colocar credenciais de **produção**, reavalie esse mecanismo (ex.: mover segredos para fora do git e ajustar o `deploy.sh`).

## 🚢 Deploy

### Vercel
```bash
npm install -g vercel
vercel
```

### Heroku
```bash
heroku create your-app
git push heroku main
```

### Docker
```bash
docker build -t damas-secreta-site .
docker run -p 4000:4000 damas-secreta-site
```

## 📞 Suporte

- Email: suporte@dama-secreta.com
- WhatsApp: Clique no widget do site
- Issues: GitHub

## 📄 Licença

MIT License - veja LICENSE para detalhes

## 🙏 Agradecimentos

- Express.js
- Swiper.js
- Google Fonts (Inter, Space Grotesk)
- WhatsApp API

---

**Desenvolvido com ❤️ para DAMA'S SECRETA**
