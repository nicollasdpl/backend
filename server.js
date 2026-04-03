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
app.post("/pagar-cartao", async (req, res) => {
  const { total, card, nome } = req.body;

  const payload = {
    amount:        Math.round(total * 100),
    paymentMethod: "CREDIT_CARD",
    companyId:     COMPANY_ID,
    card,
    customer: {
      name:     nome || "Cliente",
      email:    `${(nome||"cliente").toLowerCase().replace(/\s+/g,"")}@eaiburguer.com`,
      document: { type: "CPF", number: "52998224725" }
    }
  };

  log("PAYLOAD CARTAO", payload);

  try {
    const response = await fetch(API_URL, {
      method:  "POST",
      headers: { "Authorization": getAuth(), "Content-Type": "application/json" },
      body:    JSON.stringify(payload)
    });
    const data = await response.json();
    log("RESPOSTA CARTAO", data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= HEALTH =================
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Rodando na porta " + PORT));
