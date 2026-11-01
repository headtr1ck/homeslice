import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Weather, weatherEffect } from "./weather";

describe("weather around the house", () => {
  it("draws rain, snow and fog for HA's conditions, nothing for the rest", () => {
    expect(weatherEffect("pouring")).toEqual({ kind: "rain", amount: 1 });
    expect(weatherEffect("rainy")?.kind).toBe("rain");
    expect(weatherEffect("snowy")?.kind).toBe("snow");
    expect(weatherEffect("fog")?.kind).toBe("fog");
    expect(weatherEffect("sunny")).toBeNull();
    expect(weatherEffect(undefined)).toBeNull();
  });

  it("drops fall and come back in at the top", () => {
    const w = new Weather(100);
    const scene = new THREE.Scene();
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 6, 8));
    w.set({ kind: "rain", amount: 1 }, box, scene);
    expect(w.falling).toBe(true);
    for (let t = 1; t < 200; t++) w.step(t * 33);
    const ys = [...((w.object.children[0] as THREE.LineSegments).geometry.attributes.position.array as Float32Array)].filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(-2.5);
    expect(Math.max(...ys)).toBeLessThan(8.5);
    w.set({ kind: "fog", amount: 1 }, box, scene);
    expect(w.falling).toBe(false);
    expect(scene.fog).not.toBeNull();
    w.set(null, box, scene);
    expect(scene.fog).toBeNull();
  });
});
