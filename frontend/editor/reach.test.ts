import { describe, expect, it } from "vitest";
import { modernGroups } from "./library";
import { pieceReach } from "./reach";

describe("how far a piece reaches past its outline", () => {
  it("an open wall bed lies in front of its cabinet; closed it stays inside", () => {
    const open = pieceReach("modern:bed_murphy", [1.6, 0.45], 2.25, { position: "open" });
    expect(open).not.toBeNull();
    expect(open![3]).toBeGreaterThan(1.5);
    expect(pieceReach("modern:bed_murphy", [1.6, 0.45], 2.25, { position: "closed" })).toBeNull();
  });
  it("an open sofa bed reaches forward, a trundle to the side", () => {
    expect(pieceReach("modern:sofa_bed", [2.0, 0.95], 0.85, { position: "open" })![3]).toBeGreaterThan(0.95);
    expect(pieceReach("modern:bed_trundle", [0.98, 2.08], 0.85)![2]).toBeGreaterThan(0.8);
  });
  it("other pieces aren't measured", () => {
    expect(pieceReach("modern:sofa", [2.2, 0.95], 0.8)).toBeNull();
    expect(pieceReach(undefined, [1, 1], 1)).toBeNull();
  });
});

describe("seasonal decoration in the library", () => {
  it("carries its season, other pieces none", () => {
    const items = modernGroups().flatMap((g) => g.items);
    expect(items.find((i) => i.key === "modern:christmas_tree")?.season).toBe("christmas");
    expect(items.find((i) => i.key === "modern:menorah")?.season).toBe("hanukkah");
    expect(items.find((i) => i.key === "modern:sofa")?.season).toBeUndefined();
  });
});
