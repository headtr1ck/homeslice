// Renders built-in pieces large, from four sides, for looking at their details while
// working on them (scripts/preview-models.mjs runs this in headless Chromium). The cards'
// own materials and light (MeshStandardMaterial under a sky and a sun), not the thumbnails'.
import * as THREE from "three";
import { buildModern } from "../frontend/render/modern";
import { MODERN } from "../frontend/model/modern";

const SIZE = 480;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x2a2d32, 1);
renderer.setSize(SIZE * 2, SIZE * 2);

/** Four views of a piece in one picture: front right above, front, side, top; and its triangles. */
function shoot(kind: string, finish?: string): { png: string; triangles: number } {
  const def = MODERN[kind];
  const piece = buildModern(kind, [def.size[0], def.size[1]], def.size[2], finish);
  if (!piece) throw new Error(`no built-in piece ${kind}`);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.3), piece);
  const box = new THREE.Box3().setFromObject(piece);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const views: [number, number, THREE.Vector3][] = [
    [0, 1, new THREE.Vector3(0.7, 0.45, 1)],
    [1, 1, new THREE.Vector3(0, 0.15, 1)],
    [0, 0, new THREE.Vector3(1, 0.15, 0)],
    [1, 0, new THREE.Vector3(0.001, 1, 0.001)],
  ];
  renderer.setScissorTest(true);
  for (const [cx, cy, dir] of views) {
    renderer.setViewport(cx * SIZE, cy * SIZE, SIZE, SIZE);
    renderer.setScissor(cx * SIZE, cy * SIZE, SIZE, SIZE);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    camera.position.copy(centre).addScaledVector(dir.clone().normalize(), (radius / Math.sin((15 * Math.PI) / 180)) * 1.02);
    if (dir.y > 0.9) camera.up.set(0, 0, -1);
    camera.lookAt(centre);
    renderer.render(scene, camera);
  }
  renderer.setScissorTest(false);
  let triangles = 0;
  piece.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return { png: renderer.domElement.toDataURL("image/png"), triangles };
}

const wanted = decodeURIComponent(location.hash.slice(1)).split(",").filter(Boolean);
const out: Record<string, { png: string; triangles: number }> = {};
for (const item of wanted) {
  const [kind, finish] = item.split(":");
  out[item] = shoot(kind, finish);
}
(window as unknown as { previews: typeof out }).previews = out;
