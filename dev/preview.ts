// Renders built-in pieces large, from four sides, for looking at their details while
// working on them (scripts/preview-models.mjs runs this in headless Chromium). The cards'
// own materials and light (MeshStandardMaterial under a sky and a sun), not the thumbnails'.
// A second picture shows the same views in a check shading that makes wrong normals stand out:
// magenta where the back of a one-sided face is seen (inside out / wrong winding: a hole in the
// card), yellow where a face is seen from the front but its normals point away (drawn dark),
// a blue tint on the back of deliberately double-sided sheets, plain grey where all is right.
import * as THREE from "three";
import { buildModern } from "../frontend/render/modern";
import { MODERN } from "../frontend/model/modern";

const SIZE = 480;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x2a2d32, 1);
renderer.setSize(SIZE * 2, SIZE * 2);

const CHECK_VERTEX = `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const CHECK_FRAGMENT = `
uniform float doubleSided;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vView);
  vec3 tint = vec3(1.0);
  if (!gl_FrontFacing) {
    if (doubleSided < 0.5) { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
    n = -n;
    tint = vec3(0.7, 0.8, 1.0);
  }
  if (dot(n, v) < -0.3) { gl_FragColor = vec4(1.0, 0.85, 0.0, 1.0); return; }
  gl_FragColor = vec4(tint * (0.15 + 0.55 * max(dot(n, v), 0.0)), 1.0);
}`;
// Front faces are drawn first, back faces in a second pass pushed slightly back, so a back face
// shows only where no front face covers it (not at a box's edges, where both have one depth).
const check = (doubleSided: boolean, side: THREE.Side) =>
  new THREE.ShaderMaterial({
    vertexShader: CHECK_VERTEX,
    fragmentShader: CHECK_FRAGMENT,
    side,
    polygonOffset: side === THREE.BackSide,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 4,
    uniforms: { doubleSided: { value: doubleSided ? 1 : 0 } },
  });

/** Triangles of one-sided meshes whose normals point against their winding (the face's front). */
function againstWinding(piece: THREE.Object3D): number {
  let count = 0;
  const [a, b, c, n, m] = [0, 0, 0, 0, 0].map(() => new THREE.Vector3());
  piece.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every((m: THREE.Material) => m.side === THREE.DoubleSide)) return;
    const g = o.geometry as THREE.BufferGeometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    if (!nor) return;
    const flip = o.matrixWorld.determinant() < 0 ? -1 : 1;
    const at = (i: number) => (g.index ? g.index.getX(i) : i);
    const tris = (g.index ? g.index.count : pos.count) / 3;
    for (let t = 0; t < tris; t++) {
      const [i, j, k] = [at(3 * t), at(3 * t + 1), at(3 * t + 2)];
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, j).sub(a);
      c.fromBufferAttribute(pos, k).sub(a);
      const face = b.cross(c);
      if (face.lengthSq() < 1e-14) continue;
      n.fromBufferAttribute(nor, i).add(m.fromBufferAttribute(nor, j)).add(m.fromBufferAttribute(nor, k));
      if (face.dot(n) * flip < 0) count++;
    }
  });
  return count;
}

/** Four views of a piece in one picture: front right above, front, side, top; the same in the
 *  check shading; and its triangles. */
function shoot(kind: string, finish?: string, options: Record<string, string> = {}): Shot {
  const def = MODERN[kind];
  const piece = buildModern(kind, [def.size[0], def.size[1]], def.size[2], finish, undefined, options);
  if (!piece) throw new Error(`no built-in piece ${kind}`);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.3), piece);
  const box = new THREE.Box3().setFromObject(piece);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  piece.updateMatrixWorld(true);
  const views: [number, number, THREE.Vector3][] = [
    [0, 1, new THREE.Vector3(0.7, 0.45, 1)],
    [1, 1, new THREE.Vector3(0, 0.15, 1)],
    [0, 0, new THREE.Vector3(1, 0.15, 0)],
    [1, 0, new THREE.Vector3(0.001, 1, 0.001)],
  ];
  const four = (passes: (() => void)[] = [() => {}]) => {
    renderer.setScissorTest(true);
    for (const [cx, cy, dir] of views) {
      renderer.setViewport(cx * SIZE, cy * SIZE, SIZE, SIZE);
      renderer.setScissor(cx * SIZE, cy * SIZE, SIZE, SIZE);
      // near and far hug the piece: depth precision decides which of a thin part's faces wins
      // at its edges, and a loose range shows the back ones there (false magenta in the check)
      const distance = (radius / Math.sin((15 * Math.PI) / 180)) * 1.02;
      const camera = new THREE.PerspectiveCamera(30, 1, Math.max(0.01, distance - radius * 1.1), distance + radius * 1.1);
      camera.position.copy(centre).addScaledVector(dir.clone().normalize(), distance);
      if (dir.y > 0.9) camera.up.set(0, 0, -1);
      camera.lookAt(centre);
      passes.forEach((pass, i) => {
        pass();
        renderer.autoClear = i === 0;
        renderer.render(scene, camera);
      });
      renderer.autoClear = true;
    }
    renderer.setScissorTest(false);
    return renderer.domElement.toDataURL("image/png");
  };
  const png = four();
  const against = againstWinding(piece);
  const meshes: [THREE.Mesh, boolean][] = [];
  piece.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      meshes.push([o, mats.some((m: THREE.Material) => m.side === THREE.DoubleSide)]);
    }
  });
  const pass = (side: THREE.Side) => {
    const one = check(false, side);
    const two = check(true, side);
    return () => meshes.forEach(([m, double]) => (m.material = double ? two : one));
  };
  const normals = four([pass(THREE.FrontSide), pass(THREE.BackSide)]);
  let triangles = 0;
  piece.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const g = o.geometry as THREE.BufferGeometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return { png, normals, triangles, against };
}

type Shot = { png: string; normals: string; triangles: number; against: number };

const wanted = decodeURIComponent(location.hash.slice(1)).split(",").filter(Boolean);
const out: Record<string, Shot> = {};
for (const item of wanted) {
  // piece[:finish][:option=value…]
  const [kind, finish, ...rest] = item.split(":");
  out[item] = shoot(kind, finish || undefined, Object.fromEntries(rest.map((o) => o.split("="))));
}
(window as unknown as { previews: typeof out }).previews = out;
