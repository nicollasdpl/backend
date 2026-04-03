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

// ================= PIX =================
app.post('/pagar', async (req, res) => {
  const { total, items, customer } = req.body;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Authorization": getAuth(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: Math.round(total * 100),
        currency: "BRL",
        paymentMethod: "PIX",
        description: "Pedido EaiBurguer",
        companyId: COMPANY_ID,
        customer,
        items: items.map(it => ({
          id: it.nome,
          title: it.nome,
          unitPrice: Math.round(it.precoUnit * 100),
          quantity: it.quantidade,
          tangible: true
        }))
      })
    });

    const data = await response.json();

    res.json(data);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= STATUS =================
app.get("/status/:id", async (req, res) => {

  const response = await fetch(`${API_URL}/${req.params.id}`, {
    headers: {
      "Authorization": getAuth()
    }
  });

  const data = await response.json();

  res.json({ status: data.status });
});

// ================= CARTÃO =================
app.post("/pagar-cartao", async (req, res) => {

  const { total, card, nome } = req.body;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": getAuth(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: Math.round(total * 100),
      paymentMethod: "CREDIT_CARD",
      companyId: COMPANY_ID,
      card,
      customer: {
        name: nome
      }
    })
  });

  const data = await response.json();

  res.json(data);
});

// ================= HEALTH =================
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Rodando na porta " + PORT));
