const express   = require('express');
const crypto    = require('crypto');
const stripe    = require('stripe')(process.env.STRIPE_SECRET_KEY || '');
const bodyParser = require('body-parser');
const app       = express();
const PORT      = process.env.PORT || 3000;

/* ------------------------------------------------------------------
   Helper to verify Stripe webhooks (only used in /webhooks/stripe)
-------------------------------------------------------------------*/
function verifyWebhook(req, res, next) {
  const sig = req.headers['stripe-signature'] || '';
  const raw = req.rawBody;

  try {
    stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
    next();
  } catch (err) {
    console.error('⚠️  Webhook verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
}

/* ------------------------------------------------------------------
   Middleware
-------------------------------------------------------------------*/
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf; // keep raw body for webhook verification
  }
}));

/* ------------------------------------------------------------------
   Health check
-------------------------------------------------------------------*/
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/* ------------------------------------------------------------------
   1. Create a new Treasury funding source
   ---------------------------------------------------------------
   POST /create-fund
   body: { amount: 7000000, currency: "usd", description: "Initial fund" }
   returns: { fund_distribution_id }
-------------------------------------------------------------------*/
app.post('/create-fund', async (req, res) => {
  try {
    const { amount, currency, description } = req.body;

    if (!amount || !currency) {
      return res.status(400).json({ error: 'amount & currency required' });
    }

    const fund = await stripe.treasury.fund_distributions.create({
      amount,
      currency,
      description: description || 'Treasury source'
    });

    res.json({ fund_distribution_id: fund.id, account: fund.account });
  } catch (err) {
    console.error('❌ Error creating fund distribution:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
   2. Convert USD debit to USDC payout
   ---------------------------------------------------------------
   POST /payout-usdc
   body: { amount_usd: 5000, source_fund_id: "fd_..." }
   returns: { debit_id, captured_debit }
-------------------------------------------------------------------*/
app.post('/payout-usdc', async (req, res) => {
  try {
    const { amount_usd, source_fund_id } = req.body;

    if (!amount_usd || !source_fund_id) {
      return res
        .status(400)
        .json({ error: 'amount_usd & source_fund_id required' });
    }

    // 1️⃣ Create a debit that converts from the funding source (USD)
    //    into USDC.  The source_fund_id holds the USD balance you want to spend.
    const debit = await stripe.treasury.debits.create({
      amount: amount_usd,
      currency: 'usdc',          // target currency
      source_fund_id,           // USD treasury balance
      description: 'One‑time USDC payout'
    });

    // 2️⃣ Capture the debit.  After capture the money is transferred to
    //     the connected bank/treasury account that holds USDC.
    const captured = await stripe.treasury.debits.capture(debit.id);

    res.json({
      debit_id: debit.id,
      captured_debit: captured
    });
  } catch (err) {
    console.error('❌ Error creating USDC payout:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------
   3. Stripe webhook endpoint
   ---------------------------------------------------------------
   POST /webhooks/stripe
   body: Stripe event (must be `treasury.debit.credited`, `treasury.debit.failed`, etc.)
   ---------------------------------------------------*/
app.post('/webhooks/stripe', verifyWebhook, async (req, res) => {
  const event = req.body;

  // We only care about credit events to confirm a payout succeeded
  if (event.type === 'treasury.debit.credited') {
    const debit = event.data.object;
    console.log(`✅ Debit ${debit.id} credited in ${debit.currency}`);
    // Here you could update your DB, send a notification, etc.
  }

  res.status(200).json({ received: true });
});

/* ------------------------------------------------------------------
   Start the server
-------------------------------------------------------------------*/
app.listen(PORT, () => {
  console.log(`🚀 Treasury app listening on ${PORT}`);
});
