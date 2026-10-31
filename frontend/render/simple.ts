// The built-in furniture: simple shapes from boxes and cylinders, for every type. Light
// to draw on any device; detailed models replace them where a card asks for those.

import * as THREE from "three";
import type { FurnitureType } from "../model/types";

export interface SimpleSpec {
  type: FurnitureType;
  size: [number, number];
  height: number;
  mount?: string;
}

/** One material per colour (the caller shares them, so they fade with their level). */
export type MaterialFor = (color: string, extra?: THREE.MeshLambertMaterialParameters) => THREE.MeshLambertMaterial;
/** A mesh casting and receiving shadows. */
export type MeshFor = (geometry: THREE.BufferGeometry, material: THREE.Material) => THREE.Mesh;

/** The piece in its own frame: centred, its back to -z, on the floor. */
export function simplePiece(f: SimpleSpec, m: MaterialFor, mesh: MeshFor): THREE.Group {
  const g = new THREE.Group();
  const [w, d] = f.size;
  const fabric = m("#7d8794");
  const wood = m("#b08560");
  const white = m("#e9e7e2");
  const dark = m("#3a3f45");
  // a box from (x, y, z) of its bottom centre, in the piece's frame (z: south = front)
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const b = mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    b.position.set(x, y + bh / 2, z);
    g.add(b);
  };
  const back = -d / 2;
  switch (f.type) {
    case "sofa":
    case "armchair": {
      const arm = Math.min(0.2, w * 0.15);
      box(w, 0.42, d, 0, 0, 0, fabric);
      box(w, 0.4, 0.22, 0, 0.42, back + 0.11, fabric);
      box(arm, 0.2, d, -w / 2 + arm / 2, 0.42, 0, fabric);
      box(arm, 0.2, d, w / 2 - arm / 2, 0.42, 0, fabric);
      break;
    }
    case "table":
    case "desk": {
      box(w, 0.04, d, 0, f.height - 0.04, 0, wood);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.05, f.height - 0.04, 0.05, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), dark);
      break;
    }
    case "stool":
      box(w, 0.04, d, 0, f.height - 0.04, 0, wood);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.035, f.height - 0.04, 0.035, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04), dark);
      break;
    case "chair":
      box(w, 0.04, d, 0, 0.44, 0, wood);
      box(w, 0.45, 0.04, 0, 0.48, back + 0.02, wood);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.035, 0.44, 0.035, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03), dark);
      break;
    case "bed":
    case "bed_single": {
      box(w, 0.28, d, 0, 0, 0, wood);
      box(w - 0.06, 0.2, d - 0.08, 0, 0.28, 0.02, white);
      box(w, 0.9, 0.08, 0, 0, back + 0.04, wood);
      const pillows = f.type === "bed" ? 2 : 1;
      for (let i = 0; i < pillows; i++) box(w / pillows - 0.16, 0.1, 0.4, -w / 2 + (w / pillows) * (i + 0.5), 0.48, back + 0.32, m("#d5dbe3"));
      break;
    }
    case "wardrobe":
      box(w, f.height, d, 0, 0, 0, m("#d9d2c5"));
      box(0.01, f.height - 0.1, 0.01, 0, 0.05, d / 2, dark);
      break;
    case "shelf":
      for (let i = 0; i < 5; i++) box(w, 0.03, d, 0, (i * (f.height - 0.03)) / 4, 0, wood);
      box(0.03, f.height, d, -w / 2, 0, 0, wood);
      box(0.03, f.height, d, w / 2, 0, 0, wood);
      break;
    case "kitchen":
      box(w, 0.86, d, 0, 0, 0, white);
      box(w, 0.04, d + 0.02, 0, 0.86, 0, m("#5d5f62"));
      break;
    case "tv":
      // on a wall: the screen only
      if (f.mount === "wall") box(w, f.height * 0.55, Math.min(d, 0.06), 0, 0, back + Math.min(d, 0.06) / 2, dark);
      else {
        box(w, 0.45, d, 0, 0, 0, wood);
        box(w * 0.85, 0.62, 0.05, 0, 0.55, back + 0.1, dark);
      }
      break;
    case "coffee_table":
    case "side_table":
    case "nightstand":
    case "item":
      box(w, f.height, d, 0, 0, 0, wood);
      break;
    case "sofa_corner":
      box(w, 0.42, Math.min(d, 0.9), 0, 0, back + Math.min(d, 0.9) / 2, fabric);
      box(Math.min(w, 0.9), 0.42, d, -w / 2 + Math.min(w, 0.9) / 2, 0, 0, fabric);
      box(w, 0.4, 0.2, 0, 0.42, back + 0.1, fabric);
      break;
    case "rug":
      box(w, f.height, d, 0, 0, 0, m("#b9a48f"));
      break;
    case "kitchen_upper":
      box(w, f.height, d, 0, 0, 0, white);
      break;
    case "mirror":
      box(w, f.height, d, 0, 0, 0, m("#bcd7e6"));
      break;
    case "tree":
    case "tree_small":
    case "pine":
    case "bush": {
      // a trunk and a crown
      const trunk = f.type === "bush" ? 0 : f.height * 0.3;
      if (trunk) box(Math.min(w, d) * 0.08, trunk, Math.min(w, d) * 0.08, 0, 0, 0, wood);
      const crown = mesh(f.type === "pine" ? new THREE.ConeGeometry(0.5, 1, 12) : new THREE.SphereGeometry(0.5, 14, 10), m("#4f8a52"));
      crown.scale.set(w, f.height - trunk, d);
      crown.position.y = trunk + (f.height - trunk) / 2;
      g.add(crown);
      break;
    }
    case "hedge":
      box(w, f.height, d, 0, 0, 0, m("#4f8a52"));
      break;
    case "flower_bed":
      box(w, 0.15, d, 0, 0, 0, m("#7a5b44"));
      box(w * 0.9, f.height - 0.15, d * 0.8, 0, 0.15, 0, m("#c76b8f"));
      break;
    case "fence":
      box(w, f.height, Math.min(d, 0.05), 0, 0, 0, wood);
      break;
    case "garden_path":
      box(w, f.height, d, 0, 0, 0, m("#bdb5a6"));
      break;
    case "bench":
      box(w, f.height, d, 0, 0, 0, wood);
      break;
    case "floor_lamp":
    case "table_lamp":
    case "wall_lamp":
    case "ceiling_lamp":
    case "ceiling_fan":
      box(w, f.height, d, 0, 0, 0, m("#e8dcc0"));
      break;
    case "bathtub":
      box(w, 0.55, d, 0, 0, 0, white);
      box(w - 0.16, 0.01, d - 0.16, 0, 0.55, 0, m("#a9cde0"));
      break;
    case "shower": {
      box(w, 0.05, d, 0, 0, 0, white);
      const glass = m("#bfe0f0", { transparent: true, opacity: 0.3 });
      box(w, f.height, 0.02, 0, 0.05, d / 2, glass);
      box(0.02, f.height, d, w / 2, 0.05, 0, glass);
      break;
    }
    case "toilet":
      box(w * 0.9, 0.4, d * 0.65, 0, 0, d * 0.15, white);
      box(w, 0.35, 0.18, 0, 0.4, back + 0.09, white);
      break;
    case "sink":
      box(w, 0.8, d, 0, 0, 0, wood);
      box(w, 0.05, d, 0, 0.8, 0, white);
      break;
    case "plant": {
      const pot = mesh(new THREE.CylinderGeometry(w * 0.35, w * 0.28, 0.35, 16), m("#9b6a4b"));
      pot.position.y = 0.175;
      g.add(pot);
      const leaves = mesh(new THREE.SphereGeometry(w * 0.5, 16, 12), m("#4f8a52"));
      leaves.position.y = 0.35 + w * 0.5;
      leaves.scale.y = (f.height - 0.35) / w;
      g.add(leaves);
      break;
    }
    case "washer":
    case "dryer":
    case "fridge":
      box(w, f.height, d, 0, 0, 0, white);
      box(w * 0.8, 0.01, 0.01, 0, f.height * (f.type === "fridge" ? 0.6 : 0.9), d / 2, dark);
      break;
    case "car": {
      const paint = m("#3f6fa8");
      box(w, 0.65, d, 0, 0.28, 0, paint);
      box(w * 0.88, 0.5, d * 0.5, 0, 0.93, d * 0.02, m("#2b3440"));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const wheel = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 16), dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx * (w / 2 - 0.08), 0.32, sz * (d / 2 - 0.75));
        g.add(wheel);
      }
      break;
    }
  }
  return g;
}
