import { describe, expect, it } from "vitest";
import { cn, formatDateTime, formatINR } from "./utils";

describe("cn", () => {
  it("joins truthy classes and drops falsy ones", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });

  it("resolves tailwind conflicts with the later class winning", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("formatINR", () => {
  it("returns an em dash for null/undefined", () => {
    expect(formatINR(null)).toBe("—");
    expect(formatINR(undefined)).toBe("—");
  });

  it("formats paise amounts as whole rupees", () => {
    const out = formatINR(24900);
    expect(out).toContain("24,900");
    expect(out).toContain("₹");
  });

  it("respects an explicit currency", () => {
    expect(formatINR(5000, "USD")).toContain("$");
  });

  it("falls back to the raw amount for an invalid currency", () => {
    expect(formatINR(1234, "NOPE")).toBe("1234");
  });
});

describe("formatDateTime", () => {
  it("returns an em dash for null/undefined", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });

  it("renders a valid ISO string", () => {
    const out = formatDateTime("2026-09-04T07:00:00.000Z");
    expect(out).not.toBe("—");
    expect(out).toContain("2026");
  });
});
