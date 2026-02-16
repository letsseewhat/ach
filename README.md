# teslaceo-ach-sample

Minimal Node.js + Express scaffold demonstrating Stripe ACH debit/credit and webhook endpoints for teslaceo.net.

Quick start

1. Copy environment variables into `.env` (see `.env.example`). Do NOT store live secret keys in source control.

2. Install dependencies and run server:

```bash
cd teslaceo-ach-sample
npm install
npm start
```

3. Open `http://localhost:3000` to view the static demo page. The demo shows how to request a PaymentIntent/SetupIntent client secret from the server — replace the client-side placeholder with Stripe.js Elements following Stripe docs.

Environment variables

- `STRIPE_SECRET_KEY` — your Stripe secret key (test or live)
- `STRIPE_WEBHOOK_SECRET` — your webhook endpoint signing secret (for `/webhook` verification)
- `PORT` — optional server port (default 3000)

Notes

- This is a sample scaffold. For production, implement proper customer onboarding, KYC, idempotency keys, secure storage of records, and follow Stripe recommended flows for `us_bank_account` and microdeposit verification or Plaid.
- The sample includes a `/create-payout` endpoint for demonstration; creating payouts via the API may require additional Stripe account capabilities and settings.

Next steps

- Integrate Stripe.js on the client (replace the placeholder code in `server/public/index.html`).
- Add webhook verification and reconciliation in your production environment.
- Merge into your teslaceo.net repo or adapt routes as needed.
