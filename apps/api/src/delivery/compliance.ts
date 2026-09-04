import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dndEntries, messageDeliveries } from "../db/schema.js";

export type ComplianceConfig = {
  quietStartHour: number;
  quietEndHour: number;
  timeZone: string;
  dailyCap: number;
  weeklyCap: number;
};

export function loadComplianceConfig(): ComplianceConfig {
  return {
    quietStartHour: Number(process.env.QUIET_HOURS_START ?? 21),
    quietEndHour: Number(process.env.QUIET_HOURS_END ?? 8),
    timeZone: process.env.COMPLIANCE_TZ ?? "Asia/Kolkata",
    dailyCap: Number(process.env.COMPLIANCE_DAILY_CAP ?? 1),
    weeklyCap: Number(process.env.COMPLIANCE_WEEKLY_CAP ?? 3),
  };
}

function hourInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return hour === 24 ? 0 : hour;
}

/** True when `now` falls inside the quiet window (handles overnight wrap). */
export function isQuietHours(
  now: Date,
  cfg: ComplianceConfig = loadComplianceConfig()
): boolean {
  const hour = hourInZone(now, cfg.timeZone);
  if (cfg.quietStartHour <= cfg.quietEndHour) {
    return hour >= cfg.quietStartHour && hour < cfg.quietEndHour;
  }
  return hour >= cfg.quietStartHour || hour < cfg.quietEndHour;
}

export type ComplianceVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Policy gate for every outbound touch, in check order:
 * DND suppression → quiet hours → frequency caps. A violation means
 * "skip + audit", never silent drop — callers record the reason.
 */
export async function checkCompliance(
  toEmail: string,
  now: Date = new Date(),
  cfg: ComplianceConfig = loadComplianceConfig()
): Promise<ComplianceVerdict> {
  const normalized = toEmail.trim().toLowerCase();

  const [dnd] = await db
    .select({ id: dndEntries.id })
    .from(dndEntries)
    .where(eq(dndEntries.email, normalized))
    .limit(1);
  if (dnd) {
    return { ok: false, reason: "recipient on DND list" };
  }

  if (isQuietHours(now, cfg)) {
    return { ok: false, reason: "quiet hours" };
  }

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [{ sentDay }] = await db
    .select({ sentDay: sql<number>`count(*)` })
    .from(messageDeliveries)
    .where(
      and(
        eq(messageDeliveries.toEmail, normalized),
        eq(messageDeliveries.status, "sent"),
        gte(messageDeliveries.sentAt, dayAgo)
      )
    );

  if (Number(sentDay) >= cfg.dailyCap) {
    return { ok: false, reason: "daily frequency cap reached" };
  }

  const [{ sentWeek }] = await db
    .select({ sentWeek: sql<number>`count(*)` })
    .from(messageDeliveries)
    .where(
      and(
        eq(messageDeliveries.toEmail, normalized),
        eq(messageDeliveries.status, "sent"),
        gte(messageDeliveries.sentAt, weekAgo)
      )
    );

  if (Number(sentWeek) >= cfg.weeklyCap) {
    return { ok: false, reason: "weekly frequency cap reached" };
  }

  return { ok: true };
}
