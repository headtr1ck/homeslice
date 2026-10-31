// Detailed furniture: Kenney's CC0 models (assets/models), loaded only when a card
// asks for them and only for the types its house uses. Each model is fitted into the
// piece's box; long pieces (kitchen counters, wardrobes) repeat a unit instead of
// stretching it.

import * as THREE from "three";
import type { FurnitureType } from "../model/types";

/** A model in part of the piece's box: `y`/`height` in metres, or a share of the height. */
interface Part {
  /** One file, or several used in turn along the width. */
  files: string[];
  /** Repeat units along the width (about square each) instead of stretching one. */
  tile?: boolean;
  /** Height of the part as a share of the piece's height (default 1), from `y` (share). */
  height?: number;
  y?: number;
  /** Width and depth as a share of the piece's (default 1); the part stays at the back. */
  width?: number;
  depth?: number;
}

const one = (file: string): Part[] => [{ files: [file] }];

export const MODELS: Partial<Record<FurnitureType, Part[]>> = {
  sofa: one("loungeSofa"),
  sofa_corner: one("loungeSofaCorner"),
  coffee_table: one("tableCoffee"),
  rug: one("rugRectangle"),
  floor_lamp: one("lampSquareFloor"),
  nightstand: one("cabinetBedDrawer"),
  kitchen_upper: [{ files: ["kitchenCabinetUpper"], tile: true }],
  mirror: one("bathroomMirror"),
  wall_lamp: one("lampWall"),
  ceiling_lamp: one("lampSquareCeiling"),
  ceiling_fan: one("ceilingFan"),
  tree: one("tree_oak_dark"),
  tree_small: one("tree_default_dark"),
  pine: one("tree_pineRoundC"),
  // bush and hedge are built in code (PROCEDURAL): the kit's bushes look like weeds
  bush: [],
  hedge: [],
  flower_bed: [{ files: ["flower_redA", "flower_yellowA", "flower_purpleA"], tile: true }],
  fence: [{ files: ["fence_simple"], tile: true }],
  garden_path: [{ files: ["path_stone"], tile: true }],
  bench: one("bench"),
  armchair: one("loungeChair"),
  table: one("table"),
  chair: one("chair"),
  bed: one("bedDouble"),
  bed_single: one("bedSingle"),
  desk: one("desk"),
  wardrobe: [{ files: ["bookcaseClosedDoors"], tile: true }],
  shelf: [{ files: ["bookcaseClosedWide"], tile: true }],
  // a run of cabinets with a sink and a stove, like a real kitchen
  kitchen: [{ files: ["kitchenCabinetDrawer", "kitchenSink", "kitchenCabinet", "kitchenStove", "kitchenCabinetDrawer", "kitchenCabinet"], tile: true }],
  tv: [
    { files: ["cabinetTelevision"], height: 0.38 },
    { files: ["televisionModern"], y: 0.4, height: 0.6, width: 0.85, depth: 0.3 },
  ],
  bathtub: one("bathtub"),
  shower: one("shower"),
  toilet: one("toilet"),
  sink: one("bathroomSink"),
  plant: one("pottedPlant"),
  car: one("sedan"),
  washer: one("washer"),
  dryer: one("dryer"),
  fridge: one("kitchenFridge"),
};

/** Pieces that look different on a wall: a TV without its stand. */
export const WALL_MODELS: Partial<Record<FurnitureType, Part[]>> = {
  tv: [{ files: ["televisionModern"], height: 0.55 }],
};

/** The parts of a piece as mounted. */
export function partsFor(type: FurnitureType, mount: string): Part[] | undefined {
  return (mount === "wall" ? WALL_MODELS[type] : undefined) ?? MODELS[type];
}

/** Leaves, in the same colour as the trees' (through `modelColor`). */
const LEAVES = new THREE.MeshStandardMaterial({ name: "leafsDark" });

/** Low-poly leaf clumps filling a box: overlapping blobs, a little irregular but the same every time. */
function leafClumps(size: [number, number], height: number, leaves: THREE.Material, count: number): THREE.Group {
  const g = new THREE.Group();
  const [w, d] = size;
  const geo = new THREE.IcosahedronGeometry(0.5, 1);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const wobble = Math.sin(i * 12.9898) * 0.5 + 0.5; // deterministic
    const sx = Math.min(w, d) * (1 + 0.25 * wobble);
    const blob = new THREE.Mesh(geo, leaves);
    blob.scale.set(count === 1 ? w : Math.max(sx, w / count * 1.6), height * (0.9 + 0.2 * wobble), d);
    blob.position.set(count === 1 ? 0 : -w / 2 + sx / 2 + t * Math.max(0, w - sx), blob.scale.y / 2, (wobble - 0.5) * d * 0.1);
    blob.castShadow = blob.receiveShadow = true;
    g.add(blob);
  }
  return g;
}

/** Pieces drawn in code instead of from a model file. */
const PROCEDURAL: Partial<Record<FurnitureType, (size: [number, number], height: number, leaves: THREE.Material) => THREE.Group>> = {
  bush: (size, height, leaves) => leafClumps(size, height, leaves, 1),
  // a hedge: clumps along its length, about one per metre
  hedge: (size, height, leaves) => leafClumps(size, height, leaves, Math.max(2, Math.round(size[0] / 0.9))),
};

/** Kenney's nature colours are stylised (turquoise leaves): natural ones fit a house better. */
const NATURAL: Record<string, string> = {
  leafs: "#5e9b4a",
  leafsDark: "#3f7a3a",
  leafsFall: "#c98a3a",
  grass: "#6aa84f",
  woodBark: "#7a5a43",
  woodBarkDark: "#5e4433",
  stone: "#c9c4ba",
  stoneDark: "#a39e94",
};

/** A model material's colour, natural for the nature models. */
export function modelColor(source: THREE.Material): THREE.Color {
  const natural = NATURAL[source.name];
  return natural ? new THREE.Color(natural) : ((source as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(0xffffff));
}

/** Where the models are: next to the bundle (Home Assistant serves the whole folder). */
const BASE = new URL(/* @vite-ignore */ "models/", import.meta.url);

const cache = new Map<string, Promise<THREE.Object3D | null>>();

/** A model, loaded once per page; null if it can't be loaded. */
export function loadModel(file: string): Promise<THREE.Object3D | null> {
  let p = cache.get(file);
  if (!p) {
    // the loader is only fetched by cards that show detailed furniture
    p = import("three/examples/jsm/loaders/GLTFLoader.js")
      .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(new URL(`${file}.glb`, BASE).href))
      .then((gltf) => {
        gltf.scene.traverse((o) => (o.userData.shared = true));
        return gltf.scene;
      })
      .catch(() => null);
    cache.set(file, p);
  }
  return p;
}

/** The files a piece needs. */
export function modelFiles(type: FurnitureType, mount = "floor"): string[] {
  return [...new Set((partsFor(type, mount) ?? []).flatMap((p) => p.files))];
}

/** Most a model is stretched more along one side than the other. */
const MAX_STRETCH = 1.4;

/**
 * The detailed piece, in the same frame as the simple one (centred, back to -z, on the
 * floor), from loaded models; null if any is missing. `material` turns the models'
 * own materials into the level's (so they fade with it).
 */
export function buildPiece(
  type: FurnitureType,
  mount: string,
  size: [number, number],
  height: number,
  models: Map<string, THREE.Object3D | null>,
  material: (source: THREE.Material) => THREE.Material,
): THREE.Group | null {
  const build = PROCEDURAL[type];
  if (build) return build(size, height, material(LEAVES));
  const parts = partsFor(type, mount);
  if (!parts) return null;
  const g = new THREE.Group();
  const [w, d] = size;
  for (const part of parts) {
    const pw = w * (part.width ?? 1);
    const pd = d * (part.depth ?? 1);
    const ph = height * (part.height ?? 1);
    const y0 = height * (part.y ?? 0);
    const z0 = -d / 2 + pd / 2; // narrower parts stand at the back
    const first = models.get(part.files[0]);
    if (!first) return null;
    const unit = boxOf(first).getSize(new THREE.Vector3());
    // units about as wide as their depth suggests, at least one
    const count = part.tile ? Math.max(1, Math.round(pw / ((unit.x * pd) / unit.z))) : 1;
    for (let i = 0; i < count; i++) {
      const model = models.get(part.files[i % part.files.length]);
      if (!model) return null;
      const box = boxOf(model);
      const s = box.getSize(new THREE.Vector3());
      let sx = pw / count / s.x;
      let sz = pd / s.z;
      // keep proportions within reason: a 4.6 m car spot gets a long car, not a stretched one
      // (thin pieces like mirrors are as deep as they are, whatever their width)
      if (!part.tile && Math.min(pw, pd) >= 0.2) {
        if (sx > sz * MAX_STRETCH) sx = sz * MAX_STRETCH;
        if (sz > sx * MAX_STRETCH) sz = sx * MAX_STRETCH;
      }
      const sy = ph / s.y;
      const copy = model.clone(true);
      copy.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.material = Array.isArray(o.material) ? o.material.map(material) : material(o.material);
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const centre = box.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      copy.position.set(-centre.x, -box.min.y, -centre.z);
      holder.add(copy);
      holder.scale.set(sx, sy, sz);
      holder.position.set(-pw / 2 + (pw / count) * (i + 0.5), y0, z0);
      g.add(holder);
    }
  }
  return g;
}

const boxes = new WeakMap<THREE.Object3D, THREE.Box3>();
function boxOf(model: THREE.Object3D): THREE.Box3 {
  let b = boxes.get(model);
  if (!b) {
    b = new THREE.Box3().setFromObject(model);
    boxes.set(model, b);
  }
  return b;
}
