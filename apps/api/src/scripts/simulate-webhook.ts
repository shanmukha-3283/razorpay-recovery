import crypto from "node:crypto";

process.loadEnvFile?.("../../.env");

const API_URL = process.env.API_URL ?? "http://localhost:3000/api";
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function paymentFailedPayload(subscriptionId: string) {
  return {
    entity: "event",
    id: `evt_${Date.now()}`,
    event: "payment.failed",
    created_at: Math.floor(Date.now() / 1000),
    contains: ["payment"],
    payload: {
      payment: {
        entity: "payment",
        id: `pay_sim_${Date.now()}`,
        order_id: `order_sim_${Date.now()}`,
        invoice_id: `inv_sim_${Date.now()}`,
        subscription_id: subscriptionId,
        amount: 24900,
        currency: "INR",
        status: "failed",
        method: "card",
        error_code: "CARD_DECLINED",
        error_description: "The card was declined by the bank",
        error_reason: "card_declined",
      },
    },
  };
}

async function simulate() {
  if (!SECRET) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not set. Set it in .env first.");
    process.exit(1);
  }

  const subscriptionId =
    process.env.SIM_SUBSCRIPTION_ID ?? "seed_sub_pending";

  const body = JSON.stringify(paymentFailedPayload(subscriptionId));
  const signature = sign(body, SECRET);

  console.log(`POST ${API_URL}/webhooks/razorpay`);
  console.log(`  event        : payment.failed`);
  console.log(`  subscription : ${subscriptionId}`);

  const res = await fetch(`${API_URL}/webhooks/razorpay`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature,
    },
    body,
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}: ${text}`);

  if (!res.ok) {
    console.error(
      "\nIf this says 'Invalid signature', confirm RAZORPAY_WEBHOOK_SECRET in .env",
      "matches the running API process."
    );
    process.exit(1);
  }
}

simulate().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
