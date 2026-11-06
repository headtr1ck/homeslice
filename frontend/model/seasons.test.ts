import { describe, expect, it } from "vitest";
import { dayRange, easter, inSeason, isSeasonSpec, SEASONS } from "./seasons";

const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 15);

describe("seasons", () => {
  it("Easter falls on the right Sunday", () => {
    expect(easter(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(easter(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
    expect(easter(2038).toISOString().slice(0, 10)).toBe("2038-04-25");
  });

  // [season, a day in it, a day outside it], checked against published dates
  const cases: [string, Date, Date][] = [
    ["christmas", on(2026, 11, 29), on(2026, 11, 28)], // first Sunday of Advent 2026
    ["christmas", on(2027, 1, 6), on(2027, 1, 7)],
    ["new_year", on(2026, 12, 31), on(2026, 12, 30)],
    ["lunar_new_year", on(2026, 2, 17), on(2026, 3, 10)], // Year of the Horse: 17 February 2026
    ["lunar_new_year", on(2027, 2, 6), on(2027, 1, 20)],
    ["carnival", on(2026, 2, 16), on(2026, 2, 19)], // Rosenmontag 16 February, Ash Wednesday 18th
    ["easter", on(2026, 4, 6), on(2026, 4, 8)],
    ["passover", on(2026, 4, 3), on(2026, 4, 20)], // 15 Nisan 5786 = 2 April 2026
    ["ramadan", on(2026, 3, 1), on(2026, 4, 10)], // about 18 February to 19 March 2026
    ["eid_al_adha", on(2026, 5, 27), on(2026, 6, 10)],
    ["holi", on(2026, 3, 4), on(2026, 3, 20)],
    ["mid_autumn", on(2026, 9, 25), on(2026, 10, 5)],
    ["halloween", on(2026, 10, 31), on(2026, 11, 5)],
    ["diwali", on(2026, 11, 8), on(2026, 11, 20)],
    ["diwali", on(2025, 10, 21), on(2025, 11, 5)],
    ["thanksgiving", on(2026, 11, 26), on(2026, 11, 10)],
    ["hanukkah", on(2026, 12, 6), on(2026, 12, 20)], // 25 Kislev 5787 = 5 December 2026
    ["sinterklaas", on(2026, 12, 5), on(2026, 12, 6)],
    ["winter", on(2027, 1, 15), on(2027, 4, 15)],
    ["12-20/01-02", on(2027, 1, 2), on(2027, 1, 3)],
    ["06-01/06-30", on(2026, 6, 15), on(2026, 7, 1)],
  ];
  for (const [spec, inside, outside] of cases)
    it(`${spec}: ${inside.toDateString()} yes, ${outside.toDateString()} no`, () => {
      expect(inSeason(spec, inside)).toBe(true);
      expect(inSeason(spec, outside)).toBe(false);
    });

  it("turns the seasons round in the southern hemisphere", () => {
    expect(inSeason("summer", on(2027, 1, 15), true)).toBe(true);
    expect(inSeason("winter", on(2027, 7, 15), true)).toBe(true);
    expect(inSeason("winter", on(2027, 1, 15), true)).toBe(false);
  });

  it("every named season holds on some day of a year", () => {
    for (const s of SEASONS) {
      let days = 0;
      for (let d = 0; d < 366; d++) if (inSeason(s, new Date(2026, 0, 1 + d, 12))) days++;
      expect([s, days > 0 && days < 200]).toEqual([s, true]);
    }
  });

  it("knows what it accepts", () => {
    expect(isSeasonSpec("halloween")).toBe(true);
    expect(isSeasonSpec("12-01/01-06")).toBe(true);
    expect(isSeasonSpec("02-30/03-01")).toBe(false);
    expect(isSeasonSpec("13-01/01-06")).toBe(false);
    expect(isSeasonSpec("xmas")).toBe(false);
    expect(dayRange("02-29/03-01")).toEqual([[2, 29], [3, 1]]);
  });
});
