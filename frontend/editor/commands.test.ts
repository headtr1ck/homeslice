import { describe, expect, it } from "vitest";
import { type Command, searchCommands } from "./commands";

const c = (id: string, label: string, words = ""): Command => ({ id, label, words, run: () => undefined });
const all = [
  c("rect", "Draw a room (R)", "rectangle shape polygon"),
  c("balcony", "Draw a balcony or terrace (B)", "loggia deck"),
  c("railing", "Draw a railing (G)", "fence banister balustrade"),
  c("roof", "Add a roof level", "attic solar panels"),
  c("room:kitchen", "Kitchen", "ground floor"),
];
const ids = (q: string) => searchCommands(all, q).map((x) => x.id);

describe("command search", () => {
  it("finds by label first, then by other words", () => {
    expect(ids("balc")[0]).toBe("balcony");
    expect(ids("fence")).toEqual(["railing"]);
    expect(ids("roof")[0]).toBe("roof");
    expect(ids("solar")).toEqual(["roof"]);
    expect(ids("kitchen")).toEqual(["room:kitchen"]);
  });
  it("forgives a typo, and gives everything for no query", () => {
    expect(ids("balcony")[0]).toBe("balcony");
    expect(ids("railng")[0]).toBe("railing");
    expect(ids("")).toHaveLength(all.length);
    expect(ids("xyzzy")).toEqual([]);
  });
});
