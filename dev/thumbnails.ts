// Renders the editor's library pictures (scripts/thumbnails.mjs runs this in headless
// Chromium): every furniture type as the cards draw it by default, as built-in shapes,
// and every Kenney model of the library, each also from straight above (for the plan),
// plus the Kenney models' sizes in metres.
import * as THREE from "three";
import { FURNITURE, FURNITURE_TYPES } from "../frontend/model/furniture";
import type { FurnitureType } from "../frontend/model/types";
import { KENNEY_ITEMS } from "../frontend/editor/kenney";
import { buildPiece, loadModel, modelColor, modelFiles } from "../frontend/render/models";
import { simplePiece } from "../frontend/render/simple";
import { buildModern } from "../frontend/render/modern";
import { MODERN_GROUPS } from "../frontend/model/modern";

const SIZE = 160;

/** Pixels per metre of the top-down pictures the editor's plan draws pieces with. */
const PLAN_PX = 64;

/**
 * Kenney's kits each have their own scale. Furniture: one known size for the whole kit;
 * nature models (whose kit mixes scales) as tall as their type usually is; cars at a
 * normal car's width and height.
 */
const CARS = new Set(["sedan", "suv", "suv-luxury", "hatchback-sports", "van", "delivery", "taxi", "police"]);
const kitOf = (file: string) => (CARS.has(file) ? "car" : file.includes("_") ? "nature" : "furniture");
const REFERENCE: Record<string, { file: string; metres: number; along: "long" | "height" }> = {
  furniture: { file: "bedDouble", metres: 2.05, along: "long" },
  car: { file: "sedan", metres: 4.6, along: "long" },
};

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);

const lambert = new Map<THREE.Material, THREE.Material>();
const convert = (src: THREE.Material) => {
  let m = lambert.get(src);
  if (!m) {
    const s = src as THREE.MeshStandardMaterial;
    m = new THREE.MeshLambertMaterial({ color: modelColor(src), map: s.map ?? null, transparent: s.transparent, opacity: s.opacity, side: s.side, emissive: s.emissive ?? 0x000000 });
    lambert.set(src, m);
  }
  return m;
};
const simpleMaterials = new Map<string, THREE.MeshLambertMaterial>();
const simpleMaterial = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => {
  const key = color + (extra.opacity ?? "");
  let m = simpleMaterials.get(key);
  if (!m) simpleMaterials.set(key, (m = new THREE.MeshLambertMaterial({ color, ...extra })));
  return m;
};

/** A picture from the front right and above, and one from straight above at the piece's size. */
function shoot(piece: THREE.Object3D, size: [number, number]): { thumb: string; plan: string } {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(2, 4, 3);
  scene.add(sun, piece);
  const box = new THREE.Box3().setFromObject(piece);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const dir = new THREE.Vector3(0.55, 0.6, 1).normalize();
  camera.position.copy(centre).addScaledVector(dir, (radius / Math.sin((15 * Math.PI) / 180)) * 1.02);
  camera.lookAt(centre);
  renderer.setSize(SIZE, SIZE);
  renderer.render(scene, camera);
  const thumb = renderer.domElement.toDataURL("image/png");
  // straight from above, framed on the footprint: north (the back) at the top
  const [w, d] = size;
  const top = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0.01, 50);
  top.position.set(0, 20, 0);
  top.up.set(0, 0, -1);
  top.lookAt(0, 0, 0);
  sun.position.set(1, 6, 2);
  renderer.setSize(Math.max(8, Math.round(w * PLAN_PX)), Math.max(8, Math.round(d * PLAN_PX)));
  renderer.render(scene, top);
  return { thumb, plan: renderer.domElement.toDataURL("image/png") };
}

async function piece(type: FurnitureType, size: [number, number], height: number, model?: string) {
  const mount = FURNITURE[type].mount ?? "floor";
  const files = modelFiles(type, mount, model);
  const models = new Map(await Promise.all(files.map(async (f) => [f, await loadModel(f)] as const)));
  return buildPiece(type, mount, size, height, models, convert, model);
}

async function render() {
  const thumbs: Record<string, string> = {};
  const plans: Record<string, string> = {};
  const add = (key: string, shot: { thumb: string; plan: string }) => {
    thumbs[key] = shot.thumb;
    plans[key] = shot.plan;
  };
  for (const type of FURNITURE_TYPES) {
    const def = FURNITURE[type];
    // as cards draw it by default (the detailed model where there is one)
    const detailed = await piece(type, def.size, def.height);
    add(type, shoot(detailed ?? simplePiece({ type, size: def.size, height: def.height, mount: def.mount }, simpleMaterial, (g, m) => new THREE.Mesh(g, m)), def.size));
    add(`builtin/${type}`, shoot(simplePiece({ type, size: def.size, height: def.height, mount: def.mount }, simpleMaterial, (g, m) => new THREE.Mesh(g, m)), def.size));
  }
  // Kenney's models at their own size
  const scale: Record<string, number> = {};
  for (const [kit, ref] of Object.entries(REFERENCE)) {
    const model = await loadModel(ref.file);
    if (!model) throw new Error(`no ${ref.file}`);
    const s = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    scale[kit] = ref.metres / (ref.along === "height" ? s.y : Math.max(s.x, s.z));
  }
  const sizes: Record<string, [number, number, number]> = {};
  for (const item of KENNEY_ITEMS) {
    if (sizes[item.file]) continue;
    const model = await loadModel(item.file);
    if (!model) throw new Error(`no model ${item.file}`);
    const s = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const kit = kitOf(item.file);
    const k = kit === "nature" ? FURNITURE[item.type].height / s.y : scale[kit];
    const round = (v: number) => Math.max(0.02, Math.round(v * k * 100) / 100);
    sizes[item.file] = kit === "car" ? [FURNITURE.car.size[0], round(Math.max(s.x, s.z)), FURNITURE.car.height] : [round(s.x), round(s.z), round(s.y)];
    const [w, d, h] = sizes[item.file];
    const p = await piece(item.type, [w, d], h, `kenney:${item.file}`);
    if (p) add(`kenney/${item.file}`, shoot(p, [w, d]));
  }
  // the Modern pieces, as drawn in code (with the cards' materials)
  for (const g of MODERN_GROUPS)
    for (const k of g.kinds) {
      const p = buildModern(k.id, [k.size[0], k.size[1]], k.size[2]);
      if (!p) throw new Error(`no modern piece ${k.id}`);
      p.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = convert(o.material as THREE.Material);
      });
      add(`modern/${k.id}`, shoot(p, [k.size[0], k.size[1]]));
    }
  return { thumbs, plans, sizes };
}

(window as unknown as { thumbnails: Promise<unknown> }).thumbnails = render();
