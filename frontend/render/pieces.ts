// A house's own pieces (PieceInput): boxes, cylinders, tapers and spheres in finishes,
// stretched to the size a placed piece has.
import * as THREE from "three";
import { FINISHES } from "../model/modern";
import type { PieceInput } from "../model/types";

const materials = new Map<string, THREE.MeshStandardMaterial>();

/** A finish name or a #colour as a material; glowing parts light up with their lamp. */
function material(finish: string | undefined, fallback: string, glow: boolean) {
  const color = finish?.startsWith("#") ? finish : FINISHES[finish ?? ""] ?? FINISHES[fallback] ?? fallback;
  const key = `${color}/${glow}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    if (glow) m.userData.glow = true;
    materials.set(key, m);
  }
  return m;
}

/** The piece at `size` (width, depth) and `height`, in a placed piece's frame (front to +z). */
export function buildPiece(def: PieceInput, size: [number, number], height: number, finish?: string): THREE.Group {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  for (const p of def.parts) {
    const [w, d, h] = p.size;
    let geo: THREE.BufferGeometry;
    if (p.shape === "box") geo = new THREE.BoxGeometry(w, h, d);
    else if (p.shape === "sphere") geo = new THREE.SphereGeometry(0.5, 20, 14).scale(w, h, d).translate(0, 0, 0);
    else {
      // a cylinder or a taper of unit radius, stretched to its width and depth
      const top = p.shape === "taper" ? Math.max(0, Math.min(1, p.top ?? 0.6)) : 1;
      geo = new THREE.CylinderGeometry(0.5 * top, 0.5, h, 24).scale(w, 1, d);
    }
    const mesh = new THREE.Mesh(geo, material(p.finish, finish ?? "white", !!p.glow));
    const [x, z, y] = p.at ?? [0, 0, 0];
    mesh.position.set(x, y + h / 2, z);
    if (p.rotate) mesh.rotation.y = -(p.rotate * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    inner.add(mesh);
  }
  // stretched from the piece's own size to the placed one
  inner.scale.set(size[0] / def.size[0], height / def.size[2], size[1] / def.size[1]);
  g.add(inner);
  return g;
}
