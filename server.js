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

function log(label, obj) {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(obj, null, 2));
}

// ── Helpers ──────────────────────────────────────────────────────

function buildCustomer({ nome, email, telefone, cpf }) {
  const nomeLimpo  = (nome  || "Cliente").trim();
  const emailLimpo = email  || `${nomeLimpo.toLowerCase().replace(/\s+/g, "")}@eaiburguer.com`;
  const foneLimpo  = (telefone || "11999999999").replace(/\D/g, "");   // string de dígitos
  const cpfLimpo   = (cpf  || "52998224725").replace(/\D/g, "");       // string de dígitos

  return {
    name:  nomeLimpo,
    email: emailLimpo,
    phone: foneLimpo,
    document: {
      type:   "CPF",
      number: cpfLimpo
    }
  };
}

function buildItems(items) {
  if (!items || items.length === 0) {
    return [{ title: "Pedido EaiBurguer", unitPrice: 100, quantity: 1 }];
  }
  return items.map(it => ({
    title:     String(it.nome || it.title || "Item"),
    unitPrice: Math.round((it.precoUnit || it.unitPrice || 0) * 100), // centavos, inteiro
    quantity:  parseInt(it.quantidade || it.quantity || 1, 10)
  }));
}

function buildShipping(enderecoDetalhado) {
  if (!enderecoDetalhado) return null;
  const ed = enderecoDetalhado;
  const addr = {
    street:       ed.rua        || "Rua Sem Nome",
    streetNumber: String(ed.numero || "0"),          // string
    zipCode:      (ed.cep || "01001000").replace(/\D/g, ""),
    neighborhood: ed.bairro     || "Centro",
    city:         ed.cidade     || "São Paulo",
    state:        ed.estado     || "SP",
    country:      "BR"
  };
  if (ed.complemento) addr.complement = ed.complemento;
  return { address: addr };
}

// ================= PIX =================
app.post('/pagar', async (req, res) => {
  const { total, items, nome, email, telefone, cpf, enderecoDetalhado } = req.body;

  const payload = {
    amount:        Math.round(total * 100),
    paymentMethod: "PIX",
    customer:      buildCustomer({ nome, email, telefone, cpf }),
    items:         buildItems(items)
  };

  const shipping = buildShipping(enderecoDetalhado);
  if (shipping) payload.shipping = shipping;

  log("PAYLOAD PIX → GHOSTSPAY", payload);

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
      log("RESPOSTA PIX (status " + response.status + ")", data);
    } catch {
      return res.status(500).json({ error: "Resposta inválida da API", raw: text });
    }

    res.status(response.status).json(data);
  } catch (e) {
    console.error("ERRO PIX:", e.message);
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
  const {
    total, items,
    nome, email, telefone, cpf,
    cardNumber, holderName, expMonth, expYear, cvv,
    enderecoDetalhado
  } = req.body;

  // Log de diagnóstico — mostra o que o frontend enviou
  console.log("\n[CARTÃO] body recebido:", JSON.stringify({ total, cardNumber: cardNumber ? "***" + String(cardNumber).slice(-4) : "AUSENTE", expMonth, expYear, cvv: cvv ? "***" : "AUSENTE", nome }));

  if (!cardNumber) return res.status(400).json({ error: "Número do cartão ausente." });
  if (!cvv)        return res.status(400).json({ error: "CVV ausente." });
  if (!expMonth || !expYear) return res.status(400).json({ error: "Validade ausente." });

  const cardNumLimpo = String(cardNumber).replace(/\D/g, ""); // string de dígitos
  const cvvLimpo     = String(cvv).replace(/\D/g, "");        // string de dígitos

  const payload = {
    amount:        Math.round(total * 100),
    paymentMethod: "CARD",
    installments:  1,
    customer:      buildCustomer({ nome, email, telefone, cpf }),
    items:         buildItems(items),
    card: {
      number:          cardNumLimpo,                           // string de dígitos
      holderName:      (holderName || nome || "Cliente").trim(),
      expirationMonth: parseInt(expMonth, 10),                 // inteiro 1–12
      expirationYear:  parseInt(expYear,  10),                 // inteiro 4 dígitos
      cvv:             cvvLimpo                                // string de dígitos
    }
  };

  const shipping = buildShipping(enderecoDetalhado);
  if (shipping) payload.shipping = shipping;

  log("PAYLOAD CARTÃO → GHOSTSPAY", payload);

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
      log("RESPOSTA CARTÃO (status " + response.status + ")", data);
    } catch {
      return res.status(500).json({ error: "Resposta inválida da API", raw: text });
    }

    res.status(response.status).json(data);
  } catch (e) {
    console.error("ERRO CARTÃO:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ================= HEALTH =================
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Rodando na porta " + PORT));
