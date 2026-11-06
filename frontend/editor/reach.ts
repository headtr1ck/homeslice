// Where a built-in piece reaches beyond its outline on the plan: an open wall bed lies in
// front of its cabinet, a sofa bed's mattress is pulled out, a trundle out to the side.
// Measured from the piece's own drawing, once per size and choice.
import * as THREE from "three";
import { buildModern } from "../render/modern";
import { MODERN, resolveKind } from "../model/modern";

type Footprint = [number, number, number, number];
const measured = new Map<string, Footprint | null>();

/**
 * The footprint [minX, minZ, maxX, maxZ] (metres, the piece's own frame: front at +z) of a
 * piece that reaches past its w × d, or null when it stays inside (or isn't a built-in one
 * that can: ModernKind.reach).
 */
export function pieceReach(model: string | undefined, size: [number, number], height: number, options?: Record<string, string>): Footprint | null {
  if (!model?.startsWith("modern:")) return null;
  const { id } = resolveKind(model.slice(7), options);
  if (!MODERN[id]?.reach) return null;
  const key = JSON.stringify([model, size, height, options ?? {}]);
  if (measured.has(key)) return measured.get(key)!;
  let found: Footprint | null = null;
  const piece = buildModern(model.slice(7), size, height, undefined, undefined, options ?? {});
  if (piece) {
    piece.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(piece);
    const [w, d] = size;
    const out = box.min.x < -w / 2 - 0.03 || box.max.x > w / 2 + 0.03 || box.min.z < -d / 2 - 0.03 || box.max.z > d / 2 + 0.03;
    if (out) found = [Math.min(box.min.x, -w / 2), Math.min(box.min.z, -d / 2), Math.max(box.max.x, w / 2), Math.max(box.max.z, d / 2)];
    piece.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
  }
  measured.set(key, found);
  return found;
}
