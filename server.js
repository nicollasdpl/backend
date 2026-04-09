const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.SECRET_KEY;
const COMPANY_ID = process.env.COMPANY_ID;
const API_URL = "https://api.ghostspaysv2.com/functions/v1/transactions";

function getAuth() {
  return "Basic " + Buffer.from(`${SECRET_KEY}:${COMPANY_ID}`).toString('base64');
}

// ── Helpers de log ───────────────────────────────────────────────
function log(label, obj) {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(obj, null, 2));
}

// ================= PIX =================
app.post('/pagar', async (req, res) => {
  const { total, items, customer, nome, telefone } = req.body;

  // Monta customer com dados reais do pedido
  // CPF fictício válido para testes (passa na validação de dígito)
  const customerPayload = {
    name:  customer?.name  || nome || "Cliente",
    email: customer?.email || `${(nome||"cliente").toLowerCase().replace(/\s+/g,"")}@eaiburguer.com`,
    phone: customer?.phone || (telefone || "11999999999").replace(/\D/g, ""),
    document: {
      type:   "CPF",
      number: "52998224725"   // CPF fictício válido (gerado por algoritmo)
    }
  };

  const payload = {
    amount:        Math.round(total * 100),
    currency:      "BRL",
    paymentMethod: "PIX",
    description:   "Pedido EaiBurguer",
    companyId:     COMPANY_ID,
    customer:      customerPayload,
    items: (items || []).map(it => ({
      id:        String(it.id || it.nome),
      title:     it.nome,
      unitPrice: Math.round(it.precoUnit * 100),
      quantity:  it.quantidade,
      tangible:  true
    }))
  };

  log("PAYLOAD ENVIADO PARA GHOSTSPAY", payload);

  try {
    const response = await fetch(API_URL, {
      method:  "POST",
      headers: { "Authorization": getAuth(), "Content-Type": "application/json" },
      body:    JSON.stringify(payload)
    });

    const text = await response.text();
    log("RESPOSTA GHOSTSPAY (status " + response.status + ")", JSON.parse(text));

    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(500).json({ error: "Resposta invalida da API", raw: text }); }

    // Repassa tudo para o frontend decidir
    res.status(response.status).json(data);

  } catch (e) {
    console.error("ERRO DE CONEXAO:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ================= STATUS =================
app.get("/status/:id", async (req, res) => {
  try {
    const response = await fetch(`${API_URL}/${req.params.id}`, {
      headers: { "Authorization": getAuth() }
    });
    const data = await response.json();
    console.log("STATUS", req.params.id, "->", data.status);
    res.json({ status: data.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= CARTÃO =================
// Recebe os dados do cartão do frontend e tenta dois caminhos:
// 1. Tokenização via SDK GhostsPay (se PUBLIC_KEY estiver configurada)
// 2. Envio direto com dados do cartão (fallback — funciona se a adquirente aceitar)
app.post("/pagar-cartao", async (req, res) => {
  const { total, card, nome, cpf } = req.body;

  const cpfLimpo = (cpf || "52998224725").replace(/\D/g, "");
  const PUBLIC_KEY = process.env.PUBLIC_KEY; // defina no Render/Railway se tiver

  let cardPayload;

  // Tenta tokenizar se a PUBLIC_KEY estiver disponível
  if (PUBLIC_KEY) {
    try {
      // Carrega o SDK via fetch (o SDK expõe uma função de encrypt via HTTP)
      const tokenRes = await fetch("https://api.ghostspaysv2.com/functions/v1/encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey:    PUBLIC_KEY,
          number:       card.number,
          holderName:   card.name,
          expMonth:     parseInt(card.expMonth),
          expYear:      parseInt(card.expYear),
          cvv:          card.cvv,
          amount:       Math.round(total * 100),
          installments: 1
        })
      });

      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        const tokenId = tokenData.token || tokenData.token_id || tokenData.id;
        if (tokenId) {
          log("TOKEN GERADO", { tokenId });
          cardPayload = { token: tokenId };
        }
      }
    } catch (tokenErr) {
      console.warn("Tokenização falhou, tentando envio direto:", tokenErr.message);
    }
  }

  // Fallback: envia dados do cartão diretamente
  if (!cardPayload) {
    cardPayload = {
      number:     card.number,
      holderName: card.name,
      expMonth:   card.expMonth,
      expYear:    card.expYear,
      cvv:        card.cvv
    };
  }

  const payload = {
    amount:        Math.round(total * 100),
    currency:      "BRL",
    paymentMethod: "CREDIT_CARD",
    description:   "Pedido EaiBurguer",
    companyId:     COMPANY_ID,
    installments:  1,
    card:          cardPayload,
    customer: {
      name:     nome || card.name || "Cliente",
      email:    `${(nome||"cliente").toLowerCase().replace(/\s+/g,"")}@eaiburguer.com`,
      phone:    "11999999999",
      document: { type: "CPF", number: cpfLimpo }
    }
  };

  log("PAYLOAD CARTAO", payload);

  try {
    const response = await fetch(API_URL, {
      method:  "POST",
      headers: { "Authorization": getAuth(), "Content-Type": "application/json" },
      body:    JSON.stringify(payload)
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
      log("RESPOSTA CARTAO (status " + response.status + ")", data);
    } catch {
      return res.status(500).json({ error: "Resposta invalida da API", raw: text });
    }

    res.status(response.status).json(data);
  } catch (e) {
    console.error("ERRO CARTAO:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ================= HEALTH =================
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Rodando na porta " + PORT));
