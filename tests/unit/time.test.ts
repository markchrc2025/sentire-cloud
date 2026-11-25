import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, manilaDate, manilaStartOfDay } from "@/lib/time";

describe("Manila calendar", () => {
  it("uses Manila date near midnight", () => {
    expect(manilaDate(new Date("2026-11-30T15:59:59Z"))).toBe("2026-11-30");
    expect(manilaDate(new Date("2026-11-30T16:00:00Z"))).toBe("2026-12-01");
    expect(manilaStartOfDay("2026-12-01").toISOString()).toBe("2026-11-30T16:00:00.000Z");
  });
  it("adds months at month ends and leap years", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2027-02-28", 1, 31)).toBe("2027-03-31");
    expect(addMonths("2026-11-25", 12)).toBe("2027-11-25");
  });
  it("counts days", () => {
    expect(daysBetween("2026-11-25", "2026-12-25")).toBe(30);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
