process.loadEnvFile?.("../../.env");

export {};

const API_URL = process.env.API_URL ?? "http://localhost:3000/api";

async function simulate() {
  // 1. Single ingest.
  console.log("POST", `${API_URL}/receivables (single)`);
  const single = await fetch(`${API_URL}/receivables`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      external_id: `SIM-INV-${Date.now()}`,
      customer_name: "Simplex LLC",
      customer_email: "billing@simplex.example.com",
      amount: 75000,
      currency: "INR",
      due_date: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
  console.log(`HTTP ${single.status}: ${await single.text()}`);

  // 2. CSV import (one good row, two bad rows).
  const csv = [
    "external_id,customer_name,customer_email,amount,currency,due_date",
    `SIM-CSV-1,CSV Corp,csv@example.com,120000,INR,2026-08-10`,
    `,Missing Id,noid@example.com,5000,INR,2026-08-10`,
    `SIM-CSV-2,Bad Amount,bad@example.com,notanumber,INR,2026-08-10`,
  ].join("\n");

  console.log("POST", `${API_URL}/receivables/import (csv)`);
  const imp = await fetch(`${API_URL}/receivables/import`, {
    method: "POST",
    headers: { "content-type": "text/csv" },
    body: csv,
  });
  const impText = await imp.text();
  console.log(`HTTP ${imp.status}: ${impText}`);

  if (!single.ok || !imp.ok) process.exit(1);
}

simulate().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
