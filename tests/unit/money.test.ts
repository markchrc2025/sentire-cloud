import { describe, expect, it } from "vitest";
import { formatPHP, mulDiv, parsePHP, percent, sum } from "@/lib/money";

describe("money", () => {
  it("rounds half up", () => {
    expect(mulDiv(100, 1, 3)).toBe(33);
    expect(mulDiv(150, 1, 100)).toBe(2); // 1.5 -> 2
    expect(mulDiv(149, 1, 100)).toBe(1);
    expect(mulDiv(-150, 1, 100)).toBe(-2);
  });
  it("computes withholding in basis points", () => {
    expect(percent(149000, 200)).toBe(2980); // 2% of PHP 1,490
    expect(percent(12345, 200)).toBe(247); // 246.9 -> 247
  });
  it("refuses fractions of a centavo", () => {
    expect(() => sum([1.5])).toThrow();
  });
  it("formats and parses", () => {
    expect(formatPHP(149000)).toBe("PHP 1,490.00");
    expect(formatPHP(-5)).toBe("-PHP 0.05");
    expect(parsePHP("1,234.5")).toBe(123450);
    expect(parsePHP("₱ 10")).toBe(1000);
    expect(() => parsePHP("1.234")).toThrow();
  });
});
