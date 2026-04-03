const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ================= CONFIGURAÇÃO =================
const SECRET_KEY = process.env.SECRET_KEY;
const COMPANY_ID = process.env.COMPANY_ID;
const GHOSTPAY_API = "https://api.ghostspaysv2.com/functions/v1/transactions";
// =================================================

app.post('/pagar', async (req, res) => {
  const { total, items, customer } = req.body;

  if (!total || total <= 0) {
    return res.status(400).json({ error: "Valor inválido" });
  }

  try {
    const credentials = Buffer.from(`${SECRET_KEY}:${COMPANY_ID}`).toString('base64');

    const payload = {
      amount: Math.round(total * 100),
      currency: "BRL",
      paymentMethod: "PIX",
      description: "Pedido EaiBurguer",
      companyId: COMPANY_ID,
      customer: customer || {
        name: "Luiz Henrique",
        email: "luz.henri@email.com",
        phone: "11945829636",
        document: { type: "CPF", number: "41248713842" }
      },
      items: (items || []).map(it => ({
        id: it.id || it.nome,
        title: it.nome,
        unitPrice: Math.round(it.precoUnit * 100),
        quantity: it.quantidade,
        tangible: true
      }))
    };

    console.log("Enviando para GhostsPay:", JSON.stringify(payload, null, 2));

    const response = await fetch(GHOSTPAY_API, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    console.log("Resposta bruta da GhostsPay (status", response.status, "):", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: "Resposta invalida da GhostsPay", raw: text });
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: "Erro na GhostsPay", data });
    }

    // Transacao recusada pela adquirente
    if (data.status === "refused") {
      const motivo = data.refusedReason?.description || "Transacao recusada pela adquirente";
      console.error("Transacao recusada:", data.refusedReason);
      return res.status(402).json({
        error: `Pagamento recusado: ${motivo}`,
        refusedReason: data.refusedReason,
        transactionId: data.id
      });
    }

    // Busca link/qrcode nos campos possiveis
    const link = data.link
      || data.paymentUrl
      || data.payment_url
      || data.url
      || data.pix?.qrcode
      || data.pix?.qrCode
      || data.pix?.receiptUrl
      || null;

    if (!link) {
      console.error("Resposta sem link de pagamento:", data);
      return res.status(500).json({ error: "Pagamento nao gerou link", data });
    }

    return res.json({ link, data });

  } catch (erro) {
    console.error("ERRO AO CONECTAR COM A API:", erro);
    return res.status(500).json({ error: "Erro ao conectar com servidor", detalhes: erro.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));