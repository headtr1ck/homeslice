// Renders the editor's library pictures (scripts/thumbnails.mjs runs this in headless
// Chromium): every furniture type as the cards draw it by default and as simple shapes,
// and every built-in piece, each also from straight above (for the plan).
import * as THREE from "three";
import { FURNITURE, FURNITURE_TYPES } from "../frontend/model/furniture";
import { modelColor } from "../frontend/render/models";
import { simplePiece } from "../frontend/render/simple";
import { buildModern } from "../frontend/render/modern";
import { MODERN_GROUPS, defaultKind } from "../frontend/model/modern";

const SIZE = 160;

/** Pixels per metre of the top-down pictures the editor's plan draws pieces with. */
const PLAN_PX = 64;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);

const lambert = new Map<THREE.Material, THREE.Material>();
const convert = (src: THREE.Material) => {
  let m = lambert.get(src);
  if (!m) {
    const s = src as THREE.MeshStandardMaterial;
    m = new THREE.MeshLambertMaterial({ color: modelColor(src), map: s.map ?? null, transparent: s.transparent, opacity: s.opacity, side: s.side, emissive: s.emissive ?? 0x000000, emissiveIntensity: s.emissiveIntensity ?? 1, visible: s.visible });
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

/** A built-in piece with the cards' materials. */
function modern(kind: string, size: [number, number], height: number) {
  const p = buildModern(kind, size, height);
  if (!p) throw new Error(`no built-in piece ${kind}`);
  p.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = convert(o.material as THREE.Material);
  });
  return p;
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
    const simple = () => simplePiece({ type, size: def.size, height: def.height, mount: def.mount }, simpleMaterial, (g, m) => new THREE.Mesh(g, m));
    // as cards draw it in detail by default: its built-in piece at the type's size
    const kind = defaultKind(type, def.mount);
    add(type, shoot(kind ? modern(kind, def.size, def.height) : simple(), def.size));
    add(`builtin/${type}`, shoot(simple(), def.size));
  }
  for (const g of MODERN_GROUPS) for (const k of g.kinds) add(`modern/${k.id}`, shoot(modern(k.id, [k.size[0], k.size[1]], k.size[2]), [k.size[0], k.size[1]]));
  return { thumbs, plans };
}

(window as unknown as { thumbnails: Promise<unknown> }).thumbnails = render();
