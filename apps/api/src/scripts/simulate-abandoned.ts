process.loadEnvFile?.("../../.env");

export {};

const API_URL = process.env.API_URL ?? "http://localhost:3000/api";

const orderId = process.argv[2] ?? `order_sim_${Date.now()}`;

const body = JSON.stringify({
  order_id: orderId,
  amount: 49900,
  currency: "INR",
  email: "buyer@example.com",
  contact: "+919000000099",
  short_url: "https://rzp.io/x/simcheckout",
});

async function simulate() {
  console.log(`POST ${API_URL}/checkouts/abandoned`);
  console.log(`  order: ${orderId}`);

  const res = await fetch(`${API_URL}/checkouts/abandoned`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}: ${text}`);

  if (!res.ok) {
    process.exit(1);
  }
}

simulate().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
