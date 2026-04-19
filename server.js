const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');

const app = express();
app.use(cors());

// ── Variáveis de ambiente ────────────────────────────────────────
// Defina no Render/Railway:
//   CASHINPAY_API_KEY     = sk_live_...
//   CASHINPAY_WEBHOOK_SECRET = whsec_...
const API_KEY        = process.env.CASHINPAY_API_KEY;
const WEBHOOK_SECRET = process.env.CASHINPAY_WEBHOOK_SECRET;
const BASE_URL       = 'https://api.cashinpaybr.com/api/v1';

// ── Log helper ───────────────────────────────────────────────────
function log(label, obj) {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(obj, null, 2));
}

// ── Headers padrão ───────────────────────────────────────────────
function headers() {
  return {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type':  'application/json'
  };
}

// ── JSON parser (exceto na rota de webhook que precisa do raw) ───
app.use((req, res, next) => {
  if (req.path === '/webhook') return next(); // webhook lê raw
  express.json()(req, res, next);
});

// ================= PIX — criar cobrança =================
// Chamado pelo pagamento.html ao clicar "Gerar QR Code PIX"
app.post('/pagar', async (req, res) => {
  const { total, nome, telefone, customer, items } = req.body;

  // Monta ID único para correlacionar com o webhook
  const transactionId = 'pedido_' + Date.now();

  const payload = {
    amount:         total,                          // valor em reais (ex: 29.99)
    transaction_id: transactionId,
    description:    'Pedido EaiBurguer',
    customer: {
      name:     customer?.name  || nome || 'Cliente',
      email:    customer?.email || (nome || 'cliente').toLowerCase().replace(/\s+/g, '') + '@eaiburguer.com',
      phone:    customer?.phone || (telefone || '11999999999').replace(/\D/g, ''),
      document: customer?.document?.number || '52998224725' // CPF — envie o real quando disponível
    }
  };

  log('PAYLOAD CASHINPAY', payload);

  try {
    const response = await fetch(`${BASE_URL}/transactions`, {
      method:  'POST',
      headers: headers(),
      body:    JSON.stringify(payload)
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
      log('RESPOSTA CASHINPAY (status ' + response.status + ')', data);
    } catch {
      return res.status(500).json({ error: 'Resposta invalida da API', raw: text });
    }

    if (!data.success) {
      return res.status(response.status).json({ error: data.error?.message || 'Erro na API', data });
    }

    // Retorna o qrcode e o id da transação para o frontend
    res.json({
      qrcode:         data.data.pix.qrcode,
      transaction_id: data.data.id,
      amount:         data.data.amount.value,
      status:         data.data.status
    });

  } catch (e) {
    console.error('ERRO CONEXAO:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ================= STATUS — consultar transação =================
// Chamado a cada 5s pelo pagamento.html para verificar se foi pago
app.get('/status/:id', async (req, res) => {
  try {
    const response = await fetch(`${BASE_URL}/transactions/${req.params.id}`, {
      headers: headers()
    });
    const data = await response.json();
    console.log('STATUS', req.params.id, '->', data.data?.status);
    res.json({ status: data.data?.status || 'unknown' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= WEBHOOK — receber confirmação de pagamento =================
// URL que você cadastra no Dashboard CashinPay em "Webhooks → Novo Webhook"
// Ex: https://backend-production-858d.up.railway.app/webhook/webhook
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const payload   = req.body;           // Buffer com o JSON cru
  const signature = req.headers['x-cashinpay-signature'] || '';
  const rawStr    = payload.toString();

  // ── Valida assinatura HMAC-SHA256 ────────────────────────────
  if (WEBHOOK_SECRET) {
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawStr).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.padEnd(expected.length, ' ')))) {
      console.warn('Webhook com assinatura invalida — rejeitado');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } else {
    console.warn('CASHINPAY_WEBHOOK_SECRET nao definido — validacao desativada');
  }

  let event;
  try {
    event = JSON.parse(rawStr);
  } catch {
    return res.status(400).json({ error: 'Payload invalido' });
  }

  log('WEBHOOK RECEBIDO', event);

  // ── Processar evento ─────────────────────────────────────────
  switch (event.event) {
    case 'transaction.paid':
      // Pagamento confirmado — libere o pedido aqui
      console.log(`✅ PAGO: ${event.data.id} | R$ ${event.data.amount.value} | ${event.data.paid_at}`);
      // TODO: atualizar banco de dados, enviar e-mail, notificar WhatsApp etc.
      break;

    case 'transaction.expired':
      // QR Code expirou sem pagamento
      console.log(`⏰ EXPIRADO: ${event.data.id}`);
      break;

    case 'transaction.pending':
      // Nova transação criada (evento opcional)
      console.log(`🔄 PENDENTE: ${event.data.id}`);
      break;

    default:
      console.log('Evento nao tratado:', event.event);
  }

  // Sempre retornar 200 imediatamente (max 15s ou vira timeout)
  res.status(200).json({ received: true });
});

// ================= HEALTH =================
app.get('/health', (_, res) => res.json({ status: 'ok', gateway: 'CashinPay' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Rodando na porta ' + PORT));
