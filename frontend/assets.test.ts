// Checks on every piece in the furniture library, so new ones (e.g. from a pull request)
// can't break the editor or the cards: it builds, fits its box, stays light enough for a
// wall tablet, has its pictures and names, and every type has a piece to draw.
import { existsSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import en from "./i18n/en.json";
import de from "./i18n/de.json";
import { FURNITURE, FURNITURE_TYPES } from "./model/furniture";
import { FINISHES, MODERN, MODERN_GROUPS, defaultKind } from "./model/modern";
import { buildModern } from "./render/modern";

/** Triangles a single piece may have (a garden of trees must still run on a tablet). */
const MAX_TRIANGLES = 40_000;

const triangles = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((x) => {
    if (x instanceof THREE.Mesh) n += (x.geometry.index?.count ?? x.geometry.attributes.position.count) / 3;
  });
  return n;
};
const hasNaN = (o: THREE.Object3D) => {
  let bad = false;
  o.traverse((x) => {
    if (x instanceof THREE.Mesh && (x.geometry.attributes.position.array as Float32Array).some((n) => !Number.isFinite(n))) bad = true;
  });
  return bad;
};
const picture = (path: string) => existsSync(`assets/${path}.png`);

describe("Modern pieces", () => {
  const kinds = MODERN_GROUPS.flatMap((g) => g.kinds);

  it("have unique ids, known types and finishes", () => {
    expect(new Set(kinds.map((k) => k.id)).size).toBe(kinds.length);
    for (const k of kinds) {
      expect(FURNITURE[k.type], k.id).toBeDefined();
      expect(k.finishes.length, k.id).toBeGreaterThan(0);
      for (const f of k.finishes) expect(FINISHES[f], `${k.id}: finish ${f}`).toBeDefined();
    }
  });

  for (const k of kinds)
    it(`${k.id}: builds at its size and others, fits its box, stays light`, () => {
      for (const s of [1, 0.7, 1.6]) {
        const [w, d, h] = [k.size[0] * s, k.size[1] * s, k.size[2] * (s > 1 ? 1.2 : s)];
        const piece = buildModern(k.id, [w, d], h, k.finishes.at(-1));
        expect(piece, k.id).not.toBeNull();
        expect(hasNaN(piece!), `${k.id}: NaN in its geometry`).toBe(false);
        expect(triangles(piece!), `${k.id}: triangles`).toBeLessThan(MAX_TRIANGLES);
        const box = new THREE.Box3().setFromObject(piece!);
        const size = box.getSize(new THREE.Vector3());
        // taps, lamp arms and leaves may reach a little out of the box, not more
        const slack = (m: number) => m * 1.12 + 0.2;
        expect(size.x, `${k.id}: width at ${s}×`).toBeLessThan(slack(w));
        expect(size.z, `${k.id}: depth at ${s}×`).toBeLessThan(slack(d));
        expect(size.y, `${k.id}: height at ${s}×`).toBeLessThan(slack(h));
        expect(box.min.y, `${k.id}: below its floor`).toBeGreaterThan(-0.05);
      }
    });

  it("have names in every language and their pictures", () => {
    for (const k of kinds) {
      expect((en as Record<string, string>)[`modern.${k.id}`], k.id).toBeTruthy();
      expect((de as Record<string, string>)[`modern.${k.id}`], k.id).toBeTruthy();
      expect(picture(`thumbs/modern/${k.id}`), `thumbs/modern/${k.id}.png: run node scripts/thumbnails.mjs`).toBe(true);
      expect(picture(`plan/modern/${k.id}`), `plan/modern/${k.id}.png`).toBe(true);
    }
    for (const f of Object.keys(FINISHES)) expect((en as Record<string, string>)[`finish.${f}`], f).toBeTruthy();
  });

  it("are all in the catalogue", () => {
    expect(Object.keys(MODERN).sort()).toEqual(kinds.map((k) => k.id).sort());
  });
});

describe("furniture types", () => {
  it("each has its pictures and a name", () => {
    for (const t of FURNITURE_TYPES) {
      expect(picture(`thumbs/${t}`) && picture(`plan/${t}`), t).toBe(true);
      expect(picture(`thumbs/builtin/${t}`) && picture(`plan/builtin/${t}`), `builtin ${t}`).toBe(true);
      expect((en as Record<string, string>)[`furniture.${t}`], t).toBeTruthy();
    }
  });

  it("each has a built-in piece the cards draw in detail (except item), of its own type", () => {
    for (const t of FURNITURE_TYPES) {
      if (t === "item") continue;
      const kind = defaultKind(t);
      expect(kind && MODERN[kind], t).toBeTruthy();
      expect(MODERN[kind!].type, `${t}: ${kind}`).toBe(t === "bench" || t === "tv" ? MODERN[kind!].type : t);
    }
    expect(MODERN[defaultKind("tv", "wall")!]).toBeTruthy();
  });
});
