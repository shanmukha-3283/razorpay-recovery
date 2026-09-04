import postgres from "postgres";

process.loadEnvFile?.("../../.env");

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/razorpay_recovery";

const sql = postgres(DATABASE_URL, { max: 1 });

async function resetSeed() {
  // Remove previously seeded rows so the script is idempotent.
  const seededCustomers = await sql`select id from customers where razorpay_customer_id like 'seed_%'`;
  const customerIds = seededCustomers.map((c) => c.id);

  if (customerIds.length > 0) {
    await sql`delete from message_deliveries where subscription_id in (select id from subscriptions where customer_id in ${sql(customerIds)})`;
    await sql`delete from audit_ledger where recovery_attempt_id in (select a.id from recovery_attempts a join subscriptions s on a.subscription_id = s.id where s.customer_id in ${sql(customerIds)})`;
    await sql`delete from recovery_attempts where subscription_id in (select id from subscriptions where customer_id in ${sql(customerIds)})`;
    await sql`delete from payments where subscription_id in (select id from subscriptions where customer_id in ${sql(customerIds)})`;
    await sql`delete from raw_events where id in (select id from raw_events where event_type like 'seed_%')`;
    await sql`delete from subscriptions where customer_id in ${sql(customerIds)}`;
    await sql`delete from customers where id in ${sql(customerIds)}`;
  }
}

async function seed() {
  await resetSeed();

  const [c1] = await sql`
    insert into customers (razorpay_customer_id, name, email, contact)
    values ('seed_cus_ashish', 'Ashish Sharma', 'ashish@example.com', '+919000000001')
    returning id
  `;
  const [c2] = await sql`
    insert into customers (razorpay_customer_id, name, email, contact)
    values ('seed_cus_priya', 'Priya Nair', 'priya@example.com', '+919000000002')
    on conflict (razorpay_customer_id) do nothing
    returning id
  `;
  const [c3] = await sql`
    insert into customers (razorpay_customer_id, name, email, contact)
    values ('seed_cus_rohan', 'Rohan Mehta', 'rohan@example.com', '+919000000003')
    on conflict (razorpay_customer_id) do nothing
    returning id
  `;

  const planId = "plan_seed_monthly";

  // Sub 1: active, healthy-ish (1 failed payment but still active)
  const [s1] = await sql`
    insert into subscriptions (razorpay_subscription_id, customer_id, plan_id, status, current_start, current_end, paid_count, total_count)
    values ('seed_sub_active', ${c1.id}, ${planId}, 'active', now(), now() + interval '30 days', 2, 4)
    on conflict (razorpay_subscription_id) do nothing
    returning id
  `;

  // Sub 2: pending (a fresh payment.failed → retry target)
  const [s2] = await sql`
    insert into subscriptions (razorpay_subscription_id, customer_id, plan_id, status, current_start, current_end, paid_count, total_count)
    values ('seed_sub_pending', ${c2.id}, ${planId}, 'pending', now(), now() + interval '30 days', 0, 3)
    on conflict (razorpay_subscription_id) do nothing
    returning id
  `;

  // Sub 3: halted (has hit the retry cap - demonstrates terminal handling)
  const [s3] = await sql`
    insert into subscriptions (razorpay_subscription_id, customer_id, plan_id, status, current_start, current_end, paid_count, total_count)
    values ('seed_sub_halted', ${c3.id}, ${planId}, 'halted', now() - interval '5 days', now() + interval '25 days', 1, 6)
    on conflict (razorpay_subscription_id) do nothing
    returning id
  `;

  // Payments for each subscription.
  await sql`
    insert into payments (razorpay_payment_id, subscription_id, order_id, invoice_id, amount, currency, status, method, error_code, error_description)
    values
      ('seed_pay_1', ${s1.id}, 'seed_ord_1', null, 19900, 'INR', 'captured', 'card', null, null),
      ('seed_pay_2', ${s1.id}, 'seed_ord_2', null, 19900, 'INR', 'failed', 'upi', 'BAD_UPI_HANDLE', 'Invalid UPI handle'),
      ('seed_pay_3', ${s2.id}, 'seed_ord_3', 'seed_inv_1', 24900, 'INR', 'failed', 'card', 'CARD_DECLINED', 'Card was declined'),
      ('seed_pay_4', ${s3.id}, 'seed_ord_4', null, 19900, 'INR', 'failed', 'card', 'AUTH_FAILED', 'Authentication failed')
    on conflict (razorpay_payment_id) do nothing
  `;

  // Historical recovery attempts + audit ledger for sub 3 (halted - reached cap)
  const [r1] = await sql`
    insert into recovery_attempts (subscription_id, attempt_number, action, status, amount, details, next_attempt_at)
    values (${s3.id}, 1, 'retry', 'completed', 19900, '{"reason":"CARD_DECLINED","note":"first retry"}', now() - interval '1 hour')
    returning id
  `;
  const [r2] = await sql`
    insert into recovery_attempts (subscription_id, attempt_number, action, status, amount, details, next_attempt_at)
    values (${s3.id}, 2, 'retry', 'completed', 19900, '{"reason":"CARD_DECLINED","note":"second retry"}', now() - interval '24 hours')
    returning id
  `;
  const [r3] = await sql`
    insert into recovery_attempts (subscription_id, attempt_number, action, status, amount, details, next_attempt_at)
    values (${s3.id}, 3, 'halt', 'completed', 19900, '{"reason":"cap_reached","note":"max attempts reached"}', null)
    returning id
  `;

  await sql`
    insert into audit_ledger (recovery_attempt_id, action, amount, metadata) values
      (${r1.id}, 'retry', 19900, '{"attempt":1,"note":"first retry"}'),
      (${r2.id}, 'retry', 19900, '{"attempt":2,"note":"second retry"}'),
      (${r3.id}, 'halt', 19900, '{"attempt":3,"note":"max attempts reached"}')
  `;

  // Demo message deliveries so the Deliveries page is not empty.
  await sql`
    insert into message_deliveries (subscription_id, recovery_attempt_id, channel, to_email, status, provider_message_id, error, message_body, sent_at) values
      (${s3.id}, ${r1.id}, 'email', 'rohan@example.com', 'sent', 'seed_msg_1', null, 'Your payment of 199 INR failed. We will retry shortly.', now() - interval '1 hour'),
      (${s3.id}, ${r2.id}, 'email', 'rohan@example.com', 'failed', null, 'Resend unreachable in demo seed', 'Your payment of 199 INR failed. Please update your payment method.', null),
      (${s2.id}, null, 'email', 'priya@example.com', 'skipped', null, 'no drafted message for demo row', 'Demo skipped delivery row.', null)
  `;

  console.log("Seed complete.");
  console.log(`  subscriptions: ${s1.id}, ${s2.id}, ${s3.id}`);

  // Demo abandoned checkouts (Track A): one fresh, one reminded, one recovered.
  await sql`
    insert into abandoned_checkouts (razorpay_order_id, amount, currency, email, contact, short_url, status)
    values
      ('seed_ord_co_new', 49900, 'INR', 'buyer1@example.com', '+919000000011', 'https://rzp.io/x/seed1', 'abandoned'),
      ('seed_ord_co_reminded', 99900, 'INR', 'buyer2@example.com', '+919000000012', 'https://rzp.io/x/seed2', 'reminded'),
      ('seed_ord_co_recovered', 149900, 'INR', 'buyer3@example.com', null, null, 'recovered')
    on conflict (razorpay_order_id) do nothing
  `;

  const [coRows] = await sql`
    select id from abandoned_checkouts where razorpay_order_id = 'seed_ord_co_reminded'
  `;
  if (coRows) {
    const [existingAttempt] = await sql`
      select id from recovery_attempts
      where domain = 'checkout' and domain_id = ${coRows.id} and attempt_number = 1
    `;
    if (!existingAttempt) {
      const [coAttempt] = await sql`
        insert into recovery_attempts (domain, domain_id, subscription_id, attempt_number, action, status, amount, details, next_attempt_at)
        values ('checkout', ${coRows.id}, null, 1, 'remind', 'completed', 99900, '{"reason":"first payment-link reminder"}', now() + interval '24 hours')
        returning id
      `;
      await sql`
        insert into message_deliveries (domain, domain_id, subscription_id, recovery_attempt_id, channel, to_email, status, provider_message_id, message_body, sent_at)
        values ('checkout', ${coRows.id}, null, ${coAttempt.id}, 'email', 'buyer2@example.com', 'sent', 'seed_co_msg_1', 'Your reserved items are waiting.', now() - interval '30 minutes')
      `;
      await sql`
        insert into audit_ledger (recovery_attempt_id, action, amount, metadata)
        values (${coAttempt.id}, 'remind', 99900, '{"domain":"checkout","note":"first reminder"}')
      `;
    }
  }

  await sql.end();
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
