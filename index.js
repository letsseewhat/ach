require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const Stripe = require('stripe');

const app = express();
const port = process.env.PORT || 3000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Serve static demo page
app.use(express.static(path.join(__dirname, 'public')));

// JSON body parser for API routes
app.use(bodyParser.json());

// Create a PaymentIntent for ACH debit (demo)
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount = 1000 } = req.body; // amount in cents
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      // For real flows, create or attach a Customer and use SetupIntent when saving payment methods.
    });
    res.json({ client_secret: paymentIntent.client_secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Create a SetupIntent (to save a bank account for future debits)
app.post('/create-setup-intent', async (req, res) => {
  try {
    const setupIntent = await stripe.setupIntents.create({
      payment_method_types: ['us_bank_account']
    });
    res.json({ client_secret: setupIntent.client_secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Create a Payout (demo) — note: your Stripe account must support programmatic payouts
app.post('/create-payout', async (req, res) => {
  try {
    const { amount = 1000 } = req.body; // cents
    const payout = await stripe.payouts.create({
      amount,
      currency: 'usd'
    });
    res.json(payout);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Attach a PaymentMethod to a Customer (creates customer if email provided)
app.post('/attach-payment-method', async (req, res) => {
  try {
    const { payment_method_id, email } = req.body;
    if (!payment_method_id) return res.status(400).json({ error: 'payment_method_id required' });

    let customer;
    if (email) {
      customer = await stripe.customers.create({ email });
    } else {
      customer = await stripe.customers.create();
    }

    // Attach the payment method to the customer
    await stripe.paymentMethods.attach(payment_method_id, { customer: customer.id });

    // Optionally set as default payment method for invoices
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: payment_method_id } });

    res.json({ customer_id: customer.id, payment_method_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Verify microdeposits for a saved bank account payment method
app.post('/verify-microdeposits', async (req, res) => {
  try {
    const { payment_method_id, amounts } = req.body; // amounts: [32, 45]
    if (!payment_method_id || !Array.isArray(amounts)) return res.status(400).json({ error: 'payment_method_id and amounts[] required' });

    const verified = await stripe.paymentMethods.verify(payment_method_id, { amounts });
    res.json(verified);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Create a PaymentIntent debit using a saved payment method on a customer
app.post('/create-debit', async (req, res) => {
  try {
    const { amount = 1000, currency = 'usd', customer_id, payment_method_id } = req.body;
    if (!customer_id || !payment_method_id) return res.status(400).json({ error: 'customer_id and payment_method_id required' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customer_id,
      payment_method: payment_method_id,
      payment_method_types: ['us_bank_account'],
      off_session: true,
      confirm: true
    });

    res.json(paymentIntent);
  } catch (err) {
    console.error(err);
    // Surface Stripe errors to client for handling (e.g., requires_action)
    res.status(500).json({ error: err.message, raw: err.raw || null });
  }
});

// Webhook endpoint — use raw body for signature verification
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event types you care about
  switch (event.type) {
    case 'payment_intent.succeeded':
      console.log('PaymentIntent succeeded:', event.data.object.id);
      // Fulfill the purchase, update order status, etc.
      break;
    case 'payment_intent.payment_failed':
      console.log('PaymentIntent failed:', event.data.object.id);
      break;
    case 'payout.paid':
      console.log('Payout paid:', event.data.object.id);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
