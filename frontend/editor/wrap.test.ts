import { describe, expect, it } from "vitest";
import { wrapWords } from "./homeslice-panel";

describe("room names on the plan", () => {
  it("break between words to fit", () => {
    expect(wrapWords("Guest Bathroom", 20)).toEqual(["Guest Bathroom"]);
    expect(wrapWords("Guest Bathroom", 8)).toEqual(["Guest", "Bathroom"]);
    expect(wrapWords("Living and dining room", 12)).toEqual(["Living and", "dining room"]);
    expect(wrapWords("Wintergarten", 4)).toEqual(["Wintergarten"]);
  });
});
