import { describe, expect, it } from "vitest";
import {
  clampString,
  escapeLike,
  isValidAmount,
  isValidEmail,
  isValidProviderId,
  MAX_AMOUNT,
  sanitizeCurrency,
} from "./validation.js";

describe("input validation helpers", () => {
  it("accepts only finite in-range amounts", () => {
    expect(isValidAmount(0)).toBe(true);
    expect(isValidAmount(24900)).toBe(true);
    expect(isValidAmount(MAX_AMOUNT)).toBe(true);
    expect(isValidAmount(-1)).toBe(false);
    expect(isValidAmount(NaN)).toBe(false);
    expect(isValidAmount(Infinity)).toBe(false);
    expect(isValidAmount(MAX_AMOUNT + 1)).toBe(false);
    expect(isValidAmount("100")).toBe(false);
    expect(isValidAmount(undefined)).toBe(false);
  });

  it("normalizes currency codes strictly", () => {
    expect(sanitizeCurrency("INR")).toBe("INR");
    expect(sanitizeCurrency(" inr ")).toBe("INR");
    expect(sanitizeCurrency("usd")).toBe("USD");
    expect(sanitizeCurrency("INRR")).toBeNull();
    expect(sanitizeCurrency("IN")).toBeNull();
    expect(sanitizeCurrency("inr; DROP")).toBeNull();
    expect(sanitizeCurrency(123)).toBeNull();
  });

  it("constrains provider ids to safe characters", () => {
    expect(isValidProviderId("order_9")).toBe(true);
    expect(isValidProviderId("sub_abc-123_X")).toBe(true);
    expect(isValidProviderId("")).toBe(false);
    expect(isValidProviderId("order/../x")).toBe(false);
    expect(isValidProviderId("order_1?x=1")).toBe(false);
    expect(isValidProviderId("x".repeat(65))).toBe(false);
  });

  it("rejects malformed and newline-injected emails", () => {
    expect(isValidEmail("buyer@example.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("x@y.com\r\nBcc: z@evil.com")).toBe(false);
  });

  it("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_off\\sale")).toBe("100\\%\\_off\\\\sale");
  });

  it("clamps strings and rejects newlines", () => {
    expect(clampString("  hello  ", 10)).toBe("hello");
    expect(clampString("", 10)).toBeNull();
    expect(clampString("toolong", 3)).toBeNull();
    expect(clampString("a\nb", 10)).toBeNull();
    expect(clampString(42, 10)).toBeNull();
  });
});
