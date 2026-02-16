import Stripe from 'stripe';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);

    // Static file serving (index.html, CSS, JS)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const response = await fetch(new Request(new URL('/index.html', import.meta.url), {
        method: 'GET',
        headers: request.headers
      }));
      return response;
    }

    // Serve static files from public/
    if (url.pathname.startsWith('/public/')) {
      const response = await fetch(new Request(new URL(url.pathname, import.meta.url), {
        method: 'GET',
        headers: request.headers
      }));
      return response;
    }

    // API routes
    if (request.method === 'POST') {
      if (url.pathname === '/create-payment-intent') {
        return await createPaymentIntent(request, stripe);
      }
      if (url.pathname === '/create-setup-intent') {
        return await createSetupIntent(request, stripe);
      }
      if (url.pathname === '/create-payout') {
        return await createPayout(request, stripe);
      }
      if (url.pathname === '/attach-payment-method') {
        return await attachPaymentMethod(request, stripe);
      }
      if (url.pathname === '/verify-microdeposits') {
        return await verifyMicrodeposits(request, stripe);
      }
      if (url.pathname === '/create-debit') {
        return await createDebit(request, stripe);
      }
      if (url.pathname === '/webhook') {
        return await handleWebhook(request, env.STRIPE_WEBHOOK_SECRET, stripe);
      }
    }

    return new Response('Not found', { status: 404 });
  }
};

async function createPaymentIntent(request, stripe) {
  try {
    const { amount = 1000 } = await request.json();
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      payment_method_types: ['us_bank_account']
    });
    return new Response(JSON.stringify({ client_secret: paymentIntent.client_secret }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function createSetupIntent(request, stripe) {
  try {
    const setupIntent = await stripe.setupIntents.create({
      payment_method_types: ['us_bank_account']
    });
    return new Response(JSON.stringify({ client_secret: setupIntent.client_secret }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function createPayout(request, stripe) {
  try {
    const { amount = 1000 } = await request.json();
    const payout = await stripe.payouts.create({
      amount,
      currency: 'usd'
    });
    return new Response(JSON.stringify(payout), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function attachPaymentMethod(request, stripe) {
  try {
    const { payment_method_id, email } = await request.json();
    if (!payment_method_id) {
      return new Response(JSON.stringify({ error: 'payment_method_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const customer = await stripe.customers.create(email ? { email } : {});
    await stripe.paymentMethods.attach(payment_method_id, { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: payment_method_id } });

    return new Response(JSON.stringify({ customer_id: customer.id, payment_method_id }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function verifyMicrodeposits(request, stripe) {
  try {
    const { payment_method_id, amounts } = await request.json();
    if (!payment_method_id || !Array.isArray(amounts)) {
      return new Response(JSON.stringify({ error: 'payment_method_id and amounts[] required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const verified = await stripe.paymentMethods.verify(payment_method_id, { amounts });
    return new Response(JSON.stringify(verified), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function createDebit(request, stripe) {
  try {
    const { amount = 1000, currency = 'usd', customer_id, payment_method_id } = await request.json();
    if (!customer_id || !payment_method_id) {
      return new Response(JSON.stringify({ error: 'customer_id and payment_method_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customer_id,
      payment_method: payment_method_id,
      payment_method_types: ['us_bank_account'],
      off_session: true,
      confirm: true
    });

    return new Response(JSON.stringify(paymentIntent), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message, raw: err.raw || null }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

async function handleWebhook(request, webhookSecret, stripe) {
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();

  try {
    const event = stripe.webhooks.constructEvent(body, sig, webhookSecret);

    switch (event.type) {
      case 'payment_intent.succeeded':
        console.log('PaymentIntent succeeded:', event.data.object.id);
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

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }
}
