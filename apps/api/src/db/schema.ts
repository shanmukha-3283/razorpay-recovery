import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  text,
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
  subscriptionId: uuid("subscription_id")
    .references(() => subscriptions.id)
    .notNull(),
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
  subscriptionId: uuid("subscription_id")
    .references(() => subscriptions.id)
    .notNull(),
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
