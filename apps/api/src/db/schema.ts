import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const rawEvents = pgTable(
  "raw_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    razorpayEventId: varchar("razorpay_event_id", { length: 100 }),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
  },
  (table) => ({
    razorpayEventIdIdx: uniqueIndex("razorpay_event_id_idx").on(
      table.razorpayEventId
    ),
  })
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    razorpayCustomerId: varchar("razorpay_customer_id", {
      length: 100,
    }).notNull(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    contact: varchar("contact", { length: 50 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    razorpayCustomerIdIdx: uniqueIndex("razorpay_customer_id_idx").on(
      table.razorpayCustomerId
    ),
  })
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    razorpaySubscriptionId: varchar("razorpay_subscription_id", {
      length: 100,
    }).notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    planId: varchar("plan_id", { length: 100 }),
    status: varchar("status", { length: 50 }).notNull(),
    currentStart: timestamp("current_start"),
    currentEnd: timestamp("current_end"),
    paidCount: integer("paid_count").default(0),
    totalCount: integer("total_count"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    razorpaySubscriptionIdIdx: uniqueIndex(
      "razorpay_subscription_id_idx"
    ).on(table.razorpaySubscriptionId),
  })
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    razorpayPaymentId: varchar("razorpay_payment_id", {
      length: 100,
    }).notNull(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
    orderId: varchar("order_id", { length: 100 }),
    invoiceId: varchar("invoice_id", { length: 100 }),
    amount: integer("amount").notNull(),
    currency: varchar("currency", { length: 10 }).default("INR"),
    status: varchar("status", { length: 50 }).notNull(),
    method: varchar("method", { length: 50 }),
    errorCode: varchar("error_code", { length: 100 }),
    errorDescription: text("error_description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    razorpayPaymentIdIdx: uniqueIndex("razorpay_payment_id_idx").on(
      table.razorpayPaymentId
    ),
  })
);

export const recoveryAttempts = pgTable("recovery_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Polymorphic owner: subscriptions use subscriptionId (legacy) while new
  // domains (checkout, receivable) use domain + domainId. domainId carries
  // no FK constraint; integrity is enforced at the application layer.
  domain: varchar("domain", { length: 20 }).default("subscription").notNull(),
  domainId: uuid("domain_id"),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
  attemptNumber: integer("attempt_number").notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  status: varchar("status", { length: 50 }).default("pending").notNull(),
  amount: integer("amount"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  nextAttemptAt: timestamp("next_attempt_at"),
});

export const auditLedger = pgTable("audit_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  recoveryAttemptId: uuid("recovery_attempt_id")
    .references(() => recoveryAttempts.id)
    .notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  amount: integer("amount"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  metadata: jsonb("metadata"),
});

export const messageDeliveries = pgTable("message_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  domain: varchar("domain", { length: 20 }).default("subscription").notNull(),
  domainId: uuid("domain_id"),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
  recoveryAttemptId: uuid("recovery_attempt_id").references(
    () => recoveryAttempts.id
  ),
  channel: varchar("channel", { length: 20 }).notNull(),
  toEmail: varchar("to_email", { length: 255 }),
  status: varchar("status", { length: 20 })
    .default("queued")
    .notNull(),
  providerMessageId: varchar("provider_message_id", { length: 255 }),
  error: text("error"),
  messageBody: text("message_body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
});

export const abandonedCheckouts = pgTable(
  "abandoned_checkouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    razorpayOrderId: varchar("razorpay_order_id", { length: 100 }).notNull(),
    amount: integer("amount").notNull(),
    currency: varchar("currency", { length: 10 }).default("INR"),
    email: varchar("email", { length: 255 }),
    contact: varchar("contact", { length: 50 }),
    shortUrl: varchar("short_url", { length: 500 }),
    status: varchar("status", { length: 50 }).default("abandoned").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    razorpayOrderIdIdx: uniqueIndex("abandoned_checkout_order_id_idx").on(
      table.razorpayOrderId
    ),
  })
);

export const receivableInvoices = pgTable(
  "receivable_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: varchar("external_id", { length: 100 }).notNull(),
    customerName: varchar("customer_name", { length: 255 }),
    customerEmail: varchar("customer_email", { length: 255 }),
    amount: integer("amount").notNull(),
    currency: varchar("currency", { length: 10 }).default("INR"),
    dueDate: timestamp("due_date"),
    status: varchar("status", { length: 50 }).default("overdue").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    externalIdIdx: uniqueIndex("receivable_invoice_external_id_idx").on(
      table.externalId
    ),
  })
);

export const paymentPromises = pgTable(
  "payment_promises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .references(() => receivableInvoices.id)
      .notNull(),
    promisedAmount: integer("promised_amount"),
    promisedDate: timestamp("promised_date").notNull(),
    status: varchar("status", { length: 50 }).default("open").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    invoiceIdIdx: index("payment_promise_invoice_id_idx").on(
      table.invoiceId
    ),
  })
);
