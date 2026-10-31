import { describe, expect, it } from "vitest";
import { allowedModelUrl } from "./models";

describe("allowedModelUrl", () => {
  const origins = ["http://ha.local:8123", "https://cdn.example"];
  it("allows the own server and embedded data", () => {
    expect(allowedModelUrl("http://ha.local:8123/homeslice_assets/custom/a.glb", origins)).toBe(true);
    expect(allowedModelUrl("data:image/png;base64,AA", origins)).toBe(true);
    expect(allowedModelUrl("blob:http://ha.local:8123/1", origins)).toBe(true);
  });
  it("refuses other sites", () => {
    expect(allowedModelUrl("https://tracker.example/p.png", origins)).toBe(false);
    expect(allowedModelUrl("//tracker.example/p.png", origins)).toBe(false);
    expect(allowedModelUrl("http://ha.local:8124/x.bin", origins)).toBe(false);
  });
});
