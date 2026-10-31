// Furniture models from outside Homeslice: Poly Haven's (downloaded into Home Assistant)
// and uploaded ones, loaded only when a card shows them. Homeslice's own pieces are
// drawn in code (modern.ts); a type without a model gets its default piece.

import * as THREE from "three";
import { defaultKind } from "../model/modern";
import type { FurnitureType } from "../model/types";

/** How a piece is drawn in detail: a built-in piece (`kind`), a model file, or neither. */
export function detailFor(f: { type: FurnitureType; mount?: string; model?: string }): { kind: string } | { file: string } | null {
  const m = f.model;
  if (m === "builtin") return null;
  if (m?.startsWith("modern:")) return { kind: m.slice(7) };
  if (m?.startsWith("polyhaven:") || m?.startsWith("custom:")) return { file: m };
  // no model, or one of the Kenney models Homeslice once bundled: the type's own piece
  const kind = defaultKind(f.type, f.mount);
  return kind ? { kind } : null;
}

/** A model material's colour. */
export function modelColor(source: THREE.Material): THREE.Color {
  return (source as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(0xffffff);
}

/** Poly Haven's and uploaded models, served by the integration. */
const ASSETS = "/homeslice_assets";

/** The URL of a model, from a reference like `polyhaven:Sofa_01` or `custom:<id>`. */
export function modelUrl(key: string): string {
  const [source, id] = key.split(":", 2);
  if (source === "polyhaven") return new URL(`${ASSETS}/polyhaven/${id}/${id}_1k.gltf`, location.origin).href;
  return new URL(`${ASSETS}/custom/${id}.glb`, location.origin).href;
}

/**
 * What a model may load: files of this page's own server (or the bundle's) and embedded
 * data. A model naming another site would make every screen showing the house contact
 * it; the integration refuses such models, this also covers files that got there anyway.
 */
export function allowedModelUrl(url: string, origins = [location.origin]): boolean {
  if (/^(data|blob):/.test(url)) return true;
  try {
    return origins.includes(new URL(url, globalThis.location?.href ?? origins[0]).origin);
  } catch {
    return false;
  }
}

let manager: THREE.LoadingManager | undefined;
function loadingManager(): THREE.LoadingManager {
  if (!manager) {
    manager = new THREE.LoadingManager();
    // an empty data: URL fails to load like a missing file
    manager.setURLModifier((url) => (allowedModelUrl(url) ? url : "data:,"));
  }
  return manager;
}

const cache = new Map<string, Promise<THREE.Object3D | null>>();

/** A model, loaded once per page; null if it can't be loaded. */
export function loadModel(file: string): Promise<THREE.Object3D | null> {
  let p = cache.get(file);
  if (!p) {
    // the loader is only fetched by cards that show detailed furniture
    p = import("three/examples/jsm/loaders/GLTFLoader.js")
      .then(({ GLTFLoader }) => new GLTFLoader(loadingManager()).loadAsync(modelUrl(file)))
      .then((gltf) => {
        gltf.scene.traverse((o) => (o.userData.shared = true));
        return gltf.scene;
      })
      .catch(() => null);
    cache.set(file, p);
  }
  return p;
}

/**
 * A loaded model fitted into a piece's box (centred, back to -z, on the floor); `material`
 * turns its own materials into the level's (so they fade with it).
 */
export function fitModel(model: THREE.Object3D, size: [number, number], height: number, material: (source: THREE.Material) => THREE.Material): THREE.Group {
  const box = boxOf(model);
  const s = box.getSize(new THREE.Vector3());
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
  holder.scale.set(size[0] / s.x, height / s.y, size[1] / s.z);
  const g = new THREE.Group();
  g.add(holder);
  return g;
}

/** Bounding boxes of loaded models, measured once. */
const boxes = new WeakMap<THREE.Object3D, THREE.Box3>();
function boxOf(model: THREE.Object3D): THREE.Box3 {
  let b = boxes.get(model);
  if (!b) {
    b = new THREE.Box3().setFromObject(model);
    boxes.set(model, b);
  }
  return b;
}
