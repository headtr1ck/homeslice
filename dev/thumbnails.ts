// Renders a small picture of every furniture type for the editor's library
// (scripts/thumbnails.mjs runs this in headless Chromium).
import * as THREE from "three";
import { FURNITURE, FURNITURE_TYPES } from "../frontend/model/furniture";
import { buildPiece, loadModel, modelColor, modelFiles } from "../frontend/render/models";

const SIZE = 160;

async function render(): Promise<Record<string, string>> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setClearColor(0x000000, 0);
  const out: Record<string, string> = {};
  for (const type of FURNITURE_TYPES) {
    const def = FURNITURE[type];
    const mount = def.mount ?? "floor";
    const files = modelFiles(type, mount);
    const models = new Map(await Promise.all(files.map(async (f) => [f, await loadModel(f)] as const)));
    const lambert = new Map<THREE.Material, THREE.Material>();
    const piece = buildPiece(type, mount, def.size, def.height, models, (src) => {
      let m = lambert.get(src);
      if (!m) {
        const s = src as THREE.MeshStandardMaterial;
        m = new THREE.MeshLambertMaterial({ color: modelColor(src), map: s.map ?? null });
        lambert.set(src, m);
      }
      return m;
    });
    if (!piece) continue;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(2, 4, 3);
    scene.add(sun, piece);
    // from the front right and above, like the house view
    const box = new THREE.Box3().setFromObject(piece);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const dir = new THREE.Vector3(0.55, 0.6, 1).normalize();
    camera.position.copy(centre).addScaledVector(dir, (radius / Math.sin((15 * Math.PI) / 180)) * 1.02);
    camera.lookAt(centre);
    renderer.render(scene, camera);
    out[type] = renderer.domElement.toDataURL("image/png");
  }
  return out;
}

(window as unknown as { thumbnails: Promise<Record<string, string>> }).thumbnails = render();
