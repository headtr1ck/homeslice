// More detailed built-in pieces: vehicles. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { FINISHES } from "../../model/modern";
import { Builder, C, ledMat, mat, v } from "../modern";
import type { Build } from "../modern";

// ----- helpers -----

/** A smooth closed outline through (z, y) points, drawn as a side panel `thick` wide. */
function profile(pts: [number, number][], thick: number, bevel: number, smooth = true, n = 28, bevelSegments = 2) {
  const c = pts.map(([z, y]) => new THREE.Vector2(z, y));
  const outline = smooth
    ? new THREE.CatmullRomCurve3(c.map((p) => new THREE.Vector3(p.x, p.y, 0)), true, "centripetal").getPoints(n).map((p) => new THREE.Vector2(p.x, p.y))
    : c;
  const depth = Math.max(0.002, thick - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(outline), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelOffset: -bevel * 0.8,
    bevelSegments,
    curveSegments: 4,
  });
  geo.translate(0, 0, -depth / 2);
  // shape x -> world z, extrusion -> world x
  geo.rotateY(-Math.PI / 2);
  return geo;
}

/** Scales the x of a geometry's vertices by f(y, z): a tank narrower at the knees. */
function taper(geo: THREE.BufferGeometry, f: (y: number, z: number) => number) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const nv = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const k = f(p.getY(i), p.getZ(i));
    p.setX(i, p.getX(i) * k);
    // a squeeze along x tilts the normals the other way (the inverse transpose of the scale)
    nv.fromBufferAttribute(n, i);
    nv.x /= k;
    nv.normalize();
    n.setXYZ(i, nv.x, nv.y, nv.z);
  }
  p.needsUpdate = true;
  n.needsUpdate = true;
  return geo;
}

/** A tube along a smooth curve through pts, its open ends capped so it reads as solid. */
function tube(b: Builder, pts: THREE.Vector3[], r: number, m: THREE.Material, seg = 24, radial = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, "centripetal");
  const mesh = b.add(new THREE.TubeGeometry(curve, seg, r, radial, closed), m);
  if (!closed)
    for (const t of [0, 1]) {
      const out = curve.getTangentAt(t).multiplyScalar(t ? 1 : -1);
      const cap = b.add(new THREE.CircleGeometry(r, radial), m);
      cap.position.copy(curve.getPointAt(t));
      cap.quaternion.setFromUnitVectors(v(0, 0, 1), out);
    }
  return mesh;
}

/** A box-section beam from a to c (wx across x, t the other way). */
function beam(b: Builder, a: THREE.Vector3, c: THREE.Vector3, wx: number, t: number, m: THREE.Material) {
  const len = a.distanceTo(c);
  const mesh = b.add(new THREE.BoxGeometry(wx, len, t), m);
  mesh.position.copy(a).add(c).multiplyScalar(0.5);
  const dir = c.clone().sub(a).normalize();
  // tilt only in the y-z plane, so the box stays square to x
  mesh.rotation.x = Math.atan2(dir.z, dir.y);
  return mesh;
}

/** A disc around the x axis at (x, y, z). */
function disc(b: Builder, r: number, t: number, x: number, y: number, z: number, m: THREE.Material, seg = 24) {
  return b.add(new THREE.CylinderGeometry(r, r, t, seg).rotateZ(Math.PI / 2), m, x, y, z);
}
/** A ring around the x axis at (x, y, z), its tube widened along x by `widen`. */
function ring(b: Builder, R: number, t: number, x: number, y: number, z: number, m: THREE.Material, seg = 32, widen = 1, radial = 8) {
  return b.add(new THREE.TorusGeometry(R, t, radial, seg).scale(1, 1, widen).rotateY(Math.PI / 2), m, x, y, z);
}

/**
 * Draws a vehicle at its reference size and fits it into w × d × h: x stretches freely, y and z
 * scale together so the wheels stay round (centred in the leftover length or height).
 */
function fitted(b: Builder, w: number, d: number, h: number, ref: [number, number, number], draw: (s: Builder) => void) {
  const s = new Builder();
  draw(s);
  const g = s.done();
  const k = Math.min(d / ref[1], h / ref[2]);
  g.scale.set(w / ref[0], k, k);
  b.g.add(g);
}

const paintOf = (color: string) => mat(FINISHES[color] ?? FINISHES.red, { roughness: 0.32, metalness: 0.35 });
const shell = (m: THREE.MeshStandardMaterial, roughness = 0.4) => mat(`#${m.color.getHexString()}`, { side: THREE.DoubleSide, roughness, metalness: m.metalness });

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  motorcycle: (b, w, d, h, _f, color) =>
    fitted(b, w, d, h, [0.8, 2.15, 1.15], (s) => {
      // a modern naked bike along z, front wheel at +z
      const paint = paintOf(color);
      const dark = color === "black" || color === "anthracite";
      const frameM = mat(dark ? "#5a5e64" : "#2a2c30", { metalness: 0.5, roughness: 0.45 });
      const black = mat("#1c1d20", { roughness: 0.7 });
      const tyre = mat("#161616", { roughness: 0.95 });
      const rimM = mat("#202226", { metalness: 0.4, roughness: 0.4 });
      const steel = mat(C.chrome, { metalness: 0.85, roughness: 0.25 });
      const alu = mat("#9ea3a9", { metalness: 0.7, roughness: 0.35 });
      const engineM = mat("#3b3e43", { metalness: 0.55, roughness: 0.45 });
      const finM = mat("#6d7178", { metalness: 0.6, roughness: 0.4 });
      const gold = mat("#c79a3b", { metalness: 0.7, roughness: 0.3 });
      const amber = mat("#e09a2c", { emissive: "#a35a00", emissiveIntensity: 0.3 });
      const r = 0.31;
      const zf = 1.075 - r;
      const zr = -1.075 + r;

      // wheels: tyre, cast five-spoke rim with a pin stripe, hub, brake discs
      const wheel = (z: number, width: number, front: boolean) => {
        ring(s, r - 0.047, 0.047, 0, r, z, tyre, 32, width / 0.094, 8);
        ring(s, 0.212, 0.012, 0, r, z, rimM, 24, width / 0.05, 4);
        disc(s, 0.045, width * 0.7, 0, r, z, alu, 12);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + (front ? 0 : 0.3);
          for (const da of [-0.07, 0.07]) {
            const sp = s.add(new THREE.BoxGeometry(width * 0.35, 0.17, 0.016), rimM, 0, r, z);
            sp.rotation.x = a + da;
            sp.translateY(0.12);
          }
        }
        for (const sx of front ? [-1, 1] : [1]) {
          disc(s, front ? 0.15 : 0.12, 0.006, sx * (width * 0.5 + 0.02), r, z, steel, 20);
          disc(s, 0.07, 0.008, sx * (width * 0.5 + 0.022), r, z, alu, 10);
        }
      };
      wheel(zf, 0.12, true);
      wheel(zr, 0.17, false);

      // front fork: upside-down tubes, raked, two clamps, axle, calipers
      const rake = Math.tan((25 * Math.PI) / 180);
      const forkAt = (y: number) => v(0, y, zf - (y - r) * rake);
      const top = forkAt(0.96);
      const low = forkAt(0.78);
      for (const sx of [-1, 1]) {
        const x = sx * 0.095;
        s.rod(v(x, r, zf), v(x, 0.58, forkAt(0.58).z), 0.02, black, 10);
        s.rod(v(x, 0.56, forkAt(0.56).z), v(x, top.y + 0.02, top.z), 0.027, gold, 12);
        s.box(0.035, 0.07, 0.06, sx * 0.105, r + 0.08, zf - 0.1, black);
      }
      for (const p of [top, low]) s.box(0.26, 0.035, 0.09, 0, p.y, p.z - 0.01, alu);
      s.rod(v(-0.12, r, zf), v(0.12, r, zf), 0.012, alu, 8);
      const fg = s.add(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.13, 20, 1, true, Math.PI * 0.15, Math.PI * 0.55).rotateZ(Math.PI / 2), shell(paint, 0.35), 0, r, zf);
      fg.rotation.x = -0.15;

      // headlight: a compact nose with LED eyes, the dash above
      const head = forkAt(0.82);
      s.add(profile([[0.13, -0.06], [0.16, 0.02], [0.1, 0.09], [0.02, 0.09], [0.0, 0.0], [0.04, -0.07]], 0.2, 0.035, true, 20), paint, 0, head.y, head.z - 0.02);
      const lamp = mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.6, roughness: 0.2 });
      for (const sx of [-1, 1]) s.box(0.07, 0.035, 0.03, sx * 0.045, head.y - 0.005, head.z + 0.135, lamp)!.rotation.x = -0.25;
      s.box(0.15, 0.025, 0.02, 0, head.y - 0.05, head.z + 0.13, black);
      s.box(0.13, 0.08, 0.025, 0, top.y + 0.04, top.z + 0.02, black)!.rotation.x = -0.6;
      s.box(0.11, 0.06, 0.004, 0, top.y + 0.052, top.z + 0.036, mat(C.screen, { roughness: 0.15 }))!.rotation.x = -0.6;

      // handlebar on risers, grips, levers, switch gear, mirrors on stalks
      const barY = 1.05;
      const barZ = top.z - 0.05;
      for (const sx of [-1, 1]) s.rod(v(sx * 0.05, top.y + 0.02, top.z), v(sx * 0.05, barY, barZ), 0.014, alu, 8);
      tube(s, [v(-0.34, barY + 0.02, barZ - 0.06), v(-0.18, barY, barZ - 0.01), v(0, barY, barZ), v(0.18, barY, barZ - 0.01), v(0.34, barY + 0.02, barZ - 0.06)], 0.012, black, 14, 6);
      for (const sx of [-1, 1]) {
        s.rod(v(sx * 0.29, barY + 0.015, barZ - 0.045), v(sx * 0.38, barY + 0.025, barZ - 0.075), 0.019, black, 10);
        s.rod(v(sx * 0.2, barY + 0.01, barZ + 0.02), v(sx * 0.33, barY + 0.005, barZ + 0.04), 0.006, alu, 6);
        s.box(0.05, 0.04, 0.04, sx * 0.19, barY - 0.02, barZ, black);
        s.rod(v(sx * 0.17, barY + 0.01, barZ), v(sx * 0.24, 1.11, barZ - 0.03), 0.006, black, 6);
        s.sphere(0.042, sx * 0.26, 1.12, barZ - 0.04, black, 1.5, 0.75, 0.3, 10);
        s.box(0.09, 0.045, 0.004, sx * 0.26, 1.098, barZ - 0.055, mat(C.mirror, { metalness: 0.9, roughness: 0.1 }));
      }

      // frame: steel trellis from the steering head to the swing-arm pivot, the subframe
      const pivot = v(0, 0.4, -0.16);
      const headTop = v(0, top.y - 0.04, top.z - 0.04);
      const headLow = v(0, low.y - 0.04, low.z - 0.03);
      s.rod(headTop, headLow, 0.035, frameM, 12);
      for (const sx of [-1, 1]) {
        const x = sx * 0.13;
        const a = v(x, 0.82, 0.18);
        const c = v(x, 0.7, -0.14);
        const lowA = v(x, 0.62, 0.22);
        const p = v(x, pivot.y, pivot.z);
        for (const [m0, m1] of [[headTop.clone().setX(sx * 0.05), a], [a, c], [c, p], [headLow.clone().setX(sx * 0.05), lowA], [lowA, a], [lowA, c], [c, v(x * 0.8, 0.84, -0.62)], [p, v(x * 0.8, 0.8, -0.5)]] as const) s.rod(m0, m1, 0.016, frameM, 6);
        s.box(0.04, 0.12, 0.12, sx * 0.14, pivot.y - 0.06, pivot.z, frameM);
      }

      // engine: crankcase, inclined cylinder block with fins, head cover, side covers, radiator
      s.box(0.34, 0.22, 0.46, 0, 0.17, 0.02, engineM, 0.05);
      s.box(0.22, 0.06, 0.3, 0, 0.13, 0.04, engineM);
      const cyl = new THREE.Group();
      cyl.position.set(0, 0.36, 0.13);
      cyl.rotation.x = 0.4;
      s.g.add(cyl);
      const blockGeo = (w0: number, h0: number, d0: number, y0: number) => new THREE.BoxGeometry(w0, h0, d0).translate(0, y0 + h0 / 2, 0);
      cyl.add(new THREE.Mesh(blockGeo(0.38, 0.2, 0.2, 0), engineM));
      for (let i = 0; i < 4; i++) cyl.add(new THREE.Mesh(blockGeo(0.4, 0.012, 0.22, 0.04 + i * 0.04), finM));
      cyl.add(new THREE.Mesh(blockGeo(0.36, 0.07, 0.18, 0.2), alu));
      for (const [x, rr] of [[0.18, 0.095], [-0.18, 0.08]] as const) {
        disc(s, rr, 0.03, x, 0.29, 0.02, finM, 18);
        disc(s, rr * 0.55, 0.035, x, 0.29, 0.02, alu, 12);
      }
      s.box(0.38, 0.28, 0.04, 0, 0.48, 0.4, black)!.rotation.x = -0.25;
      s.box(0.34, 0.24, 0.01, 0, 0.5, 0.425, mat("#3a3c40", { roughness: 0.9, metalness: 0.2 }))!.rotation.x = -0.25;

      // exhaust: four headers round the front of the engine into a stubby silencer on the right
      for (let i = 0; i < 4; i++) {
        const x = -0.12 + i * 0.08;
        tube(s, [v(x, 0.52, 0.29), v(x * 0.9, 0.4, 0.36), v(x * 0.6, 0.18, 0.33), v(x * 0.3 + 0.03, 0.09, 0.15), v(0.06, 0.085, -0.06)], 0.018, steel, 10, 5);
      }
      s.add(new THREE.SphereGeometry(0.075, 12, 8).scale(1, 0.8, 1.6), mat("#2c2e31", { metalness: 0.6, roughness: 0.4 }), 0.06, 0.1, -0.1);
      tube(s, [v(0.06, 0.1, -0.1), v(0.12, 0.17, -0.25), v(0.17, 0.25, -0.32)], 0.035, steel, 10, 10);
      const muff = s.add(new THREE.CylinderGeometry(0.07, 0.075, 0.3, 16).rotateX(Math.PI / 2), mat("#36383c", { metalness: 0.7, roughness: 0.35 }), 0.19, 0.29, -0.42);
      muff.rotation.x = -0.35;
      const tip = s.add(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14).rotateX(Math.PI / 2), steel, 0.19, 0.345, -0.58);
      tip.rotation.x = -0.35;

      // swing arm, chain and sprockets, rear shock with spring, hugger
      for (const sx of [-1, 1]) beam(s, v(sx * 0.12, pivot.y - 0.02, pivot.z), v(sx * 0.12, r, zr + 0.02), 0.04, 0.07, alu);
      s.rod(v(-0.14, r, zr), v(0.14, r, zr), 0.014, alu, 8);
      disc(s, 0.13, 0.008, -0.105, r, zr, mat("#2a2b2e", { metalness: 0.7, roughness: 0.3 }), 20);
      disc(s, 0.045, 0.02, -0.12, 0.27, -0.06, black, 12);
      s.rod(v(-0.105, r + 0.13, zr), v(-0.12, 0.315, -0.06), 0.008, black, 5);
      s.rod(v(-0.105, r - 0.13, zr), v(-0.12, 0.225, -0.06), 0.008, black, 5);
      s.rod(v(0, 0.36, -0.42), v(0, 0.66, -0.22), 0.022, black, 8);
      for (let i = 0; i < 5; i++) {
        const t = 0.2 + i * 0.12;
        const coil = s.add(new THREE.TorusGeometry(0.035, 0.008, 3, 8), gold, 0, 0.36 + 0.3 * t, -0.42 + 0.2 * t);
        coil.rotation.x = Math.PI / 2 - Math.atan2(0.2, 0.3);
      }
      const hug = s.add(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.18, 18, 1, true, Math.PI * 1.0, Math.PI * 0.4).rotateZ(Math.PI / 2), shell(black, 0.6), 0, r, zr);
      hug.rotation.x = 0.1;

      // fuel tank narrowing to the knees, flank scoops, filler cap
      const tank = profile([[0.46, 0.93], [0.36, 1.0], [0.12, 0.99], [-0.06, 0.92], [-0.12, 0.8], [0.02, 0.72], [0.3, 0.74], [0.44, 0.8]], 0.38, 0.07, true, 30, 3);
      taper(tank, (y, z) => (z < 0.05 ? 0.7 + Math.max(0, z + 0.12) * 1.75 : 1) * (0.7 + 0.3 * Math.sqrt(Math.max(0, 1 - ((y - 0.86) / 0.15) ** 2))));
      s.add(tank, paint);
      for (const sx of [-1, 1]) {
        s.add(profile([[0.5, 0.86], [0.34, 0.86], [0.18, 0.66], [0.26, 0.58], [0.44, 0.66]], 0.05, 0.015, true, 14, 1), paint, sx * 0.18, 0, 0).rotation.z = sx * 0.1;
        s.add(profile([[0.42, 0.78], [0.32, 0.79], [0.27, 0.7], [0.38, 0.7]], 0.02, 0, false), black, sx * 0.2, 0, 0).rotation.z = sx * 0.1;
      }
      disc(s, 0.04, 0.012, 0, 0.995, 0.25, alu, 14).rotation.z = Math.PI / 2;

      // seat: the rider step and the pillion, the tail cowl and rear light
      const seat = profile([[-0.06, 0.9], [-0.16, 0.86], [-0.36, 0.86], [-0.42, 0.92], [-0.66, 0.95], [-0.68, 0.89], [-0.42, 0.82], [-0.1, 0.79]], 0.27, 0.04, true, 24);
      // narrower pillion and nose, blended so no face spans a jump
      taper(seat, (_y, z) => 0.72 + 0.28 * THREE.MathUtils.smoothstep(z, -0.46, -0.32) - 0.15 * THREE.MathUtils.smoothstep(z, -0.16, -0.06));
      s.add(seat, mat("#232325", { roughness: 0.95 }));
      const tail = profile([[-0.1, 0.84], [-0.4, 0.84], [-0.7, 0.92], [-0.83, 0.955], [-0.855, 0.92], [-0.82, 0.875], [-0.5, 0.74], [-0.18, 0.7]], 0.25, 0.04, true, 24);
      taper(tail, (_y, z) => Math.max(0.35, 1 + (z < -0.3 ? (z + 0.3) * 1.1 : 0)));
      s.add(tail, paint);
      s.box(0.1, 0.022, 0.03, 0, 0.9, -0.83, mat("#b3261e", { emissive: "#c0170f", emissiveIntensity: 0.6 }))!.rotation.x = 0.4;
      // number plate hanger with indicators front and back
      s.rod(v(0, 0.78, -0.62), v(0, 0.62, -0.9), 0.02, black, 8);
      s.box(0.2, 0.13, 0.008, 0, 0.53, -0.93, mat("#f2f2ee", { roughness: 0.5 }))!.rotation.x = -0.15;
      s.box(0.08, 0.02, 0.04, 0, 0.66, -0.91, black);
      for (const sx of [-1, 1]) {
        s.rod(v(sx * 0.04, 0.67, -0.9), v(sx * 0.13, 0.69, -0.9), 0.006, black, 6);
        s.sphere(0.018, sx * 0.14, 0.69, -0.9, amber, 1.4, 1, 1, 8);
        s.rod(v(sx * 0.12, 0.8, 0.5), v(sx * 0.17, 0.8, 0.52), 0.006, black, 6);
        s.sphere(0.016, sx * 0.18, 0.8, 0.52, amber, 1.4, 1, 1, 8);
      }

      // foot pegs (rider and pillion), gear and brake levers, side stand
      for (const sx of [-1, 1]) {
        s.box(0.04, 0.09, 0.07, sx * 0.17, 0.3, -0.12, alu);
        s.rod(v(sx * 0.17, 0.33, -0.12), v(sx * 0.28, 0.33, -0.12), 0.013, black, 8);
        s.rod(v(sx * 0.14, 0.5, -0.4), v(sx * 0.24, 0.5, -0.42), 0.011, black, 8);
        s.rod(v(sx * 0.2, 0.33, -0.12), v(sx * 0.21, 0.29, 0.05), 0.007, alu, 6);
      }
      s.rod(v(-0.15, 0.3, -0.08), v(-0.3, 0.02, -0.04), 0.012, black, 6);
    }),

  e_scooter: (b, w, d, h, _f, color) =>
    fitted(b, w, d, h, [0.45, 1.1, 1.2], (s) => {
      // a folding e-scooter: deck with grip tape, stem with folding hinge, bars, small wheels
      const black = mat("#1c1d20", { roughness: 0.7 });
      const tyre = mat("#151515", { roughness: 0.95 });
      const alu = mat("#a4a9ae", { metalness: 0.7, roughness: 0.35 });
      const body = mat(FINISHES[color] ?? FINISHES.black, { roughness: 0.4, metalness: 0.3 });
      const trim = mat(color === "red" ? "#e8e6e1" : "#c8342b", { roughness: 0.4 });
      const r = 0.105;
      const zf = 0.55 - r;
      const zr = -0.55 + r;
      for (const [z, front] of [[zf, true], [zr, false]] as const) {
        ring(s, r - 0.03, 0.03, 0, r, z, tyre, 32, 1.4, 10);
        disc(s, r - 0.045, 0.05, 0, r, z, front ? alu : mat("#2a2b2e", { metalness: 0.5, roughness: 0.4 }), 20);
        disc(s, 0.025, 0.07, 0, r, z, alu, 12);
        for (let i = 0; i < 5; i++) {
          const sp = s.add(new THREE.BoxGeometry(0.056, 0.05, 0.012), black, 0, r, z);
          sp.rotation.x = (i / 5) * Math.PI * 2;
          sp.translateY(0.035);
        }
      }
      // deck: a slab with grip tape, a side stripe, the battery belly
      s.add(profile([[0.36, 0.1], [0.38, 0.15], [-0.32, 0.15], [-0.36, 0.11], [-0.33, 0.07], [0.33, 0.07]], 0.165, 0.025, false), body);
      s.box(0.13, 0.006, 0.6, 0, 0.15, 0.02, mat("#18181a", { roughness: 1 }));
      for (const sx of [-1, 1]) s.box(0.004, 0.012, 0.56, sx * 0.083, 0.105, 0.02, trim);
      s.box(0.12, 0.03, 0.5, 0, 0.05, 0.02, black, 0.012);
      // rear: fender over the wheel with the tail light, the dropouts
      s.add(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.07, 16, 1, true, Math.PI * 0.9, Math.PI * 0.75).rotateZ(Math.PI / 2), shell(body), 0, r, zr);
      s.box(0.06, 0.018, 0.02, 0, 0.19, zr - 0.08, mat("#b3261e", { emissive: "#c0170f", emissiveIntensity: 0.6 }))!.rotation.x = -0.6;
      for (const sx of [-1, 1]) beam(s, v(sx * 0.045, 0.11, -0.3), v(sx * 0.045, r, zr), 0.012, 0.04, body);
      // front: neck with folding hinge, fork legs, mudguard
      const base = v(0, 0.24, 0.41);
      const topP = v(0, 1.1, 0.35);
      beam(s, v(0, 0.11, 0.33), v(0, 0.2, 0.4), 0.09, 0.08, body);
      s.box(0.08, 0.06, 0.07, 0, 0.17, 0.39, black);
      s.rod(v(-0.05, 0.2, 0.39), v(0.05, 0.2, 0.39), 0.012, alu, 8);
      for (const sx of [-1, 1]) s.rod(v(sx * 0.04, r, zf), v(sx * 0.03, 0.27, 0.42), 0.014, body, 8);
      s.add(new THREE.CylinderGeometry(r + 0.018, r + 0.018, 0.06, 14, 1, true, Math.PI * 0.1, Math.PI * 0.6).rotateZ(Math.PI / 2), shell(body), 0, r, zf);
      // stem, collar, headlight
      s.rod(base, topP, 0.024, body, 14);
      s.rod(v(0, 0.24, base.z), v(0, 0.36, base.z - 0.009), 0.028, black, 14);
      const lampZ = base.z + (topP.z - base.z) * 0.55;
      s.sphere(0.03, 0, 0.72, lampZ + 0.025, black, 1.2, 1, 0.8, 14);
      s.box(0.04, 0.02, 0.012, 0, 0.71, lampZ + 0.045, mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.6 }));
      // handlebar: bar, grips, brake levers, bell, display console
      const barY = 1.13;
      const barZ = topP.z - 0.01;
      s.rod(v(-0.2, barY, barZ), v(0.2, barY, barZ), 0.012, black, 10);
      for (const sx of [-1, 1]) {
        s.rod(v(sx * 0.14, barY, barZ), v(sx * 0.225, barY, barZ), 0.019, mat("#262628", { roughness: 1 }), 10);
        s.rod(v(sx * 0.09, barY + 0.005, barZ + 0.01), v(sx * 0.19, barY - 0.005, barZ + 0.05), 0.005, alu, 6);
      }
      s.box(0.1, 0.035, 0.08, 0, barY - 0.01, barZ, black, 0.014);
      s.box(0.06, 0.003, 0.04, 0, barY + 0.025, barZ, mat(C.screen, { roughness: 0.15 }));
      s.box(0.04, 0.002, 0.008, 0, barY + 0.027, barZ + 0.012, ledMat("#3fa8ff"));
      s.cyl(0.016, 0.016, 0.012, -0.11, barY + 0.01, barZ, alu, 12);
      // kickstand on the left
      s.rod(v(-0.08, 0.07, -0.1), v(-0.16, 0.0, -0.2), 0.008, black, 6);
    }),

  bicycle: (b, w, d, h, _f, color) =>
    fitted(b, w, d, h, [0.6, 1.75, 1.05], (s) => {
      // a trekking bike: diamond frame, spoked wheels, flat bar, saddle, drivetrain, rack
      const frame = mat(FINISHES[color] ?? FINISHES.black, { roughness: 0.35, metalness: color === "silver" ? 0.6 : 0.3 });
      const black = mat("#1c1d20", { roughness: 0.7 });
      const tyre = mat("#171717", { roughness: 0.95 });
      const alu = mat("#b4b8bd", { metalness: 0.75, roughness: 0.3 });
      const dark = mat("#3a3c40", { metalness: 0.6, roughness: 0.4 });
      const r = 0.345;
      const zr = -0.875 + r;
      const zf = 0.875 - r;
      const bb = v(0, 0.28, -0.08);
      const stTop = v(0, 0.76, -0.23);
      const htTop = v(0, 0.78, 0.38);
      const htLow = v(0, 0.63, 0.43);

      // wheels: tyre, rim, hub and 28 spokes laced from both flanges, merged
      const spokeM = mat("#b4b8bd", { metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide });
      for (const z of [zr, zf]) {
        ring(s, r - 0.019, 0.019, 0, r, z, tyre, 36, 1, 5);
        ring(s, r - 0.042, 0.009, 0, r, z, alu, 30, 1.1, 4);
        s.add(new THREE.CylinderGeometry(0.018, 0.018, 0.11, 10).rotateZ(Math.PI / 2), alu, 0, r, z);
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          const side = i % 2 ? 1 : -1;
          const ha = a + side * 0.5;
          const p0 = v(side * 0.03, r + Math.cos(ha) * 0.022, z + Math.sin(ha) * 0.022);
          const p1 = v(0, r + Math.cos(a) * (r - 0.048), z + Math.sin(a) * (r - 0.048));
          // a thin double-sided ribbon facing sideways: a wire at this size, two triangles
          const geo = new THREE.PlaneGeometry(0.0036, p0.distanceTo(p1)).rotateY(Math.PI / 2);
          const m4 = new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), p1.clone().sub(p0).normalize()), v(1, 1, 1));
          s.batch(geo, spokeM, m4);
        }
      }

      // frame: top, down and seat tube, head tube, stays, fork
      s.rod(stTop, htTop.clone().setY(htTop.y - 0.02), 0.016, frame, 12);
      s.rod(bb, htLow.clone().setY(htLow.y + 0.02), 0.022, frame, 12);
      s.rod(bb, stTop, 0.016, frame, 12);
      s.rod(htLow.clone().setY(htLow.y - 0.02), htTop.clone().setY(htTop.y + 0.02), 0.022, frame, 12);
      s.sphere(0.03, bb.x, bb.y, bb.z, frame, 1.3, 1, 1, 8);
      for (const sx of [-1, 1]) {
        s.rod(v(sx * 0.055, r, zr), v(sx * 0.03, bb.y, bb.z - 0.02), 0.01, frame, 8);
        s.rod(v(sx * 0.055, r, zr), v(sx * 0.018, stTop.y - 0.04, stTop.z + 0.01), 0.009, frame, 8);
        tube(s, [v(sx * 0.03, htLow.y - 0.03, htLow.z + 0.005), v(sx * 0.045, 0.48, htLow.z + 0.04), v(sx * 0.05, r, zf)], 0.011, frame, 8, 6);
      }
      s.box(0.1, 0.03, 0.05, 0, htLow.y - 0.05, htLow.z + 0.005, frame);
      s.rod(v(-0.06, r, zf), v(0.06, r, zf), 0.006, alu, 6);
      s.rod(v(-0.065, r, zr), v(0.065, r, zr), 0.006, alu, 6);

      // seat post and saddle (a tapered nose, wider at the back)
      const post = v(0, 0.93, stTop.z - 0.17 * 0.3);
      s.rod(stTop.clone().setY(stTop.y - 0.02), post, 0.0135, alu, 10);
      s.cyl(0.02, 0.02, 0.03, stTop.x, stTop.y - 0.02, stTop.z, frame, 12);
      const outline = new THREE.CatmullRomCurve3([v(0, 0.14, 0), v(0.03, 0.08, 0), v(0.05, -0.04, 0), v(0.085, -0.1, 0), v(0.06, -0.14, 0), v(0, -0.135, 0), v(-0.06, -0.14, 0), v(-0.085, -0.1, 0), v(-0.05, -0.04, 0), v(-0.03, 0.08, 0)], true, "centripetal")
        .getPoints(20)
        .map((p) => new THREE.Vector2(p.x, p.y));
      const saddle = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 });
      saddle.rotateX(-Math.PI / 2);
      s.add(saddle, mat("#1e1e20", { roughness: 0.6 }), 0, post.y + 0.005, post.z + 0.01).rotation.x = 0.05;
      s.box(0.05, 0.02, 0.1, 0, post.y - 0.01, post.z, dark);

      // stem, flat bar with grips, brake levers, bell
      const stemTop = v(0, 0.86, 0.35);
      const barP = v(0, 0.95, 0.4);
      s.rod(htTop, stemTop, 0.016, dark, 10);
      s.rod(stemTop, barP, 0.017, dark, 10);
      tube(s, [v(-0.3, barP.y + 0.02, barP.z - 0.035), v(-0.15, barP.y + 0.01, barP.z - 0.005), v(0, barP.y, barP.z), v(0.15, barP.y + 0.01, barP.z - 0.005), v(0.3, barP.y + 0.02, barP.z - 0.035)], 0.011, dark, 12, 5);
      for (const sx of [-1, 1]) {
        s.rod(v(sx * 0.21, barP.y + 0.012, barP.z - 0.012), v(sx * 0.3, barP.y + 0.02, barP.z - 0.035), 0.017, black, 10);
        s.rod(v(sx * 0.17, barP.y + 0.01, barP.z), v(sx * 0.26, barP.y, barP.z + 0.06), 0.005, black, 6);
      }
      s.cyl(0.016, 0.016, 0.014, -0.08, barP.y + 0.008, barP.z, alu, 12);

      // drivetrain on the right: chainring, crank arms and pedals, cassette, derailleur, chain
      const right = 0.055;
      ring(s, 0.1, 0.006, right, bb.y, bb.z, dark, 24, 1, 4);
      disc(s, 0.09, 0.004, right, bb.y, bb.z, mat("#2a2b2e", { metalness: 0.6, roughness: 0.4 }), 20);
      disc(s, 0.022, 0.03, right + 0.01, bb.y, bb.z, alu, 12);
      const ca = 0.6;
      for (const [sx, a] of [[1, ca], [-1, ca + Math.PI]] as const) {
        const end = v(sx * 0.08, bb.y - Math.cos(a) * 0.17, bb.z + Math.sin(a) * 0.17);
        s.rod(v(sx * 0.07, bb.y, bb.z), end, 0.011, alu, 8);
        s.box(0.09, 0.02, 0.06, sx * 0.13, end.y - 0.01, end.z, black);
        s.box(0.08, 0.006, 0.065, sx * 0.13, end.y - 0.013, end.z, mat("#e09a2c", { emissive: "#7a4a00", emissiveIntensity: 0.2 }));
      }
      for (let i = 0; i < 3; i++) disc(s, 0.055 - i * 0.01, 0.005, right + 0.006 + i * 0.007, r, zr, dark, 16);
      const chainM = mat("#4a4c50", { metalness: 0.6, roughness: 0.5 });
      s.rod(v(right, bb.y + 0.1, bb.z), v(right, r + 0.05, zr), 0.0045, chainM, 5);
      s.rod(v(right, bb.y - 0.1, bb.z), v(right, r - 0.12, zr + 0.02), 0.0045, chainM, 5);
      s.box(0.015, 0.09, 0.03, right + 0.01, r - 0.1, zr + 0.01, dark);
      // rear rack, mudguards, lights, kickstand
      const rackY = 0.72;
      for (const sx of [-1, 1]) {
        s.rod(v(sx * 0.075, rackY, -0.25), v(sx * 0.075, rackY, -0.7), 0.006, alu, 6);
        s.rod(v(sx * 0.075, rackY, -0.62), v(sx * 0.062, r, zr - 0.01), 0.006, alu, 6);
        s.rod(v(sx * 0.075, rackY, -0.25), v(sx * 0.02, stTop.y - 0.07, stTop.z + 0.01), 0.005, alu, 6);
      }
      s.rod(v(-0.075, rackY, -0.7), v(0.075, rackY, -0.7), 0.006, alu, 6);
      s.rod(v(-0.075, rackY, -0.45), v(0.075, rackY, -0.45), 0.005, alu, 6);
      const guard = mat("#202124", { side: THREE.DoubleSide, roughness: 0.5 });
      for (const [z, a0, len] of [[zr, Math.PI * 0.95, Math.PI * 0.55], [zf, Math.PI * 0.15, Math.PI * 0.6]] as const)
        s.add(new THREE.CylinderGeometry(r + 0.025, r + 0.025, 0.05, 18, 1, true, a0, len).rotateZ(Math.PI / 2), guard, 0, r, z);
      s.box(0.05, 0.025, 0.02, 0, rackY - 0.03, -0.71, mat("#b3261e", { emissive: "#c0170f", emissiveIntensity: 0.5 }));
      s.box(0.04, 0.035, 0.035, 0, htLow.y + 0.02, htLow.z + 0.05, black);
      s.box(0.03, 0.02, 0.004, 0, htLow.y + 0.03, htLow.z + 0.07, mat("#f4f1e6", { emissive: "#fff4d6", emissiveIntensity: 0.5 }));
      s.rod(v(-0.04, bb.y - 0.01, bb.z - 0.08), v(-0.1, 0.0, bb.z - 0.24), 0.007, dark, 6);
    }),

  bike_rack: (b, w, d, h, _f, color) => {
    // Sheffield hoops with a low tapping rail, bolted onto two ground rails
    const metal = mat(FINISHES[color] ?? FINISHES.silver, { metalness: 0.65, roughness: 0.35 });
    const bolt = mat("#6e7278", { metalness: 0.7, roughness: 0.4 });
    const tr = 0.024;
    const n = Math.max(1, Math.round(w / 0.4));
    const half = d / 2 - tr - 0.02;
    const cr = Math.min(0.12, half * 0.7, h * 0.3);
    const top = h - tr;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const path = new THREE.CurvePath<THREE.Vector3>();
      path.add(new THREE.LineCurve3(v(x, 0.03, -half), v(x, top - cr, -half)));
      path.add(new THREE.QuadraticBezierCurve3(v(x, top - cr, -half), v(x, top, -half), v(x, top, -half + cr)));
      path.add(new THREE.LineCurve3(v(x, top, -half + cr), v(x, top, half - cr)));
      path.add(new THREE.QuadraticBezierCurve3(v(x, top, half - cr), v(x, top, half), v(x, top - cr, half)));
      path.add(new THREE.LineCurve3(v(x, top - cr, half), v(x, 0.03, half)));
      b.add(new THREE.TubeGeometry(path, 30, tr, 8), metal);
      b.rod(v(x, h * 0.32, -half), v(x, h * 0.32, half), tr * 0.75, metal, 8);
      for (const z of [-half, half]) {
        b.box(0.1, 0.012, 0.1, x, 0.035, z, metal);
        for (const sx of [-1, 1]) b.cyl(0.008, 0.008, 0.008, x + sx * 0.035, 0.047, z, bolt, 6);
      }
    }
    for (const z of [-half, half]) {
      b.box(w, 0.035, 0.07, 0, 0, z, metal);
      for (const sx of [-1, 1]) b.box(0.08, 0.006, 0.12, sx * (w / 2 - 0.04), 0, z, bolt);
    }
  },

  wallbox: (b, w, d, h, f, color) => {
    // a wall charger: rounded housing, glossy face with display and LED strip, the type 2
    // cable coiled on a hook below the face, its plug docked in a holster
    const black = mat("#17181a", { roughness: 0.6 });
    const cable = mat("#1d1e20", { roughness: 0.55 });
    const face = mat(color === "black" ? "#3a3c40" : "#151618", { roughness: 0.12, metalness: 0.25 });
    const bodyD = d * 0.68;
    const bz = -d / 2 + bodyD / 2;
    const fz = -d / 2 + bodyD;
    const y0 = h * 0.08;
    const bh = h - y0;
    b.box(w * 0.9, bh * 0.9, 0.012, 0, y0 + bh * 0.05, -d / 2 + 0.006, mat("#55585d", { roughness: 0.6 }));
    b.box(w, bh, bodyD - 0.012, 0, y0, bz + 0.006, f, Math.min(0.035, w * 0.15));
    // the glossy face on the upper part, with display and status strip
    const faceH = bh * 0.5;
    const faceY = y0 + bh * 0.44;
    b.box(w * 0.82, faceH, 0.012, 0, faceY, fz, face, 0.02);
    b.box(w * 0.5, faceH * 0.32, 0.004, 0, faceY + faceH * 0.5, fz + 0.007, mat(C.screen, { roughness: 0.1 }));
    b.box(w * 0.44, faceH * 0.06, 0.004, 0, faceY + faceH * 0.58, fz + 0.008, mat("#6fb7d8", { emissive: "#3a8fb8", emissiveIntensity: 0.35 }));
    b.box(w * 0.6, 0.012, 0.006, 0, faceY + faceH * 0.2, fz + 0.007, ledMat());
    b.cyl(0.012, 0.012, 0.004, 0, faceY + faceH * 0.06, fz + 0.008, mat("#2a2c30", { roughness: 0.3 }), 14).rotation.x = Math.PI / 2;
    // cable gland at the bottom
    const glandX = -w * 0.22;
    b.cyl(0.018, 0.022, 0.03, glandX, y0 - 0.02, fz - 0.03, black, 12);
    // a hook below the face, with three loops of cable hanging from it
    const hookY = y0 + bh * 0.32;
    const hz = fz + 0.012;
    b.box(0.05, 0.02, 0.03, -w * 0.05, hookY - 0.01, fz + 0.012, black);
    const R = Math.min(w * 0.36, (hookY + 0.01) / 2);
    for (let i = 0; i < 3; i++) {
      const loop = b.add(new THREE.TorusGeometry(R, 0.0095, 6, 36), cable, -w * 0.05 + (i - 1) * 0.008, hookY - R + 0.004 - i * 0.004, hz + 0.008 + i * 0.011);
      loop.rotation.z = (i - 1) * 0.08;
      loop.rotation.x = -0.08 - i * 0.04;
    }
    // cable from the gland into the coil, and from the coil up to the plug
    tube(b, [v(glandX, y0 - 0.02, fz - 0.03), v(glandX - 0.003, y0 - 0.035, fz - 0.012), v(glandX - 0.008, y0 - 0.035, fz + 0.008), v(-w * 0.05 - R * 0.75, hookY - R * 1.55, hz + 0.004)], 0.0095, cable, 14, 6);
    const plugX = w * 0.3;
    const plugY = y0 + bh * 0.18;
    tube(b, [v(-w * 0.05 + R * 0.6, hookY - R * 1.75, hz + 0.03), v(plugX, y0 * 0.6, hz + 0.03), v(plugX, plugY - 0.05, fz + 0.03)], 0.0095, cable, 14, 6);
    // the plug docked in its holster: holder cup, handle with grip
    b.box(0.05, 0.065, 0.025, plugX, plugY - 0.005, fz + 0.012, black, 0.008);
    const plug = b.add(new THREE.CylinderGeometry(0.019, 0.016, 0.08, 14), mat("#26272a", { roughness: 0.5 }), plugX, plugY, fz + 0.033);
    plug.rotation.x = -0.2;
    b.cyl(0.021, 0.021, 0.012, plugX, plugY + 0.03, fz + 0.04, mat(C.black, { roughness: 0.35 }), 14);
  },
};
