export type Meta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type Paginated<T> = {
  data: T[];
  meta: Meta;
};

export type Subscription = {
  id: string;
  razorpaySubscriptionId: string;
  planId: string | null;
  status: string;
  currentStart: string | null;
  currentEnd: string | null;
  paidCount: number;
  totalCount: number | null;
  createdAt: string;
  updatedAt: string;
  customerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
};

export type Payment = {
  id: string;
  razorpayPaymentId: string;
  amount: number;
  currency: string | null;
  status: string;
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  invoiceId: string | null;
  createdAt: string;
};

export type RecoveryAttempt = {
  id: string;
  attemptNumber: number;
  action: string;
  status: string;
  amount: number | null;
  details: unknown;
  createdAt: string;
  nextAttemptAt: string | null;
  subscriptionId: string | null;
  razorpaySubscriptionId: string | null;
};

export type SubscriptionDetail = Subscription & {
  customerContact: string | null;
  payments: Payment[];
  recoveryAttempts: RecoveryAttempt[];
};

export type RawEvent = {
  id: string;
  eventType: string;
  razorpayEventId: string | null;
  receivedAt: string;
  processedAt: string | null;
};

export type AuditEntry = {
  id: string;
  recoveryAttemptId: string;
  action: string;
  amount: number | null;
  timestamp: string;
  metadata: unknown;
};

export type Stats = {
  totalSubscriptions: number;
  pendingSubscriptions: number;
  haltedSubscriptions: number;
  cancelledSubscriptions: number;
  activeSubscriptions: number;
  failedPayments: number;
  totalRawEvents: number;
  totalRecoveredAmount: number;
  retriesFired: number;
  lastRecoveredAt: string | null;
};

export type Delivery = {
  id: string;
  channel: string;
  toEmail: string | null;
  status: string;
  providerMessageId: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  subscriptionId: string;
  razorpaySubscriptionId: string | null;
};
