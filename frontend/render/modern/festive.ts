// Built-in pieces added later: festive. Each entry is a piece of frontend/model/modern.ts
// (same size, finishes and frame as the others: centred, front at +z, on y = 0).
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FINISHES } from "../../model/modern";
import { glowing, mat, random, wickerMat, type Build, type Builder } from "../modern";

type M = THREE.Material;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);

// ----- helpers -----

/** Smooth normals across a sphere's seam: its doubled vertices merged first. */
function smooth(geo: THREE.BufferGeometry) {
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  const g = mergeVertices(geo, 1e-6);
  g.computeVertexNormals();
  return g;
}

/** A matrix: placed at (x, y, z), turned by (rx, ry, rz), scaled by s. */
function at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: THREE.Vector3 | number = 1) {
  const sc = typeof s === "number" ? V(s, s, s) : s;
  return new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), sc);
}

/** A rod's geometry from a to c (closed ends), radius r1 at a and r2 at c. */
function rodGeo(a: THREE.Vector3, c: THREE.Vector3, r1: number, r2 = r1, seg = 6) {
  const len = a.distanceTo(c);
  const g = new THREE.CylinderGeometry(r2, r1, Math.max(len, 1e-4), seg);
  const q = new THREE.Quaternion().setFromUnitVectors(Y, c.clone().sub(a).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, V(1, 1, 1)));
}

/** A candle flame: a teardrop from its foot at the origin, r wide and len tall. */
function flameGeo(r: number, len: number) {
  const g = new THREE.SphereGeometry(1, 8, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (y <= 0) p.setXYZ(i, x * r, r + y * r, z * r);
    else {
      const rho = Math.hypot(x, z);
      const k = rho < 1e-6 ? 0 : (r * Math.pow(1 - y, 0.85)) / rho;
      p.setXYZ(i, x * k, r + y * (len - r), z * k);
    }
  }
  return smooth(g);
}
const flameMat = () => glowing(mat("#ffe3a3", { emissive: "#ffb443", emissiveIntensity: 1.1, roughness: 0.6 }));

/** An egg standing on its tip-up axis: r wide, 1.3 r tall half (centre at the origin). */
function eggGeo(r: number, seg = 10) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 - 0.14 * y;
    p.setXYZ(i, x * k * r, y * 1.28 * r, z * k * r);
  }
  return smooth(g);
}
const EGG_COLOURS = ["#e2574c", "#f2c14e", "#5aa6dd", "#7cbf5a", "#b47bd6", "#f08fb8", "#f39a3d"];
const eggMats = () => EGG_COLOURS.map((c) => mat(c, { roughness: 0.4 }));

/** A tube of glowing light (or anything) through points: batched. */
function tube(b: Builder, pts: THREE.Vector3[], closed: boolean, r: number, m: M, radial = 4, step = 0.025) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, "centripetal");
  const segs = Math.max(4, Math.ceil(curve.getLength() / step));
  b.batch(new THREE.TubeGeometry(curve, segs, r, radial, closed), m);
  if (!closed) for (const p of [pts[0], pts[pts.length - 1]]) b.batch(new THREE.OctahedronGeometry(r * 1.8, 0), m, at(p.x, p.y, p.z));
  return curve;
}

/** Flat facets: thin needles and blades seen edge-on keep normals that face the eye. */
function facets(geo: THREE.BufferGeometry) {
  const g = geo.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

/** A shape from a list of points. */
const poly = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));

// ----- Christmas -----

const adventWreath: Build = (b, w, d, h, _f, _c, _a, accentColor) => {
  const rand = random(2412);
  const R = Math.min(w, d) / 2;
  const needles = [mat("#2c5a32", { roughness: 0.9, side: THREE.DoubleSide }), mat("#3d6e3e", { roughness: 0.9, side: THREE.DoubleSide })];
  const core = mat("#24452a", { roughness: 0.95 });
  const wax = mat(FINISHES[accentColor] ?? FINISHES.red, { roughness: 0.55 });
  const gold = mat("#c9a24a", { metalness: 0.7, roughness: 0.3 });
  const berry = mat("#b3211c", { roughness: 0.35 });
  const coneM = mat("#6b4a2c", { roughness: 0.9 });
  const flame = flameMat();
  // the wreath: a flattened fir ring, sprigs all round its top
  const ring = R * 0.68;
  const rt = R * 0.27;
  const flat = 0.62;
  const cy = rt * flat;
  b.add(new THREE.TorusGeometry(ring, rt, 8, 40).rotateX(Math.PI / 2).scale(1, flat, 1), core, 0, cy, 0);
  const sprig = facets(new THREE.ConeGeometry(R * 0.035, R * 0.3, 3));
  const surf = (th: number, ph: number, out = 0) =>
    V((ring + (rt + out) * Math.cos(ph)) * Math.cos(th), cy + (rt + out) * Math.sin(ph) * flat, (ring + (rt + out) * Math.cos(ph)) * Math.sin(th));
  for (let i = 0; i < 210; i++) {
    const th = rand() * Math.PI * 2;
    const ph = -0.35 + rand() * (Math.PI + 0.7);
    const p = surf(th, ph, -rt * 0.15);
    const tangent = V(-Math.sin(th), 0, Math.cos(th));
    const normal = V(Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th));
    const dir = tangent.multiplyScalar(rand() < 0.5 ? -0.8 : 0.8).add(normal.multiplyScalar(0.7)).add(V(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.5)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
    const c = p.add(dir.clone().multiplyScalar(R * 0.12));
    b.batch(sprig.clone(), needles[i % 2], new THREE.Matrix4().compose(c, q, V(1, 0.7 + rand() * 0.6, 1)));
  }
  // decorations between the candles: a gold bauble, red berries and a pine cone
  const ball = new THREE.IcosahedronGeometry(R * 0.075, 1);
  const bead = new THREE.IcosahedronGeometry(R * 0.035, 0);
  for (let k = 0; k < 4; k++) {
    const th = (k * Math.PI) / 2;
    const p = surf(th, 0.55, R * 0.02);
    b.batch(ball.clone(), gold, at(p.x, p.y, p.z));
    for (let j = 0; j < 3; j++) {
      const q = surf(th + 0.22 + j * 0.07, 0.9 + (j % 2) * 0.35, R * 0.02);
      b.batch(bead.clone(), berry, at(q.x, q.y, q.z));
    }
    const q = surf(th - 0.25, 1.2, R * 0.02);
    b.batch(new THREE.ConeGeometry(R * 0.05, R * 0.16, 7, 2), coneM, at(q.x, q.y, q.z, Math.PI / 2, 0, th + 0.4));
  }
  // four candles on gold holders, a little burnt down one after the other
  const cr = Math.min(0.028, R * 0.14);
  const fl = cr * 1.7;
  const yb = cy + rt * flat * 0.75;
  const full = h - yb - fl - cr * 0.3;
  for (let k = 0; k < 4; k++) {
    const th = Math.PI / 4 + (k * Math.PI) / 2;
    const x = Math.cos(th) * ring;
    const z = Math.sin(th) * ring;
    const len = full * (1 - 0.09 * k);
    b.cyl(cr * 1.35, cr * 1.2, cr * 0.35, x, yb - cr * 0.25, z, gold, 16);
    b.cyl(cr, cr, len, x, yb, z, wax, 16);
    b.cyl(cr * 0.1, cr * 0.1, cr * 0.35, x, yb + len, z, mat("#2a2420"), 4);
    b.batch(flameGeo(cr * 0.42, fl), flame, at(x, yb + len + cr * 0.22, z));
  }
};

const christmasReindeer: Build = (b, w, d, h, _f, color) => {
  const tone = color === "yellow" ? ["#f3d27a", "#ffcf5a"] : ["#f7f3e6", "#fff0c8"];
  const light = glowing(mat(tone[0], { emissive: tone[1], emissiveIntensity: 0.65, roughness: 0.4, side: THREE.DoubleSide }));
  const bulbM = glowing(mat("#fffaf0", { emissive: tone[1], emissiveIntensity: 1.1, roughness: 0.3 }));
  // drawn in units of the box: x across w (nose at +x), y up h, z across d
  const U = (x: number, y: number, z = 0) => V(x * w, y * h, z * d);
  const r = Math.min(0.008, Math.max(0.004, w * 0.008));
  const curves: THREE.Curve<THREE.Vector3>[] = [];
  type T3 = [number, number, number];
  const line = (pts: T3[], closed = false) => curves.push(tube(b, pts.map(([x, y, z]) => U(x, y, z)), closed, r, light, 4, 0.045));
  const flatAt = (pts: [number, number][], z: number): T3[] => pts.map(([x, y]) => [x, y, z]);
  // the body: an outline each side and hoops round it
  for (const z of [-0.3, 0.3])
    line(flatAt([[-0.3, 0.625], [-0.1, 0.645], [0.12, 0.66], [0.21, 0.6], [0.19, 0.5], [0.0, 0.445], [-0.2, 0.455], [-0.33, 0.5], [-0.35, 0.57]], z), true);
  for (const [x, y0, y1, rz] of [[-0.24, 0.455, 0.63, 0.3], [-0.02, 0.445, 0.65, 0.3], [0.15, 0.49, 0.655, 0.28]]) {
    const pts: T3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      pts.push([x, (y0 + y1) / 2 + ((y1 - y0) / 2) * Math.sin(a), rz * Math.cos(a)]);
    }
    line(pts, true);
  }
  // legs: each an outline from the body down to the hoof and back
  const front = (x: number, z: number) =>
    flatAt([[x + 0.045, 0.49], [x + 0.035, 0.32], [x + 0.03, 0.2], [x + 0.032, 0.05], [x + 0.045, 0.012], [x - 0.012, 0.012], [x - 0.008, 0.05], [x - 0.012, 0.2], [x - 0.025, 0.32], [x - 0.04, 0.46]], z);
  const back = (x: number, z: number) =>
    flatAt([[x + 0.07, 0.455], [x + 0.05, 0.33], [x + 0.005, 0.2], [x + 0.012, 0.05], [x + 0.028, 0.012], [x - 0.03, 0.012], [x - 0.025, 0.05], [x - 0.04, 0.2], [x - 0.065, 0.28], [x - 0.085, 0.42], [x - 0.07, 0.5]], z);
  line(front(0.15, 0.24));
  line(front(0.1, -0.24));
  line(back(-0.22, 0.24));
  line(back(-0.25, -0.24));
  // neck, head (with a hoop round the muzzle), ears, tail
  line(flatAt([[0.17, 0.5], [0.23, 0.58], [0.28, 0.67], [0.33, 0.74], [0.36, 0.76]], 0));
  line(flatAt([[0.1, 0.66], [0.17, 0.73], [0.22, 0.79], [0.27, 0.83]], 0));
  for (const z of [-0.07, 0.07]) line(flatAt([[0.27, 0.83], [0.33, 0.845], [0.4, 0.815], [0.46, 0.785], [0.48, 0.765], [0.465, 0.745], [0.42, 0.74], [0.35, 0.745], [0.31, 0.765]], z), true);
  {
    const pts: T3[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push([0.41, 0.778 + 0.036 * Math.sin(a), 0.08 * Math.cos(a)]);
    }
    line(pts, true);
  }
  for (const z of [-0.12, 0.12]) line([[0.285, 0.835, z * 0.6], [0.24, 0.87, z], [0.205, 0.88, z * 1.2], [0.245, 0.845, z * 0.8]]);
  line(flatAt([[-0.34, 0.6], [-0.39, 0.635], [-0.405, 0.6], [-0.36, 0.585]], 0));
  // antlers: a curved beam each side with tines
  for (const s of [-1, 1]) {
    line([[0.3, 0.845, s * 0.06], [0.28, 0.9, s * 0.12], [0.23, 0.945, s * 0.2], [0.16, 0.975, s * 0.28], [0.09, 0.985, s * 0.34]]);
    line([[0.285, 0.885, s * 0.1], [0.32, 0.915, s * 0.1], [0.355, 0.94, s * 0.08]]);
    line([[0.24, 0.94, s * 0.19], [0.26, 0.965, s * 0.2], [0.275, 0.985, s * 0.2]]);
    line([[0.175, 0.97, s * 0.27], [0.19, 0.985, s * 0.3]]);
    line([[0.13, 0.98, s * 0.31], [0.12, 0.99, s * 0.36]]);
  }
  // little bulbs along every tube
  const bead = new THREE.OctahedronGeometry(r * 1.7, 0);
  for (const c of curves) {
    const n = Math.max(1, Math.round(c.getLength() / 0.1));
    for (let i = 0; i < n; i++) {
      const p = c.getPointAt((i + 0.5) / n);
      b.batch(bead.clone(), bulbM, at(p.x, p.y, p.z));
    }
  }
};

const christmasStarWindow: Build = (b, w, d, h, _f, color) => {
  const paper = FINISHES[color] ?? FINISHES.white;
  const glowC = color === "red" ? "#ff5a40" : color === "yellow" ? "#ffd060" : "#fff1d0";
  const m = glowing(mat(paper, { emissive: glowC, emissiveIntensity: 0.5, roughness: 0.85, side: THREE.DoubleSide }));
  const cordM = mat("#c9a24a", { metalness: 0.5, roughness: 0.4 });
  const cord = Math.min(0.08, h * 0.16);
  const R = Math.min(w / 2, (h - cord) / 2) * 0.98;
  const yc = h - cord - R;
  const z0 = -d / 2 + 0.002;
  const relief = Math.min(d - 0.006, R * 0.25);
  // a folded paper star: eight long and eight short points, each folded along its middle
  const outline: [number, number, number][] = [];
  for (let k = 0; k < 16; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 8;
    const rr = k % 2 ? R * 0.62 : R;
    outline.push([Math.cos(a) * rr, Math.sin(a) * rr, 0]);
    const v = a + Math.PI / 16;
    outline.push([Math.cos(v) * R * 0.3, Math.sin(v) * R * 0.3, relief * 0.12]);
  }
  const pos: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    pos.push(0, yc, z0 + relief, p[0], yc + p[1], z0 + p[2], q[0], yc + q[1], z0 + q[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add(g, m);
  // the cord from its top point up to a little hook
  b.rod(V(0, yc + R * 0.98, z0 + 0.002), V(0, h - 0.008, z0 + 0.002), 0.0016, cordM, 5);
  b.sphere(0.006, 0, h - 0.006, z0 + 0.004, cordM, 1, 1, 1, 8);
  b.add(new THREE.TorusGeometry(0.008, 0.0015, 4, 10), cordM, 0, yc + R + 0.006, z0 + 0.002);
};

const candleArch: Build = (b, w, d, h, f) => {
  const gold = mat("#c9a24a", { metalness: 0.6, roughness: 0.35 });
  const wax = mat("#f5f1e6", { roughness: 0.5 });
  const flame = flameMat();
  // proportions: plinth, arch, cups, candles and their flame bulbs fill the height
  const bh = Math.min(0.03, h * 0.07);
  const cup = h * 0.02;
  const cl = h * 0.17;
  const fl = Math.min(0.025, h * 0.07);
  const ry = h - bh - cup - cl - fl;
  const cr = Math.min(0.007, w * 0.016);
  const rx = w / 2 - cr * 2;
  const bt = Math.min(rx, ry) * 0.12;
  const t = Math.min(0.014, d * 0.18);
  b.box(w, bh * 0.6, d, 0, 0, 0, f, 0.003);
  b.box(w - 0.012, bh * 0.4, d * 0.75, 0, bh * 0.6, 0, f, 0.002);
  // the arch: a band with round fretwork holes between the candles
  const band = new THREE.Shape();
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI;
    if (i === 0) band.moveTo(rx * Math.cos(a), ry * Math.sin(a));
    else band.lineTo(rx * Math.cos(a), ry * Math.sin(a));
  }
  for (let i = N; i >= 0; i--) {
    const a = (i / N) * Math.PI;
    band.lineTo((rx - bt) * Math.cos(a), (ry - bt) * Math.sin(a));
  }
  for (let j = 0; j < 8; j++) {
    const a = (Math.PI * (j + 0.5)) / 8;
    const hole = new THREE.Path();
    hole.absarc((rx - bt / 2) * Math.cos(a), (ry - bt / 2) * Math.sin(a), bt * 0.24, 0, Math.PI * 2, true);
    band.holes.push(hole);
  }
  // the scene inside: ground, a church, a house, firs and two miners with lanterns
  const S = rx - bt;
  const T = ry - bt;
  const g = T * 0.07;
  const rect = (x0: number, x1: number, y0: number, y1: number) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  const win = (s: THREE.Shape, x0: number, x1: number, y0: number, y1: number) => {
    const p = new THREE.Path();
    p.moveTo(x0, y0);
    p.lineTo(x0, y1);
    p.lineTo(x1, y1);
    p.lineTo(x1, y0);
    p.closePath();
    s.holes.push(p);
  };
  const scene: THREE.Shape[] = [band, rect(-S - bt * 0.5, S + bt * 0.5, 0, g)];
  const church = poly([[-0.22 * S, g * 0.9], [0.12 * S, g * 0.9], [0.12 * S, 0.32 * T], [-0.05 * S, 0.5 * T], [-0.22 * S, 0.32 * T]]);
  win(church, -0.15 * S, -0.09 * S, 0.12 * T, 0.24 * T);
  win(church, -0.03 * S, 0.03 * S, 0.12 * T, 0.24 * T);
  const tower = poly([[0.1 * S, g * 0.9], [0.25 * S, g * 0.9], [0.25 * S, 0.56 * T], [0.175 * S, 0.8 * T], [0.1 * S, 0.56 * T]]);
  win(tower, 0.15 * S, 0.2 * S, 0.38 * T, 0.48 * T);
  const house = poly([[-0.64 * S, g * 0.9], [-0.38 * S, g * 0.9], [-0.38 * S, 0.22 * T], [-0.51 * S, 0.36 * T], [-0.64 * S, 0.22 * T]]);
  win(house, -0.56 * S, -0.46 * S, 0.1 * T, 0.17 * T);
  const fir = (x: number, s: number) =>
    poly([[x - 0.015 * S * s, g * 0.9], [x + 0.015 * S * s, g * 0.9], [x + 0.015 * S * s, g + 0.04 * T * s], [x + 0.11 * S * s, g + 0.04 * T * s], [x + 0.04 * S * s, g + 0.2 * T * s], [x + 0.08 * S * s, g + 0.2 * T * s], [x, g + 0.42 * T * s], [x - 0.08 * S * s, g + 0.2 * T * s], [x - 0.04 * S * s, g + 0.2 * T * s], [x - 0.11 * S * s, g + 0.04 * T * s], [x - 0.015 * S * s, g + 0.04 * T * s]]);
  scene.push(church, tower, house, fir(0.48 * S, 1.1), fir(0.68 * S, 0.8), fir(-0.8 * S, 0.75), fir(-0.3 * S, 0.6));
  const miner = (x: number, dir: number) => {
    const u = T * 0.05;
    scene.push(poly([[x - 1.1 * u, g * 0.9], [x + 1.1 * u, g * 0.9], [x + 0.8 * u, 3.4 * u + g], [x - 0.8 * u, 3.4 * u + g]]));
    const head = new THREE.Shape();
    head.absarc(x, g + 4.1 * u, 0.75 * u, 0, Math.PI * 2, false);
    scene.push(head, poly([[x - 0.5 * u, g + 4.5 * u], [x + 0.5 * u, g + 4.5 * u], [x + 0.2 * u, g + 5.6 * u], [x - 0.2 * u, g + 5.6 * u]]));
    // the arm held out with a lantern
    scene.push(poly([[x + dir * 0.5 * u, g + 2.6 * u], [x + dir * 2.2 * u, g + 2.2 * u], [x + dir * 2.2 * u, g + 1.7 * u], [x + dir * 0.5 * u, g + 2.0 * u]]));
    scene.push(rect(x + dir * 2.2 * u - 0.45 * u, x + dir * 2.2 * u + 0.45 * u, g + 0.9 * u, g + 1.8 * u));
  };
  miner(-0.54 * S, 1);
  miner(0.33 * S, -1);
  const geo = new THREE.ExtrudeGeometry(scene, { depth: t, bevelEnabled: false, curveSegments: 8 }).translate(0, 0, -t / 2);
  b.add(geo, f, 0, bh, 0);
  // seven candles on cups along the arch
  for (let j = 1; j <= 7; j++) {
    const a = (Math.PI * j) / 8;
    const x = rx * Math.cos(a);
    const y = bh + ry * Math.sin(a) - cup * 0.3;
    b.cyl(cr * 1.5, cr * 1.1, cup * 1.3, x, y, 0, gold, 12);
    b.cyl(cr, cr, cl, x, y + cup * 1.3, 0, wax, 12);
    b.batch(flameGeo(cr * 0.75, fl), flame, at(x, y + cup * 1.3 + cl, 0));
  }
};

const nutcracker: Build = (b, w, d, h, f) => {
  const r = Math.min(w, d) / 2;
  const H = (k: number) => k * h;
  const black = mat("#1d1e21", { roughness: 0.45 });
  const white = mat("#f2efe8", { roughness: 0.6 });
  const gold = mat("#cfa64a", { metalness: 0.65, roughness: 0.3 });
  const skin = mat("#f0c8a4", { roughness: 0.55 });
  const cheek = mat("#e0807a", { roughness: 0.6 });
  const baseM = mat("#2c4632", { roughness: 0.5 });
  const ze = 0.85; // the body is a little flatter front to back
  // the base
  b.box(w * 0.94, H(0.04), d * 0.9, 0, 0, 0, baseM, 0.006);
  b.box(w * 0.8, H(0.015), d * 0.75, 0, H(0.04), 0, gold, 0);
  const y0 = H(0.055);
  // boots with toes, white trousers
  for (const s of [-1, 1]) {
    const x = s * r * 0.3;
    b.cyl(r * 0.25, r * 0.27, H(0.15), x, y0, 0, black, 12);
    b.sphere(r * 0.2, x, y0 + r * 0.06, r * 0.22, black, 1, 0.6, 1.4, 12);
    b.cyl(r * 0.29, r * 0.29, H(0.02), x, y0 + H(0.14), 0, black, 12);
    b.cyl(r * 0.23, r * 0.26, H(0.15), x, y0 + H(0.15), 0, white, 12);
  }
  // the jacket: a flared skirt, the body, shoulders
  const yj = H(0.33);
  b.cyl(r * 0.6, r * 0.7, H(0.08), 0, yj, 0, f, 12).scale.z = ze;
  b.cyl(r * 0.56, r * 0.6, H(0.22), 0, yj + H(0.08), 0, f, 12).scale.z = ze;
  b.sphere(r * 0.56, 0, H(0.61), 0, f, 1, 0.35, ze, 12);
  // belt and buckle
  b.cyl(r * 0.63, r * 0.63, H(0.035), 0, yj + H(0.075), 0, black, 12).scale.z = ze;
  b.box(r * 0.22, H(0.03), r * 0.06, 0, yj + H(0.077), r * 0.63 * ze, gold, 0.002);
  // gold braid across the chest and buttons
  const front = (rr: number) => rr * ze + r * 0.01;
  for (let i = 0; i < 4; i++) {
    const y = yj + H(0.135) + i * H(0.03);
    b.box(r * 0.5, H(0.008), r * 0.03, 0, y, front(r * 0.57) - r * 0.01, gold, 0);
    b.sphere(r * 0.04, 0, y + H(0.004), front(r * 0.57) + r * 0.01, gold, 1, 1, 1, 8);
  }
  b.box(r * 0.06, H(0.2), r * 0.02, 0, yj + H(0.11), front(r * 0.58) - r * 0.005, white, 0);
  // arms with white cuffs and gold epaulettes; the right hand holds a sceptre
  for (const s of [-1, 1]) {
    const x = s * r * 0.7;
    b.sphere(r * 0.2, x, H(0.6), 0, f, 1, 1, 1, 12);
    b.rod(V(x, H(0.6), 0), V(s * r * 0.78, H(0.43), r * 0.08), r * 0.16, f, 12);
    b.cyl(r * 0.2, r * 0.2, H(0.03), s * r * 0.78, H(0.415), r * 0.08, white, 12);
    b.sphere(r * 0.15, s * r * 0.78, H(0.395), r * 0.1, skin, 1, 1.1, 1, 12);
    b.cyl(r * 0.24, r * 0.22, H(0.02), x * 0.95, H(0.615), 0, gold, 12);
  }
  b.rod(V(r * 0.78, H(0.3), r * 0.16), V(r * 0.78, H(0.58), r * 0.16), r * 0.04, gold, 8);
  b.sphere(r * 0.08, r * 0.78, H(0.59), r * 0.16, gold, 1, 1, 1, 10);
  // the lever at the back
  b.box(r * 0.12, H(0.2), r * 0.08, 0, H(0.38), -r * 0.6 * ze - r * 0.03, mat("#8a5a34", { roughness: 0.6 }), 0);
  // collar and head
  b.cyl(r * 0.32, r * 0.36, H(0.03), 0, H(0.625), 0, white, 16);
  const yh = H(0.705);
  const hr = r * 0.4;
  b.sphere(hr, 0, yh, 0, skin, 1, H(0.085) / hr, 1, 14);
  // white hair at the back and sides, beard and moustache in front
  b.sphere(hr * 1.05, 0, yh + H(0.01), -hr * 0.18, white, 1, 1.15, 0.9, 12);
  b.sphere(hr * 0.85, 0, yh - H(0.055), hr * 0.42, white, 1.05, 1.05, 0.62, 12);
  for (const s of [-1, 1]) b.sphere(hr * 0.32, s * hr * 0.28, yh - H(0.008), hr * 0.86, white, 1.1, 0.45, 0.6, 10);
  b.box(hr * 0.5, H(0.012), hr * 0.15, 0, yh - H(0.03), hr * 0.86, black, 0);
  b.sphere(hr * 0.17, 0, yh + H(0.008), hr * 0.98, skin, 1, 1.1, 1, 10);
  for (const s of [-1, 1]) {
    b.sphere(hr * 0.15, s * hr * 0.38, yh + H(0.03), hr * 0.86, white, 1, 1, 0.5, 10);
    b.sphere(hr * 0.08, s * hr * 0.38, yh + H(0.03), hr * 0.93, black, 1, 1, 0.6, 8);
    b.box(hr * 0.3, H(0.008), hr * 0.08, s * hr * 0.38, yh + H(0.055), hr * 0.86, black, 0);
    b.sphere(hr * 0.14, s * hr * 0.55, yh + H(0.005), hr * 0.78, cheek, 1, 0.8, 0.4, 10);
  }
  // the tall hat: a band, a gold star in front and a plume
  const yt = H(0.77);
  b.cyl(hr * 1.08, hr * 1.02, H(0.17), 0, yt, 0, black, 12);
  b.cyl(hr * 1.06, hr * 1.06, H(0.025), 0, yt, 0, gold, 12);
  b.cyl(hr * 1.1, hr * 1.1, H(0.012), 0, yt + H(0.158), 0, gold, 12);
  const star: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? hr * 0.12 : hr * 0.28;
    star.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  b.add(new THREE.ExtrudeGeometry(poly(star), { depth: r * 0.02, bevelEnabled: false }), gold, 0, yt + H(0.09), hr * 1.04);
  b.sphere(hr * 0.22, 0, H(0.95), 0, gold, 1, 0.6, 1, 10);
  b.add(new THREE.ConeGeometry(hr * 0.2, H(0.045), 10), white, 0, H(0.95) + H(0.0225), 0);
};

const christmasPresents: Build = (b, w, d, h, _f, color, _a, accentColor) => {
  const base = new THREE.Color(FINISHES[color] ?? FINISHES.red);
  const paper = [
    mat(`#${base.getHexString()}`, { roughness: 0.55 }),
    mat(`#${base.clone().multiplyScalar(0.92).getHexString()}`, { roughness: 0.55 }),
    mat(`#${base.clone().multiplyScalar(0.8).getHexString()}`, { roughness: 0.55 }),
  ];
  const metal = accentColor === "silver" || accentColor === "yellow";
  const ribbon = mat(accentColor === "yellow" ? "#e0b840" : (FINISHES[accentColor] ?? FINISHES.yellow), { roughness: metal ? 0.32 : 0.45, metalness: metal ? 0.35 : 0.05 });
  // [width, depth, height, x, z, bottom y, turn, paper]
  const list: [number, number, number, number, number, number, number, number][] = [
    [0.44, 0.56, 0.48, -0.24, -0.16, 0, 0.12, 0],
    [0.34, 0.44, 0.34, 0.25, 0.16, 0, -0.28, 1],
    [0.3, 0.36, 0.27, -0.22, -0.14, 0.48, 0.42, 2],
    [0.22, 0.26, 0.42, 0.33, -0.27, 0, 0.1, 2],
    [0.24, 0.26, 0.16, -0.27, 0.32, 0, -0.18, 1],
  ];
  const loop = new THREE.TorusGeometry(1, 0.36, 6, 14);
  for (const [bw0, bd0, bh0, x0, z0, y0, rot, pi] of list) {
    const bw = bw0 * w;
    const bd = bd0 * d;
    const yb = y0 * h;
    const s = Math.min(bw, bd, bh0 * h);
    const bowH = Math.min(s * 0.5, h * 0.15);
    const boxH = y0 > 0 ? Math.min(bh0 * h, h - yb - bowH) : bh0 * h;
    const place = new THREE.Matrix4().compose(V(x0 * w, yb, z0 * d), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), V(1, 1, 1));
    const put = (geo: THREE.BufferGeometry, m: M, local: THREE.Matrix4) => b.batch(geo, m, place.clone().multiply(local));
    put(new THREE.BoxGeometry(bw, boxH, bd), paper[pi], at(0, boxH / 2, 0));
    // the lid's edge
    const lid = Math.min(0.025, boxH * 0.14);
    put(new THREE.BoxGeometry(bw + 0.004, lid, bd + 0.004), paper[pi], at(0, boxH - lid / 2, 0));
    // ribbons round it both ways
    const rw = s * 0.14;
    const e = 0.003;
    put(new THREE.BoxGeometry(bw + 2 * e + 0.004, boxH + e, rw), ribbon, at(0, (boxH + e) / 2, 0));
    put(new THREE.BoxGeometry(rw, boxH + e, bd + 2 * e + 0.004), ribbon, at(0, (boxH + e) / 2, 0));
    // the bow: two loops, a knot and two tails
    const lr = bowH * 0.5;
    const top = boxH + e;
    for (const sx of [-1, 1]) {
      put(loop.clone(), ribbon, at(sx * lr * 0.85, top + lr * 0.75, 0, 0, 0, sx * 0.55, V(lr, lr * 0.7, lr * 0.9)));
      put(new THREE.BoxGeometry(rw * 0.9, 0.003, lr * 1.6), ribbon, at(sx * lr * 0.5, top + 0.003, lr * 0.55, 0, sx * 0.5, 0));
    }
    put(new THREE.SphereGeometry(lr * 0.32, 10, 6), ribbon, at(0, top + lr * 0.25, 0, 0, 0, 0, V(1, 0.8, 1)));
  }
};

// ----- Easter -----

const easterBunny: Build = (b, w, d, h, f) => {
  const tail = mat("#f6f3ec", { roughness: 0.95 });
  const pink = mat("#e6a3a2", { roughness: 0.7 });
  const eye = mat("#1c1b1b", { roughness: 0.15 });
  const bowM = mat("#7db3d9", { roughness: 0.5 });
  const ell = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, m: M, seg = 12) => b.sphere(1, cx, cy, cz, m, rx, ry, rz, seg);
  // a pear-shaped sitting body
  const body = new THREE.SphereGeometry(1, 20, 14);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 - 0.2 * Math.max(0, y) + 0.06 * Math.max(0, -y);
    p.setXYZ(i, p.getX(i) * k * w * 0.32, y * h * 0.255, p.getZ(i) * k * d * 0.36);
  }
  b.add(smooth(body), f, 0, h * 0.255, -d * 0.04);
  // haunches, big hind feet, front legs and paws
  for (const s of [-1, 1]) {
    ell(s * w * 0.24, h * 0.15, -d * 0.08, w * 0.17, h * 0.145, d * 0.3, f);
    ell(s * w * 0.25, h * 0.035, d * 0.18, w * 0.1, h * 0.035, d * 0.27, f, 14);
    ell(s * w * 0.09, h * 0.17, d * 0.17, w * 0.075, h * 0.12, d * 0.1, f, 14);
    ell(s * w * 0.09, h * 0.055, d * 0.26, w * 0.075, h * 0.055, d * 0.1, f, 14);
  }
  // the head with a muzzle, nose and eyes
  const hc = V(0, h * 0.6, d * 0.06);
  const hr = V(w * 0.25, h * 0.14, d * 0.3);
  const on = (ax: number, ay: number, k = 1) => V(hc.x + hr.x * k * Math.sin(ax) * Math.cos(ay), hc.y + hr.y * k * Math.sin(ay), hc.z + hr.z * k * Math.cos(ax) * Math.cos(ay));
  ell(hc.x, hc.y, hc.z, hr.x, hr.y, hr.z, f, 18);
  for (const s of [-1, 1]) {
    const m = on(s * 0.32, -0.38, 0.9);
    ell(m.x, m.y, m.z, w * 0.07, h * 0.045, d * 0.08, f, 12);
    const e = on(s * 0.62, 0.18);
    ell(e.x, e.y, e.z, w * 0.03, h * 0.032, d * 0.02, eye, 10);
  }
  const n = on(0, -0.12, 1.0);
  ell(n.x, n.y, n.z, w * 0.03, h * 0.02, d * 0.025, pink, 10);
  // long ears, a little apart and leaning out, pink inside
  for (const s of [-1, 1]) {
    const ear = new THREE.SphereGeometry(1, 14, 10).scale(w * 0.075, h * 0.17, d * 0.065);
    const inner = new THREE.SphereGeometry(1, 12, 8).scale(w * 0.045, h * 0.13, d * 0.03).translate(0, -h * 0.01, d * 0.045);
    const pose = (g: THREE.BufferGeometry) => g.rotateX(-0.12).rotateZ(-s * 0.16).translate(s * w * 0.08, h * 0.825, -d * 0.02);
    b.add(pose(ear), f);
    b.add(pose(inner), pink);
  }
  // a cotton tail and a ribbon with a bow round the neck
  ell(0, h * 0.13, -d * 0.4, w * 0.1, w * 0.1, w * 0.09, tail, 12);
  b.add(new THREE.TorusGeometry(1, 0.08, 6, 24).rotateX(Math.PI / 2).scale(w * 0.2, w * 0.2, d * 0.24), bowM, 0, h * 0.475, 0);
  for (const s of [-1, 1]) ell(s * w * 0.06, h * 0.475, d * 0.25, w * 0.06, h * 0.03, d * 0.03, bowM, 10).rotation.z = s * 0.3;
};

const easterTree: Build = (b, w, d, h, f) => {
  const rand = random(404);
  const R = Math.min(w, d) / 2;
  const bark = mat("#5a4030", { roughness: 0.9, side: THREE.DoubleSide });
  const catkin = mat("#d9d5cd", { roughness: 1 });
  const thread = mat("#efe9dc", { roughness: 1, side: THREE.DoubleSide });
  const bandM = mat("#fbf8f2", { roughness: 0.5 });
  const eggs = eggMats();
  // the vase: a bellied jug with a narrow neck
  const vh = Math.min(0.32 * h, R * 1.4);
  const vr = Math.min(R * 0.45, 0.13);
  const prof: [number, number][] = [[0.001, 0], [vr * 0.62, 0], [vr * 0.62, 0], [vr * 0.66, vh * 0.03], [vr * 0.8, vh * 0.12], [vr * 0.92, vh * 0.25], [vr, vh * 0.45], [vr * 0.95, vh * 0.58], [vr * 0.85, vh * 0.7], [vr * 0.66, vh * 0.82], [vr * 0.5, vh * 0.9], [vr * 0.55, vh * 0.97], [vr * 0.6, vh], [vr * 0.6, vh], [vr * 0.5, vh], [vr * 0.5, vh], [vr * 0.45, vh * 0.92], [vr * 0.45, vh * 0.92], [0.001, vh * 0.92]];
  b.add(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 20), f);
  // branches fanning out of the neck, with side twigs and catkins
  const base = vh * 0.94;
  const hangs: THREE.Vector3[] = [];
  const twig = (a: THREE.Vector3, c: THREE.Vector3, r1: number, r2: number) => b.batch(rodGeo(a, c, r1, r2, 5), bark);
  const bud = new THREE.OctahedronGeometry(Math.min(0.008, R * 0.03), 0);
  const branches = 11;
  for (let i = 0; i < branches; i++) {
    const ang = (i / branches) * Math.PI * 2 + rand() * 0.4;
    const out = 0.35 + rand() * 0.6;
    const tip = V(Math.cos(ang) * R * out * 0.95, h * (0.7 + rand() * 0.28) - 0.01, Math.sin(ang) * R * out * 0.95);
    const start = V(Math.cos(ang) * vr * 0.2, base, Math.sin(ang) * vr * 0.2);
    const mid = start.clone().lerp(tip, 0.45);
    mid.x *= 0.7;
    mid.z *= 0.7;
    const r0 = Math.min(0.009, R * 0.035);
    twig(start, mid, r0, r0 * 0.7);
    twig(mid, tip, r0 * 0.7, r0 * 0.25);
    for (const t of [0.35, 0.75]) hangs.push(mid.clone().lerp(tip, t));
    for (let k = 0; k < 2; k++) {
      const from = mid.clone().lerp(tip, 0.2 + k * 0.4);
      const a2 = ang + (k ? 0.5 : -0.5);
      const reach = Math.min(R * 0.3, 0.12);
      let to = from.clone().add(V(Math.cos(a2) * reach, reach * (0.6 + rand() * 0.6), Math.sin(a2) * reach));
      const lim = R * 0.95;
      const rr = Math.hypot(to.x, to.z);
      if (rr > lim) to = V((to.x * lim) / rr, to.y, (to.z * lim) / rr);
      to.y = Math.min(to.y, h - 0.01);
      twig(from, to, r0 * 0.4, r0 * 0.18);
      hangs.push(from.clone().lerp(to, 0.7));
      for (let j = 0; j < 3; j++) {
        const q = from.clone().lerp(to, 0.3 + j * 0.25);
        b.batch(bud.clone(), catkin, at(q.x, q.y, q.z, rand() * 3, rand() * 3, 0, V(1, 1.6, 1)));
      }
    }
    for (let j = 0; j < 3; j++) {
      const q = mid.clone().lerp(tip, 0.15 + j * 0.3);
      b.batch(bud.clone(), catkin, at(q.x + 0.004, q.y, q.z, rand() * 3, rand() * 3, 0, V(1, 1.6, 1)));
    }
  }
  // coloured eggs hanging on threads, some with a white band
  const er = Math.min(0.022, R * 0.08);
  const egg = eggGeo(er, 8);
  const band = new THREE.TorusGeometry(er * 0.97, er * 0.12, 4, 10).rotateX(Math.PI / 2);
  hangs.forEach((p, i) => {
    if (i % 4 === 2 || i % 4 === 3) return;
    const len = er * (1 + (i % 4) * 0.6);
    const top = p.clone().add(V(0, -len, 0));
    const cy = top.y - er * 1.28;
    if (cy - er * 1.3 < base) return;
    b.batch(rodGeo(p, top, 0.0012, 0.0012, 4), thread);
    b.batch(egg.clone(), eggs[i % eggs.length], at(top.x, cy, top.z));
    if (i % 8 === 1) b.batch(band.clone(), bandM, at(top.x, cy, top.z));
  });
};

const easterBasket: Build = (b, w, d, h, _f, color) => {
  const rand = random(331);
  const wick = wickerMat(color);
  const grassM = [mat("#5f9d3c", { roughness: 0.9, side: THREE.DoubleSide }), mat("#82b84a", { roughness: 0.9, side: THREE.DoubleSide })];
  const eggs = eggMats();
  const tr = Math.min(0.009, Math.min(w, d) * 0.025);
  const rx = w / 2 - tr * 1.5;
  const rz = d / 2 - tr * 1.5;
  const wh = h * 0.5;
  // the woven wall: stakes and rows going in and out
  const wall = new THREE.CylinderGeometry(1, 1, 1, 48, 8, true);
  const p = wall.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const t = p.getY(i) + 0.5;
    const a = Math.atan2(z, x);
    const k = (0.82 + 0.18 * Math.sqrt(t)) * (1 + 0.025 * Math.sin(16 * a) * Math.sin(Math.PI * t * 4));
    p.setXYZ(i, Math.cos(a) * rx * k, t * wh, Math.sin(a) * rz * k);
  }
  wall.computeVertexNormals();
  b.add(wall, wick);
  b.add(new THREE.CircleGeometry(1, 32).rotateX(Math.PI / 2).scale(rx * 0.82, 1, rz * 0.82), wick, 0, 0.002, 0);
  // braided rims at the top and the foot
  const ellipse = (sx: number, sz: number, y: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push(V(Math.cos(a) * sx, y, Math.sin(a) * sz));
    }
    return pts;
  };
  tube(b, ellipse(rx, rz, wh), true, tr, wick, 5, 0.018);
  tube(b, ellipse(rx * 0.83, rz * 0.83, tr * 0.8), true, tr * 0.8, wick, 5, 0.025);
  // the handle over the top, wrapped
  const arc: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    arc.push(V(-Math.cos(a) * rx * 0.98, wh + (h - wh - tr) * Math.sin(a), 0));
  }
  const handle = tube(b, arc, false, tr * 0.9, wick, 5, 0.015);
  const wrap: THREE.Vector3[] = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const c = handle.getPointAt(t);
    const tg = handle.getTangentAt(t);
    const nrm = V(0, 0, 1);
    const bi = tg.clone().cross(nrm).normalize();
    const a = t * Math.PI * 2 * 14;
    wrap.push(c.add(nrm.multiplyScalar(Math.cos(a) * tr)).add(bi.multiplyScalar(Math.sin(a) * tr)));
  }
  tube(b, wrap, false, tr * 0.35, wick, 4, 0.012);
  // a mound of grass with blades sticking up
  const gy = wh * 0.82;
  b.add(new THREE.SphereGeometry(1, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(rx * 0.97, h * 0.12, rz * 0.97), grassM[0], 0, gy, 0);
  const blade = facets(new THREE.ConeGeometry(Math.min(0.004, w * 0.012), h * 0.16, 3));
  for (let i = 0; i < 120; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * 0.95;
    const x = Math.cos(a) * rx * rr;
    const z = Math.sin(a) * rz * rr;
    const y = gy + h * 0.12 * Math.sqrt(Math.max(0, 1 - rr * rr)) * 0.8;
    b.batch(blade.clone(), grassM[i % 2], at(x, y + h * 0.05, z, (rand() - 0.5) * 0.8 + rr * 0.4 * Math.sin(a), 0, (rand() - 0.5) * 0.8 - rr * 0.4 * Math.cos(a), V(1, 0.6 + rand() * 0.6, 1)));
  }
  // coloured eggs nestled in the grass
  const er = Math.min(rx, rz) * 0.24;
  const egg = eggGeo(er, 10);
  const spots: [number, number, number, number][] = [[-0.45, 0.2, 0.9, 0.3], [0.05, 0.35, -0.6, -0.2], [0.5, 0.1, 0.4, 0.9], [-0.15, -0.35, 1.3, -0.1], [0.38, -0.4, -1.0, 0.4], [-0.6, -0.3, 0.2, 1.4]];
  spots.forEach(([sx, sz, tx, tz], i) => {
    const rr = Math.hypot(sx, sz);
    const y = gy + h * 0.12 * Math.sqrt(Math.max(0, 1 - rr * rr)) + er * 0.6;
    b.batch(egg.clone(), eggs[i % eggs.length], at(sx * rx, y, sz * rz, tx, 0, tz));
  });
};

// ----- other festivals -----

const menorah: Build = (b, w, d, h, _f, color) => {
  const metal = mat(FINISHES[color] ?? FINISHES.silver, { metalness: 0.8, roughness: 0.28 });
  const waxes = [mat("#f4f1e8", { roughness: 0.5 }), mat("#7fa8dc", { roughness: 0.5 })];
  const flame = flameMat();
  const fl = h * 0.075;
  const cl = h * 0.16;
  const raise = h * 0.1;
  const cup = h * 0.03;
  const yC = h - fl - cl - raise - cup;
  const cr = Math.min(0.006, w * 0.014);
  const s = (w / 2 - cr * 2.2) / 4;
  const tr = Math.min(0.006, w * 0.014);
  // a domed round foot and the stem with a knop
  const fr = Math.min(d / 2, w * 0.17);
  const fh = h * 0.06;
  b.add(new THREE.LatheGeometry([[0.001, 0], [fr, 0], [fr, 0], [fr, fh * 0.25], [fr, fh * 0.25], [fr * 0.8, fh * 0.6], [fr * 0.35, fh], [0.001, fh]].map(([x, y]) => new THREE.Vector2(x, y)), 28), metal);
  const yBot = yC - 4 * s * 0.92;
  b.cyl(tr * 1.3, tr * 1.6, yBot - fh + tr, 0, fh, 0, metal, 12);
  b.sphere(tr * 2.4, 0, fh + (yBot - fh) * 0.5, 0, metal, 1, 0.8, 1, 12);
  // four nested arms each side meet the stem: half rings
  for (let k = 1; k <= 4; k++) {
    const arm = new THREE.TorusGeometry(k * s, tr, 6, 10 + 4 * k, Math.PI).rotateZ(Math.PI).scale(1, 0.92, 1);
    b.add(arm, metal, 0, yC, 0);
    b.sphere(tr * 1.8, 0, yC - k * s * 0.92, 0, metal, 1, 1, 1, 10);
  }
  // the stem rising to the shamash, raised above the eight
  b.cyl(tr, tr, yC + raise - yBot, 0, yBot, 0, metal, 12);
  for (let i = -4; i <= 4; i++) {
    const x = i * s;
    const y = i === 0 ? yC + raise : yC;
    b.cyl(cr * 1.8, cr * 1.1, cup, x, y, 0, metal, 12);
    b.cyl(cr * 2.0, cr * 2.0, cup * 0.2, x, y + cup * 0.85, 0, metal, 12);
    b.cyl(cr, cr, cl, x, y + cup, 0, waxes[(i + 4) % 2], 10);
    b.batch(flameGeo(cr * 0.85, fl * 0.95), flame, at(x, y + cup + cl, 0));
  }
};

const diwaliDiyas: Build = (b, w, d, h, f) => {
  const rx = w / 2;
  const rz = d / 2;
  const flame = flameMat();
  const oil = mat("#c08a2a", { metalness: 0.3, roughness: 0.25 });
  const wickM = mat("#f0e6d0", { roughness: 1 });
  // the rangoli: rings and petals of coloured powder
  const t = Math.min(0.004, h * 0.06);
  b.add(new THREE.CylinderGeometry(1, 1, t, 48).scale(rx, 1, rz), mat("#c2307a", { roughness: 1 }), 0, t / 2, 0);
  const layer = (shapes: THREE.Shape[], c: string, k: number) => b.add(new THREE.ShapeGeometry(shapes, 10).rotateX(-Math.PI / 2).scale(rx, 1, rz), mat(c, { roughness: 1 }), 0, t + 0.0004 * k, 0);
  const petals = (n: number, r0: number, r1: number, wid: number, off = 0) => {
    const list: THREE.Shape[] = [];
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const P = (u: number, v: number) => new THREE.Vector2(c * u - s * v, s * u + c * v);
      const sh = new THREE.Shape();
      const p0 = P(r0, 0);
      sh.moveTo(p0.x, p0.y);
      const q1 = P((r0 + r1) / 2, wid);
      const p1 = P(r1, 0);
      sh.quadraticCurveTo(q1.x, q1.y, p1.x, p1.y);
      const q2 = P((r0 + r1) / 2, -wid);
      sh.quadraticCurveTo(q2.x, q2.y, p0.x, p0.y);
      list.push(sh);
    }
    return list;
  };
  const disc = (r: number, x = 0, y = 0) => {
    const s = new THREE.Shape();
    s.absarc(x, y, r, 0, Math.PI * 2, false);
    return s;
  };
  const ring = (r0: number, r1: number) => {
    const s = disc(r1);
    const hole = new THREE.Path();
    hole.absarc(0, 0, r0, 0, Math.PI * 2, true);
    s.holes.push(hole);
    return s;
  };
  layer([ring(0.86, 0.94)], "#f6f0e2", 1);
  layer(petals(16, 0.5, 0.86, 0.12), "#f08a24", 1);
  layer([ring(0.44, 0.5)], "#f4c430", 2);
  layer(petals(8, 0.12, 0.44, 0.14, Math.PI / 8), "#2f9a6a", 2);
  layer([disc(0.13)], "#f4c430", 3);
  const dots: THREE.Shape[] = [];
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * Math.PI * 2;
    dots.push(disc(0.03, Math.cos(a) * 0.82, Math.sin(a) * 0.82));
  }
  layer(dots, "#f6f0e2", 3);
  // clay lamps: a shallow bowl pinched to a spout, oil, a wick and its flame
  const dr = Math.min(rx, rz) * 0.22;
  const bh = Math.min(dr * 0.75, (h - t) * 0.42);
  const prof: [number, number][] = [[0.001, 0], [0.55, 0], [0.55, 0], [0.8, 0.15], [0.97, 0.55], [1, 1], [1, 1], [0.9, 1], [0.9, 1], [0.82, 0.62], [0.55, 0.35], [0.001, 0.33]];
  const spout = (x: number, z: number) => 1 + 0.55 * Math.pow(Math.max(0, Math.cos(Math.atan2(z, x))), 8);
  const bowl = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 20);
  const bp = bowl.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i);
    const y = bp.getY(i);
    const z = bp.getZ(i);
    const k = spout(x, z);
    const pinch = 1 - 0.35 * Math.pow(Math.max(0, Math.cos(Math.atan2(z, x))), 8) * y;
    bp.setXYZ(i, x * dr * k, y * bh * (1 + 0.12 * (k - 1)), z * dr * pinch);
  }
  bowl.computeVertexNormals();
  const oilG = new THREE.CircleGeometry(0.86, 24).rotateX(-Math.PI / 2);
  const op = oilG.attributes.position;
  for (let i = 0; i < op.count; i++) op.setXYZ(i, op.getX(i) * dr * spout(op.getX(i), op.getZ(i)) * 0.95, bh * 0.66, op.getZ(i) * dr);
  const places: [number, number, number][] = [[0, 0, 0.3], [-0.52, 0.42, 2.4], [0.52, 0.42, 0.7], [-0.5, -0.45, -2.3], [0.5, -0.45, -0.9]];
  for (const [px, pz, a] of places) {
    const turn = at(px * rx, t, pz * rz, 0, -a, 0);
    b.batch(bowl.clone(), f, turn);
    b.batch(oilG.clone(), oil, turn);
    const tip = V(dr * 1.38, bh * 1.04, 0).applyMatrix4(turn);
    const foot = V(dr * 1.15, bh * 0.7, 0).applyMatrix4(turn);
    b.batch(rodGeo(foot, tip, dr * 0.05, dr * 0.04, 4), wickM);
    b.batch(flameGeo(dr * 0.17, Math.min(h - tip.y - 0.001, dr * 0.85)), flame, at(tip.x, tip.y - dr * 0.04, tip.z));
  }
};

const ramadanLantern: Build = (b, w, d, h, _f, color) => {
  const metal = mat(FINISHES[color] ?? FINISHES.brass, { metalness: color === "black" ? 0.35 : 0.8, roughness: color === "black" ? 0.45 : 0.3 });
  const panes = [
    glowing(mat("#c8283c", { emissive: "#ff4050", emissiveIntensity: 0.7, roughness: 0.2 })),
    glowing(mat("#2a6ad0", { emissive: "#4a8cff", emissiveIntensity: 0.7, roughness: 0.2 })),
    glowing(mat("#2a9a5a", { emissive: "#40d080", emissiveIntensity: 0.7, roughness: 0.2 })),
    glowing(mat("#e0a020", { emissive: "#ffc040", emissiveIntensity: 0.8, roughness: 0.2 })),
  ];
  const R = (Math.min(w, d) / 2) * 0.9;
  const H = (k: number) => k * h;
  const t = Math.min(0.003, R * 0.03);
  // foot and the tapering bottom
  b.cyl(R * 0.62, R * 0.68, H(0.03), 0, 0, 0, metal, 6);
  b.cyl(R, R * 0.55, H(0.09), 0, H(0.03), 0, metal, 6);
  // a tier of coloured panes behind pierced metal: pointed arches, a round window below
  const tier = (r: number, y0: number, th: number, colours: number[]) => {
    const a = r * Math.cos(Math.PI / 6);
    const sw = r;
    const hw = 0.33 * sw;
    const arch = new THREE.Path();
    arch.moveTo(-hw, th * 0.22);
    arch.lineTo(-hw, th * 0.66);
    arch.quadraticCurveTo(-hw * 0.92, th * 0.83, 0, th * 0.92);
    arch.quadraticCurveTo(hw * 0.92, th * 0.83, hw, th * 0.66);
    arch.lineTo(hw, th * 0.22);
    arch.closePath();
    const frame = poly([[-sw / 2, 0], [sw / 2, 0], [sw / 2, th], [-sw / 2, th]]);
    frame.holes.push(arch);
    const dot = new THREE.Path();
    dot.absarc(0, th * 0.11, sw * 0.07, 0, Math.PI * 2, true);
    frame.holes.push(dot);
    const glassS = poly([[-sw * 0.42, th * 0.04], [sw * 0.42, th * 0.04], [sw * 0.42, th * 0.95], [-sw * 0.42, th * 0.95]]);
    const fg = new THREE.ExtrudeGeometry(frame, { depth: t, bevelEnabled: false, curveSegments: 6 });
    const gg = new THREE.ShapeGeometry(glassS);
    for (let k = 0; k < 6; k++) {
      const ang = Math.PI / 6 + (k * Math.PI) / 3;
      const dir = V(Math.sin(ang), 0, Math.cos(ang));
      b.batch(fg.clone(), metal, new THREE.Matrix4().makeRotationY(ang).setPosition(dir.clone().multiplyScalar(a - t).setY(y0)));
      b.batch(gg.clone(), panes[colours[k % colours.length]], new THREE.Matrix4().makeRotationY(ang).setPosition(dir.clone().multiplyScalar(a - t - 0.002).setY(y0)));
      const ca = (k * Math.PI) / 3;
      b.batch(rodGeo(V(Math.sin(ca) * r, y0, Math.cos(ca) * r), V(Math.sin(ca) * r, y0 + th, Math.cos(ca) * r), r * 0.045, r * 0.045, 6), metal);
    }
  };
  b.cyl(R * 1.05, R * 1.05, H(0.02), 0, H(0.12), 0, metal, 6);
  tier(R, H(0.14), H(0.36), [0, 1, 2, 3, 1, 2]);
  b.cyl(R * 1.05, R * 1.05, H(0.02), 0, H(0.5), 0, metal, 6);
  b.cyl(R * 0.62, R * 1.0, H(0.06), 0, H(0.52), 0, metal, 6);
  tier(R * 0.62, H(0.58), H(0.1), [3, 0, 3, 1, 3, 2]);
  b.cyl(R * 0.68, R * 0.68, H(0.015), 0, H(0.68), 0, metal, 6);
  // the dome, a finial, the hanging ring
  const D = H(0.16);
  const dome: [number, number][] = [[R * 0.66, 0], [R * 0.72, D * 0.18], [R * 0.62, D * 0.5], [R * 0.36, D * 0.78], [R * 0.12, D * 0.94], [0.001, D]];
  b.add(new THREE.LatheGeometry(dome.map(([x, y]) => new THREE.Vector2(x, y)), 12), metal, 0, H(0.695), 0);
  b.sphere(R * 0.09, 0, H(0.87), 0, metal, 1, 1, 1, 10);
  b.cyl(R * 0.03, R * 0.03, H(0.05), 0, H(0.855), 0, metal, 6);
  b.sphere(R * 0.06, 0, H(0.905), 0, metal, 1, 1, 1, 8);
  const rr = H(0.035);
  b.add(new THREE.TorusGeometry(rr, R * 0.025, 6, 16), metal, 0, h - rr - R * 0.025, 0);
};

const chineseLanterns: Build = (b, w, d, h, _f, color) => {
  const yellow = color === "yellow";
  const paper = glowing(mat(yellow ? "#e8bf3e" : "#c42a24", { emissive: yellow ? "#ffcf50" : "#ff4a30", emissiveIntensity: 0.22, roughness: 0.85 }));
  const gold = mat("#cfa64a", { metalness: 0.7, roughness: 0.3 });
  const tasselM = mat(yellow ? "#c42a24" : "#b8231e", { roughness: 0.8 });
  const cordM = mat("#8a1e1a", { roughness: 0.7 });
  const lantern = (x: number, r: number, bottom: number) => {
    const ry = r * 0.82;
    const tas = r * 0.6;
    const knot = r * 0.08;
    const cap = r * 0.09;
    const yc = bottom + tas + knot * 2 + cap + ry;
    // the ribbed, slightly flattened paper ball
    const g = new THREE.SphereGeometry(1, 32, 14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i);
      const py = p.getY(i);
      const pz = p.getZ(i);
      const k = 1 - 0.08 * Math.abs(Math.sin(Math.atan2(pz, px) * 8)) * Math.sqrt(Math.max(0, 1 - py * py));
      p.setXYZ(i, px * r * k, py * ry, pz * r * k);
    }
    b.add(smooth(g), paper, x, yc, 0);
    // gold caps top and bottom
    b.cyl(r * 0.42, r * 0.42, cap, x, yc + ry * 0.93 - cap * 0.1, 0, gold, 18);
    b.cyl(r * 0.42, r * 0.42, cap, x, yc - ry * 0.93 - cap * 0.9, 0, gold, 18);
    // the tassel under a gold knot
    const yb = yc - ry * 0.93 - cap * 0.9;
    b.sphere(knot, x, yb - knot, 0, gold, 1, 1, 1, 10);
    b.cyl(r * 0.05, r * 0.11, tas, x, bottom, 0, tasselM, 12);
    b.cyl(r * 0.065, r * 0.065, tas * 0.12, x, bottom + tas * 0.85, 0, gold, 12);
    // the cord to the ceiling and a small rosette there
    const yt = yc + ry * 0.93 + cap * 0.9;
    b.cyl(0.0025, 0.0025, h - yt, x, yt, 0, cordM, 5);
    b.cyl(0.016, 0.012, 0.008, x, h - 0.008, 0, gold, 12);
  };
  const rMid = Math.min(w * 0.17, d / 2) * 0.95;
  const rSide = rMid * 0.8;
  const tall = (r: number) => r * (0.82 * 2 + 0.6 + 0.16 + 0.09 * 2) + 0.03;
  const midBottom = Math.max(0, Math.min(h * 0.02, h - tall(rMid)));
  lantern(-w / 2 + rSide * 1.05, rSide, Math.max(0, Math.min(h - tall(rSide), midBottom + h * 0.16)));
  lantern(0, rMid, midBottom);
  lantern(w / 2 - rSide * 1.05, rSide, Math.max(0, Math.min(h - tall(rSide), midBottom + h * 0.1)));
};

export const BUILDERS: Record<string, Build> = {
  advent_wreath: adventWreath,
  christmas_reindeer: christmasReindeer,
  christmas_star_window: christmasStarWindow,
  candle_arch: candleArch,
  nutcracker,
  christmas_presents: christmasPresents,
  easter_bunny: easterBunny,
  easter_tree: easterTree,
  easter_basket: easterBasket,
  menorah,
  diwali_diyas: diwaliDiyas,
  ramadan_lantern: ramadanLantern,
  chinese_lanterns: chineseLanterns,
};
