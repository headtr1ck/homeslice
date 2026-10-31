import { describe, expect, it } from "vitest";
import { calloutLayout } from "./homeslice-card";

describe("energy callouts", () => {
  const house = { left: 300, right: 700, top: 50, bottom: 650 };
  const size = { width: 1000, height: 700 };
  it("puts labels beside the house on their marker's side, in order, without overlaps", () => {
    const out = calloutLayout(
      [
        { key: "a", mx: 400, my: 500 },
        { key: "b", mx: 410, my: 505 },
        { key: "c", mx: 420, my: 495 },
        { key: "d", mx: 600, my: 200 },
      ],
      house,
      size,
    );
    const left = out.filter((l) => l.place === "left").sort((p, q) => p.y - q.y);
    expect(left.map((l) => l.key)).toEqual(["c", "a", "b"]);
    expect(left.every((l) => l.x === 284)).toBe(true);
    for (let i = 1; i < left.length; i++) expect(left[i].y - left[i - 1].y).toBeGreaterThanOrEqual(42);
    expect(out.find((l) => l.key === "d")).toMatchObject({ place: "right", x: 716, y: 200 });
  });
  it("keeps a long column on the card", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ key: String(i), mx: 350, my: 690 }));
    const out = calloutLayout(many, house, size);
    expect(Math.max(...out.map((l) => l.y))).toBeLessThanOrEqual(700 - 21);
    expect(Math.min(...out.map((l) => l.y))).toBeGreaterThanOrEqual(21);
  });
});
