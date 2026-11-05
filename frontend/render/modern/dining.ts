// More detailed built-in pieces: dining. Each entry replaces the piece of the
// same key in ../modern.ts (same size, finishes and frame: centred, front at +z, on y = 0).
import * as THREE from "three";
import { mat, glass, C, type Build, type Builder } from "../modern";

type V3 = THREE.Vector3;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smooth lookup of [t, value] pairs (t ascending). */
const curve = (pairs: [number, number][], t: number) => {
  if (t <= pairs[0][0]) return pairs[0][1];
  for (let i = 1; i < pairs.length; i++)
    if (t <= pairs[i][0]) {
      const [t0, a] = pairs[i - 1];
      const [t1, c] = pairs[i];
      const k = (t - t0) / (t1 - t0);
      return lerp(a, c, k * k * (3 - 2 * k));
    }
  return pairs[pairs.length - 1][1];
};
/** A cushion's thickness: `rim` at the edges, `full` inside. */
const puff = (rim: number, full: number, p = 0.35) => (u: number, vv: number) => rim + (full - rim) * Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * vv), p);

// ----- geometry helpers: every triangle is wound to face along its normals -----

class Mesher {
  private p: number[] = [];
  private n: number[] = [];
  private t: number[] = [];
  tri(a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3, ua: number[] = [0, 0], ub: number[] = [0, 0], uc: number[] = [0, 0]) {
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    if (face.lengthSq() < 1e-14) return;
    if (face.dot(na.clone().add(nb).add(nc)) < 0) {
      [b, c] = [c, b];
      [nb, nc] = [nc, nb];
      [ub, uc] = [uc, ub];
    }
    for (const [q, m, u] of [[a, na, ua], [b, nb, ub], [c, nc, uc]] as const) {
      this.p.push(q.x, q.y, q.z);
      this.n.push(m.x, m.y, m.z);
      this.t.push(u[0], u[1]);
    }
  }
  quad(a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3, ua?: number[], ub?: number[], uc?: number[], ud?: number[]) {
    this.tri(a, b, c, na, nb, nc, ua, ub, uc);
    this.tri(a, c, d, na, nc, nd, ua, uc, ud);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.t, 2));
    return g;
  }
}

/**
 * A solid sheet of thickness `thick` around the surface fn(u, v) (u, v in 0..1): both faces
 * and the four edges. A varying thickness makes cushions (thin at the rim, full inside).
 */
function sheet(fn: (u: number, v: number) => V3, nu: number, nv: number, thick: number | ((u: number, v: number) => number)) {
  const P: V3[][] = [];
  for (let i = 0; i <= nu; i++) {
    P.push([]);
    for (let j = 0; j <= nv; j++) P[i].push(fn(i / nu, j / nv));
  }
  const N: V3[][] = [];
  const O: V3[][] = [];
  const I: V3[][] = [];
  for (let i = 0; i <= nu; i++) {
    N.push([]);
    O.push([]);
    I.push([]);
    for (let j = 0; j <= nv; j++) {
      const pu = P[Math.min(i + 1, nu)][j].clone().sub(P[Math.max(i - 1, 0)][j]);
      const pv = P[i][Math.min(j + 1, nv)].clone().sub(P[i][Math.max(j - 1, 0)]);
      const n = pu.cross(pv).normalize();
      const t = (typeof thick === "number" ? thick : thick(i / nu, j / nv)) / 2;
      N[i].push(n);
      O[i].push(P[i][j].clone().addScaledVector(n, t));
      I[i].push(P[i][j].clone().addScaledVector(n, -t));
    }
  }
  // each face's normals from its own shape (a cushion's faces tilt towards its thinner rim)
  const faceNormals = (G: V3[][], sign: number) =>
    G.map((row, i) =>
      row.map((_, j) => {
        const pu = G[Math.min(i + 1, nu)][j].clone().sub(G[Math.max(i - 1, 0)][j]);
        const pv = G[i][Math.min(j + 1, nv)].clone().sub(G[i][Math.max(j - 1, 0)]);
        const n = pu.cross(pv).normalize();
        return n.dot(N[i][j]) * sign < 0 ? n.negate() : n;
      }),
    );
  const NO = faceNormals(O, 1);
  const NI = faceNormals(I, -1);
  const m = new Mesher();
  const uv = (i: number, j: number) => [i / nu, j / nv];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      m.quad(O[i][j], O[i + 1][j], O[i + 1][j + 1], O[i][j + 1], NO[i][j], NO[i + 1][j], NO[i + 1][j + 1], NO[i][j + 1], uv(i, j), uv(i + 1, j), uv(i + 1, j + 1), uv(i, j + 1));
      m.quad(I[i][j], I[i + 1][j], I[i + 1][j + 1], I[i][j + 1], NI[i][j], NI[i + 1][j], NI[i + 1][j + 1], NI[i][j + 1], uv(i, j), uv(i + 1, j), uv(i + 1, j + 1), uv(i, j + 1));
    }
  const edge = (a: [number, number], b: [number, number], ia: [number, number], ib: [number, number]) => {
    const out = P[a[0]][a[1]].clone().sub(P[ia[0]][ia[1]]).add(P[b[0]][b[1]].clone().sub(P[ib[0]][ib[1]]));
    const n = N[a[0]][a[1]].clone().add(N[b[0]][b[1]]).normalize();
    const e = out.addScaledVector(n, -out.dot(n)).normalize();
    m.quad(O[a[0]][a[1]], O[b[0]][b[1]], I[b[0]][b[1]], I[a[0]][a[1]], e, e, e, e, [0, 0], [1, 0], [1, 1], [0, 1]);
  };
  for (let i = 0; i < nu; i++) {
    edge([i, 0], [i + 1, 0], [i, 1], [i + 1, 1]);
    edge([i, nv], [i + 1, nv], [i, nv - 1], [i + 1, nv - 1]);
  }
  for (let j = 0; j < nv; j++) {
    edge([0, j], [0, j + 1], [1, j], [1, j + 1]);
    edge([nu, j], [nu, j + 1], [nu - 1, j], [nu - 1, j + 1]);
  }
  return m.geometry();
}

/** A round tube along points (radius may vary along it), closed into a loop or capped at its ends. */
function tube(pts: V3[], radius: number | ((s: number) => number), radial = 8, closed = false) {
  const n = pts.length;
  const at = (i: number) => pts[closed ? (i + n) % n : Math.min(n - 1, Math.max(0, i))];
  const T = pts.map((_, i) => at(i + 1).clone().sub(at(i - 1)).normalize());
  let ref = Math.abs(T[0].y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  const rings: { c: V3; n: V3[] }[] = [];
  for (let i = 0; i < n; i++) {
    const N = ref.clone().addScaledVector(T[i], -ref.dot(T[i])).normalize();
    ref = N;
    const B = T[i].clone().cross(N);
    const ns: V3[] = [];
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      ns.push(N.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)));
    }
    rings.push({ c: pts[i], n: ns });
  }
  const r = (i: number) => (typeof radius === "number" ? radius : radius(i / (n - 1)));
  const m = new Mesher();
  const ring = (i: number, k: number) => rings[i].c.clone().addScaledVector(rings[i].n[k % radial], r(i));
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < radial; k++) {
      const k1 = (k + 1) % radial;
      const vi = (q: number) => [q / radial, i / n];
      const vj = (q: number) => [q / radial, (i + 1) / n];
      m.quad(ring(i, k), ring(i, k + 1), ring(j, k1), ring(j, k), rings[i].n[k], rings[i].n[k1], rings[j].n[k1], rings[j].n[k], vi(k), vi(k + 1), vj(k + 1), vj(k));
    }
  }
  if (!closed)
    for (const [i, dir] of [[0, T[0].clone().negate()], [n - 1, T[n - 1]]] as const)
      for (let k = 0; k < radial; k++) m.tri(rings[i].c, ring(i, k), ring(i, k + 1), dir, dir, dir);
  return m.geometry();
}

/** Rounds a polyline's corners (quadratic arcs of about `rad`), for bent tubes and rods. */
function fillet(pts: V3[], rad: number, steps = 5, closed = false): V3[] {
  const out: V3[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(p.clone());
      continue;
    }
    const a = pts[(i - 1 + n) % n];
    const c = pts[(i + 1) % n];
    // gentle bends (already smooth) stay as they are
    if (p.clone().sub(a).normalize().dot(c.clone().sub(p).normalize()) > 0.95) {
      out.push(p.clone());
      continue;
    }
    const l = Math.min(rad, a.distanceTo(p) * 0.49, c.distanceTo(p) * 0.49);
    const s = p.clone().addScaledVector(a.clone().sub(p).normalize(), l);
    const e = p.clone().addScaledVector(c.clone().sub(p).normalize(), l);
    const q = new THREE.QuadraticBezierCurve3(s, p, e);
    for (let k = 0; k <= steps; k++) out.push(q.getPoint(k / steps));
  }
  return out;
}

/** A tapering leg or rail from a (radius ra) to c (radius rc); square in section if asked. */
function strut(b: Builder, a: V3, c: V3, ra: number, rc: number, m: THREE.Material, square = false, seg = 10) {
  const k = square ? Math.SQRT2 : 1;
  let g: THREE.BufferGeometry = new THREE.CylinderGeometry(rc * k, ra * k, a.distanceTo(c), square ? 4 : seg, 1, false, square ? Math.PI / 4 : 0);
  if (square) {
    g = g.toNonIndexed();
    g.computeVertexNormals();
  }
  const mesh = b.add(g, m);
  mesh.position.copy(a).add(c).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(V(0, 1, 0), c.clone().sub(a).normalize());
  return mesh;
}

/** A lathe (profile of [radius, y] from the axis at the bottom round to the axis at the top), stretched in x/z. */
function lathe(b: Builder, profile: [number, number][], m: THREE.Material, seg: number, x = 0, y = 0, z = 0, sx = 1, sz = 1) {
  const g = new THREE.LatheGeometry(profile.map(([r, yy]) => new THREE.Vector2(r, yy)), seg);
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  return b.add(g, m, x, y, z);
}

/** A table top: rounded edges, its slimmer underside bevelled away. */
function tableTop(b: Builder, w: number, d: number, h: number, t: number, m: THREE.Material) {
  b.box(w, t * 0.6, d, 0, h - t * 0.6, 0, m, Math.min(0.008, t * 0.25));
  b.box(w - 0.03, t * 0.45, d - 0.03, 0, h - t, 0, m, 0.004);
}

/** A tulip pedestal (lathe) of foot radius `rf` and stem radius `rs`, up to height `top`. */
function tulip(b: Builder, rf: number, rs: number, top: number, m: THREE.Material, sx = 1, sz = 1) {
  const prof: [number, number][] = [[0, 0], [rf - 0.01, 0], [rf, 0.008], [rf - 0.004, 0.02]];
  for (let i = 1; i <= 8; i++) {
    const k = i / 8;
    prof.push([rs + (rf - rs) * Math.pow(1 - k, 3) * 0.92, 0.02 + k * top * 0.35]);
  }
  prof.push([rs, top * 0.6]);
  for (let i = 1; i <= 5; i++) {
    const k = i / 5;
    prof.push([rs + (rf * 0.45 - rs) * k * k, top * 0.6 + k * top * 0.4 - 0.004]);
  }
  prof.push([rf * 0.45 - 0.01, top], [0, top]);
  lathe(b, prof, m, 32, 0, 0, 0, sx, sz);
}

/** A round seat or top of thickness t from y, its edges bevelled; stretched in x/z if asked. */
function disc(b: Builder, r: number, t: number, y: number, m: THREE.Material, bevel = 0.008, seg = 40, sx = 1, sz = 1, z = 0) {
  const e = Math.min(bevel, t / 3);
  for (const [r0, r1, hh, y0] of [[r - e, r, e, y], [r, r, t - 2 * e, y + e], [r, r - e, e, y + t - e]] as const) {
    const g = new THREE.CylinderGeometry(r1, r0, hh, seg);
    if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
    b.add(g, m, 0, y0 + hh / 2, z);
  }
}

/** Point at height y on the line from a to c. */
const along = (a: V3, c: V3, y: number) => a.clone().lerp(c, (y - a.y) / (c.y - a.y));

const isMetal = (accent: string) => ["chrome", "brass", "silver"].includes(accent);

/** A curved rail between two raked posts (from y0 to y1): ends at the posts, the middle bowed back. */
function backRail(b: Builder, x: number, zAt: (y: number) => number, y0: number, y1: number, t: number, bow: number, m: THREE.Material, nu = 10) {
  b.add(
    sheet(
      (u, vv) => {
        const s = 2 * u - 1;
        const y = lerp(y0, y1, vv);
        return V(s * x, y, zAt(y) - bow * (1 - s * s));
      },
      nu,
      1,
      t,
    ),
    m,
  );
}

// ----- the pieces -----

export const BUILDERS: Record<string, Build> = {
  // a modern trestle table: trapezoid frames of square section at both ends, a beam under the top
  dining_table: (b, w, d, h, f, _c, a) => {
    const t = 0.04;
    tableTop(b, w, d, h, t, f);
    const s = 0.025;
    const top = h - t;
    const xe = w / 2 - Math.min(0.25, w * 0.14);
    for (const sx of [-1, 1]) {
      const x = sx * xe;
      const zf = d / 2 - 0.07;
      const zt = d / 2 - 0.2;
      b.box(0.05, 0.03, d - 0.12, x, 0, 0, a, 0.006);
      b.box(0.05, 0.04, 2 * zt + 0.1, x, top - 0.04, 0, a, 0.006);
      for (const sz of [-1, 1]) strut(b, V(x, 0.02, sz * zf), V(x, top - 0.03, sz * zt), s, s, a, true);
      for (const sz of [-1, 1]) b.box(0.05, 0.006, 0.05, x, 0, sz * (d / 2 - 0.08), mat(C.black));
    }
    b.box(2 * xe, 0.05, 0.05, 0, top - 0.06, 0, a, 0.006);
  },
  // a round top on a tulip pedestal
  dining_table_round: (b, w, d, h, f, _c, a) => {
    const r = Math.min(w, d) / 2;
    b.cyl(r, r, 0.022, 0, h - 0.022, 0, f, 64);
    b.cyl(r - 0.003, r - 0.04, 0.014, 0, h - 0.036, 0, f, 64);
    tulip(b, Math.min(0.3, r * 0.55), 0.045, h - 0.036, a);
  },
  // four tapered square legs, an apron between them
  dining_table_legs: (b, w, d, h, f, _c, a) => {
    const t = 0.035;
    tableTop(b, w, d, h, t, f);
    const ins = 0.06;
    const s = 0.035;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * (w / 2 - ins);
        const z = sz * (d / 2 - ins);
        strut(b, V(x - sx * 0.008, 0, z - sz * 0.008), V(x, h - t, z), s * 0.62, s, a, true);
        b.box(0.04, 0.008, 0.04, x - sx * 0.008, 0, z - sz * 0.008, mat(C.black));
      }
    const ah = 0.09;
    const at = 0.022;
    for (const sz of [-1, 1]) b.box(w - 2 * ins, ah, at, 0, h - t - ah, sz * (d / 2 - ins - 0.005), f, 0.003);
    for (const sx of [-1, 1]) b.box(at, ah, d - 2 * ins, sx * (w / 2 - ins - 0.005), h - t - ah, 0, f, 0.003);
  },
  // an oval top on one long tulip foot
  dining_table_oval: (b, w, d, h, f, _c, a) => {
    b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.022, 72).scale(w, 1, d), f, 0, h - 0.011, 0);
    b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.014, 72).scale(w - 0.04, 1, d - 0.05), f, 0, h - 0.029, 0);
    const rf = Math.min(0.3, d * 0.3);
    tulip(b, rf, 0.05, h - 0.036, a, Math.max(1, Math.min(2, (w * 0.32) / rf)), 1);
  },
  // a glass top with green edges on two bent-tube sled frames joined by rails
  dining_table_glass: (b, w, d, h, _f, _c, a) => {
    const t = 0.012;
    b.box(w, t, d, 0, h - t, 0, glass(), 0.003);
    const edge = mat("#8fbfb2", { transparent: true, opacity: 0.55, roughness: 0.1 });
    for (const sz of [-1, 1]) b.box(w - 0.004, t - 0.002, 0.003, 0, h - t + 0.001, sz * (d / 2 - 0.0015), edge);
    for (const sx of [-1, 1]) b.box(0.003, t - 0.002, d - 0.01, sx * (w / 2 - 0.0015), h - t + 0.001, 0, edge);
    const r = 0.014;
    const top = h - t - r - 0.004;
    const zz = d / 2 - 0.1;
    const xe = w / 2 - Math.min(0.2, w * 0.12);
    for (const sx of [-1, 1]) {
      const x = sx * xe;
      const loop = [V(x, r, -zz), V(x, r, zz), V(x, top, zz), V(x, top, -zz)];
      b.add(tube(fillet(loop, 0.06, 5, true), r, 10, true), a);
      for (const sz of [-1, 1]) b.cyl(0.012, 0.012, 0.004, x, h - t - 0.004, sz * (zz - 0.1), mat("#e8eef0", { roughness: 0.3 }), 10);
    }
    for (const sz of [-1, 1]) b.add(tube([V(-xe, top - 0.002, sz * (zz - 0.02)), V(xe, top - 0.002, sz * (zz - 0.02))], 0.01, 8), a);
  },

  // ----- chairs -----

  // a moulded one-piece shell (seat curling up at the sides into the back) on dowel legs with
  // black wire braces; on chrome, the wire "Eiffel" base
  chair_shell: (b, w, d, h, f, _c, a, ac) => {
    const hs = Math.min(0.46, h * 0.57);
    const prof = new THREE.CatmullRomCurve3(
      [V(0, hs - 0.03, d / 2 - 0.004), V(0, hs - 0.004, d / 2 - 0.05), V(0, hs - 0.012, 0.06), V(0, hs, -d / 2 + 0.17), V(0, hs + 0.07, -d / 2 + 0.075), V(0, hs + (h - hs) * 0.45, -d / 2 + 0.03), V(0, h - 0.006, -d / 2 + 0.008)],
      false,
      "centripetal",
    );
    const hw = (vv: number) => curve([[0, 0.4], [0.12, 0.47], [0.38, 0.46], [0.55, 0.39], [0.8, 0.47], [1, 0.49]], vv) * w - 0.006;
    const shell = sheet(
      (u, vv) => {
        const s = 2 * u - 1;
        const p = prof.getPointAt(vv);
        const tg = prof.getTangentAt(vv);
        const up = V(0, -tg.z, tg.y).normalize();
        return p.add(V(s * hw(vv), 0, 0)).addScaledVector(up, 0.06 * Math.pow(Math.abs(s), 2.4));
      },
      14,
      18,
      0.011,
    );
    b.add(shell, f);
    const black = mat(C.black, { roughness: 0.5 });
    const ty = hs - 0.035;
    // shock mounts under the shell
    const top = (sx: number, sz: number) => V(sx * 0.1, ty, 0.02 + sz * 0.11);
    // (each up to the shell's underside there)
    const under = (z: number) => {
      let best = prof.getPointAt(0);
      for (let i = 1; i <= 60; i++) {
        const q = prof.getPointAt(i / 120);
        if (Math.abs(q.z - z) < Math.abs(best.z - z)) best = q;
      }
      return best.y - 0.0065;
    };
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const z = 0.02 + sz * 0.11;
        b.cyl(0.022, 0.022, under(z) - (ty - 0.004), sx * 0.1, ty - 0.004, z, black, 8);
      }
    const foot = (sx: number, sz: number) => V(sx * (w / 2 - 0.035), 0, sz * (d / 2 - 0.04) + 0.01);
    if (ac === "chrome") {
      const wire = a;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(foot(sx, sz), top(sx, sz), 0.007, wire, 6);
      const y = 0.17;
      const pt = (sx: number, sz: number) => along(foot(sx, sz), top(sx, sz), y);
      // crossing wires between the legs on all four sides
      for (const [p, q] of [[[-1, -1], [-1, 1]], [[1, -1], [1, 1]], [[-1, 1], [1, 1]], [[-1, -1], [1, -1]]] as const) {
        b.rod(pt(p[0], p[1]), top(q[0], q[1]), 0.0035, wire, 4);
        b.rod(pt(q[0], q[1]), top(p[0], p[1]), 0.0035, wire, 4);
      }
      for (const sz of [-1, 1]) b.rod(pt(-1, sz), pt(1, sz), 0.004, wire, 4);
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) strut(b, foot(sx, sz), top(sx, sz), 0.011, 0.016, a, false, 10);
      const y = 0.16;
      const pt = (sx: number, sz: number) => along(foot(sx, sz), top(sx, sz), y);
      for (const sx of [-1, 1]) b.rod(pt(sx, -1), pt(sx, 1), 0.004, black, 4);
      b.rod(pt(-1, -1).lerp(pt(-1, 1), 0.5), pt(1, -1).lerp(pt(1, 1), 0.5), 0.004, black, 4);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod(along(foot(sx, sz), top(sx, sz), hs - 0.12), V(0, ty - 0.012, 0.02 + sz * 0.11), 0.004, black, 4);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.011, 0.011, 0.006, foot(sx, sz).x, 0, foot(sx, sz).z, black, 8);
    }
  },
  // a classic wooden dining chair: tapered square legs, an apron, raked back posts with a
  // curved top rail and a lower rail, stretchers
  chair_wood: (b, w, d, h, f) => woodChair(b, w, d, h, f, null),
  // the same with arms on raised front legs, slats in the back and an upholstered seat
  chair_arm_wood: (b, w, d, h, f, _c, a) => woodChair(b, w, d, h, f, a),
  // a round dished seat on four splayed legs with a foot ring
  bar_stool: (b, w, d, h, f, _c, a, ac) => {
    const r = Math.min(w, d) * 0.45;
    const seatT = 0.045;
    const ys = h - seatT;
    disc(b, r, seatT, ys, f, 0.012, 36);
    const metal = isMetal(ac) || ac === "black";
    b.cyl(r * 0.45, r * 0.45, 0.02, 0, ys - 0.02, 0, metal ? a : mat(C.black), 24);
    const leg = (i: number) => {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const R = Math.min(w, d) / 2 - 0.02;
      return [V(Math.cos(ang) * R, 0, Math.sin(ang) * R), V(Math.cos(ang) * r * 0.42, ys - 0.02, Math.sin(ang) * r * 0.42)];
    };
    for (let i = 0; i < 4; i++) {
      const [lo, hi] = leg(i);
      strut(b, lo, hi, 0.011, 0.014, a, false, 10);
      b.cyl(0.013, 0.013, 0.008, lo.x, 0, lo.z, mat(C.black), 10);
    }
    const yr = h * 0.33;
    const p = along(leg(0)[0], leg(0)[1], yr);
    b.add(new THREE.TorusGeometry(Math.hypot(p.x, p.z), 0.009, 8, 40), a, 0, yr, 0).rotation.x = Math.PI / 2;
  },
  // an upholstered seat and curved back on four legs (the back pair rising into the back), foot rails
  bar_stool_back: (b, w, d, h, f, _c, a, ac) => {
    const hs = h * 0.68;
    const square = !isMetal(ac) && ac !== "black";
    const r = square ? 0.014 : 0.011;
    const fx = w / 2 - 0.035;
    const fz = d / 2 - 0.035;
    const tx = w / 2 - 0.07;
    const tz = d / 2 - 0.07;
    const legs: [V3, V3][] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const lo = V(sx * fx, 0, sz * fz);
        const hi = V(sx * tx, hs - 0.02, sz * tz);
        legs.push([lo, hi]);
        strut(b, lo, hi, r, r, a, square);
        b.cyl(r + 0.002, r + 0.002, 0.008, lo.x, 0, lo.z, mat(C.black), 10);
      }
    // back posts from the seat up the back
    const zAt = (y: number) => -tz + 0.005 - (y - hs) * 0.12;
    for (const sx of [-1, 1]) strut(b, V(sx * tx, hs - 0.03, -tz), V(sx * tx, h - 0.06, zAt(h - 0.06)), r, r * 0.9, a, square);
    // foot rail at the front, side and back rails a little higher
    const yf = hs * 0.36;
    const P = (i: number, y: number) => along(legs[i][0], legs[i][1], y);
    strut(b, P(1, yf), P(3, yf), 0.01, 0.01, a, square);
    for (const [i, j] of [[0, 1], [2, 3]]) strut(b, P(i, yf + 0.06), P(j, yf + 0.06), 0.008, 0.008, a, square);
    strut(b, P(0, yf + 0.12), P(2, yf + 0.12), 0.008, 0.008, a, square);
    // seat frame and cushion
    b.box(2 * tx + 0.02, 0.02, 2 * tz + 0.02, 0, hs - 0.03, 0, a, 0.004);
    b.add(sheet((u, vv) => V((u - 0.5) * (w - 0.04), hs + 0.02, lerp(-d / 2 + 0.05, d / 2 - 0.01, vv)), 8, 8, puff(0.02, 0.065)), f);
    // curved back cushion
    b.add(
      sheet(
        (u, vv) => {
          const s = 2 * u - 1;
          const y = lerp(hs + 0.12, h - 0.01, vv);
          return V(s * (w / 2 - 0.03), y, zAt(y) + 0.025 + 0.05 * s * s);
        },
        10,
        6,
        puff(0.018, 0.05),
      ),
      f,
    );
  },
  // a tub chair: one upholstered wall round the back and sides (lower at the arms), a piped
  // top edge, a loose seat cushion, tapered legs
  dining_armchair: (b, w, d, h, f, _c, a, ac) => {
    const hs = 0.46;
    const rx = w / 2 - 0.035;
    const rz = d / 2 - 0.035;
    const span = Math.PI * 0.62;
    const yb = hs - 0.1;
    const topAt = (s: number) => lerp(h - 0.035, Math.min(0.66, h - 0.1), Math.pow(Math.abs(s), 2.2));
    const at = (s: number, y: number, k = 1) => V(Math.sin(s * span) * rx * k, y, -Math.cos(s * span) * rz * k);
    b.add(
      sheet(
        (u, vv) => {
          const s = 2 * u - 1;
          return at(s, lerp(yb, topAt(s), vv), 1 - 0.03 * vv);
        },
        28,
        4,
        (_u, vv) => 0.055 - 0.01 * vv,
      ),
      f,
    );
    const edge: V3[] = [];
    for (let i = 0; i <= 28; i++) {
      const s = (i / 28) * 2 - 1;
      edge.push(at(s, topAt(s), 0.97));
    }
    const lo = (s: number) => at(s, yb + 0.03, 0.97);
    b.add(tube(fillet([lo(-1), ...edge, lo(1)], 0.04, 4), 0.029, 10), f);
    // the base under the seat and the cushion on it
    b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 40).scale((rx - 0.02) * 2, 1, (rz - 0.02) * 2), f, 0, yb + 0.04, 0);
    const cr = rz - 0.03;
    const ct = 0.075;
    disc(b, cr, ct, hs - 0.03, f, 0.022, 32, (rx - 0.07) / cr, 1, 0.035);
    const square = !isMetal(ac) && ac !== "black";
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const top = V(sx * rx * 0.62, yb, sz * rz * 0.62);
        const lo = V(sx * (rx - 0.01), 0, sz * (rz - 0.01));
        strut(b, lo, top, square ? 0.011 : 0.009, square ? 0.018 : 0.014, a, false, 10);
      }
  },
  // the cantilever: one bent steel tube for both sides (runners on the floor joined at the
  // back), padded seat and back
  chair_cantilever: (b, w, d, h, f, _c, a) => {
    const hs = Math.min(0.46, h * 0.56);
    const r = 0.011;
    const x = w / 2 - 0.025;
    const zb = -d / 2 + 0.05;
    const side = (sx: number) => [
      V(sx * x, h - 0.07, zb - 0.025),
      V(sx * x, hs + 0.03, zb + 0.015),
      V(sx * x, hs - 0.035, zb + 0.06),
      V(sx * x, hs - 0.035, d / 2 - 0.09),
      V(sx * (x + 0.002), hs * 0.55, d / 2 - 0.02),
      V(sx * (x + 0.004), r, d / 2 - 0.035),
      V(sx * (x + 0.004), r, -d / 2 + r + 0.01),
    ];
    b.add(tube(fillet([...side(-1), ...side(1).reverse()], 0.055, 6), r, 8), a);
    // seat pad
    b.add(sheet((u, vv) => V((u - 0.5) * (w - 0.04), hs - 0.012 - 0.03 * Math.pow(vv, 8), lerp(zb + 0.035, d / 2 - 0.02, vv)), 8, 8, puff(0.015, 0.05)), f);
    // back pad following the raked posts, slightly curved
    const zAt = (y: number) => lerp(zb + 0.015, zb - 0.025, (y - (hs + 0.03)) / (h - 0.07 - hs - 0.03));
    b.add(
      sheet(
        (u, vv) => {
          const s = 2 * u - 1;
          const y = lerp(hs + 0.16, h - 0.005, vv);
          return V(s * (w / 2 - 0.012), y, zAt(y) + 0.03 * s * s - 0.008);
        },
        10,
        6,
        puff(0.018, 0.048),
      ),
      f,
    );
  },
  // an upholstered dining chair: a plump seat, a tall softly curved back, tapered legs (the
  // back pair raked)
  chair_upholstered: (b, w, d, h, f, _c, a) => {
    const hs = Math.min(0.48, h * 0.55);
    const zf = d / 2 - 0.05;
    const zb = -d / 2 + 0.07;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.05);
      strut(b, V(x, 0, zf + 0.01), V(x, hs - 0.09, zf - 0.01), 0.011, 0.017, a, false, 10);
      strut(b, V(x * 1.02, 0, -d / 2 + 0.025), V(x, hs - 0.09, zb), 0.011, 0.017, a, false, 10);
    }
    // seat: a fabric-covered frame and a cushion on it
    b.box(w - 0.01, 0.1, d - 0.075, 0, hs - 0.1, 0.0225, f, 0.035);
    // the back, raked and curved, its rim rounded by a welt
    const zAt = (y: number) => -d / 2 + 0.065 - (y - hs) * 0.16;
    const backAt = (u: number, vv: number) => {
      const s = 2 * u - 1;
      const y = lerp(hs - 0.06, h - 0.018, vv) - 0.03 * s * s * vv * vv;
      return V(s * (w / 2 - 0.018) * (0.94 + 0.06 * vv), y, zAt(y) + 0.035 * s * s);
    };
    b.add(sheet(backAt, 12, 8, (u, vv) => 0.03 + 0.035 * Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, vv * 1.2 + 0.1)), 0.35)), f);
    const rim: V3[] = [];
    for (let i = 0; i <= 4; i++) rim.push(backAt(0, 0.12 + (0.88 * i) / 4));
    for (let i = 1; i < 12; i++) rim.push(backAt(i / 12, 1));
    for (let i = 4; i >= 0; i--) rim.push(backAt(1, 0.12 + (0.88 * i) / 4));
    b.add(tube(fillet(rim, 0.03, 3), 0.016, 8), f);
  },
  // the Windsor: a saddle seat, splayed legs with an H stretcher, a bow over spindles
  chair_spindle: (b, w, d, h, f) => {
    const hs = Math.min(0.45, h * 0.5);
    const st = 0.04;
    // the saddle seat: a D shape with a bevelled edge
    const sw = w / 2 - 0.01;
    const sd = d - 0.03;
    const shape = new THREE.Shape();
    shape.moveTo(-sw * 0.9, -sd / 2);
    shape.quadraticCurveTo(0, -sd / 2 - 0.03, sw * 0.9, -sd / 2);
    shape.quadraticCurveTo(sw, -sd / 2, sw, -sd / 2 + 0.08);
    shape.bezierCurveTo(sw, sd * 0.25, sw * 0.7, sd / 2, 0, sd / 2);
    shape.bezierCurveTo(-sw * 0.7, sd / 2, -sw, sd * 0.25, -sw, -sd / 2 + 0.08);
    shape.quadraticCurveTo(-sw, -sd / 2, -sw * 0.9, -sd / 2);
    const seat = new THREE.ExtrudeGeometry(shape, { depth: st - 0.016, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 8 });
    seat.rotateX(Math.PI / 2);
    const zSeat = 0.015;
    b.add(seat, f, 0, hs - 0.008, zSeat);
    // legs splay out from under the seat, a turned ring on each
    const legs: [V3, V3][] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const hi = V(sx * sw * 0.62, hs - st, zSeat + sz * sd * 0.3);
        const lo = V(sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.035) + 0.01);
        legs.push([lo, hi]);
        strut(b, lo, hi, 0.012, 0.018, f, false, 10);
        const ring = along(lo, hi, hs * 0.55);
        b.sphere(0.02, ring.x, ring.y, ring.z, f, 1, 0.55, 1, 10);
      }
    const p = (i: number) => along(legs[i][0], legs[i][1], 0.17);
    strut(b, p(0), p(1), 0.011, 0.011, f, false, 8);
    strut(b, p(2), p(3), 0.011, 0.011, f, false, 8);
    strut(b, p(0).lerp(p(1), 0.5), p(2).lerp(p(3), 0.5), 0.01, 0.01, f, false, 8);
    // the bow: an arch from the seat's back corners over the top, raked back
    const rb = sw * 0.82;
    const z0 = -sd / 2 + zSeat + 0.04;
    const bowAt = (k: number) => {
      const ang = (k - 0.5) * Math.PI;
      const x = Math.sign(Math.sin(ang)) * Math.pow(Math.abs(Math.sin(ang)), 0.75) * rb * (1 + 0.12 * Math.cos(ang));
      const y = hs + (h - 0.012 - hs) * Math.pow(Math.cos(ang), 0.55);
      return V(x, y, z0 - (y - hs) * 0.12 + 0.04 * Math.pow(Math.sin(ang), 2));
    };
    const bow: V3[] = [];
    for (let i = 0; i <= 24; i++) bow.push(bowAt(i / 24));
    b.add(tube(bow, 0.013, 8), f);
    // spindles from the seat's back up to the bow
    const n = 7;
    for (let i = 0; i < n; i++) {
      const k = 0.5 + ((i - (n - 1) / 2) / (n - 1)) * 0.62;
      const top = bowAt(k);
      const bot = V(top.x * 0.92, hs, z0 + 0.04 * Math.pow(top.x / rb, 2) + 0.012);
      strut(b, bot, top, 0.0075, 0.006, f, false, 6);
    }
  },
  // the wishbone: a steam-bent bow as back and arms, the Y-shaped back splat, curving back
  // legs, a woven paper cord seat
  chair_wishbone: (b, w, d, h, f) => {
    const hs = Math.min(0.44, h * 0.58);
    const cord = mat("#d6c094", { roughness: 1 });
    const cordDark = mat("#b89f70", { roughness: 1 });
    const fx = w / 2 - 0.05;
    const fz = d / 2 - 0.04;
    const bx = w / 2 - 0.07;
    const bz = -d / 2 + 0.07;
    // the bow: half an ellipse round the back, its ends a little forward as armrests
    const r = w / 2 - 0.03;
    const deep = Math.min(0.26, d * 0.5);
    const cz = -d / 2 + 0.012 + deep;
    const yb = h - 0.028;
    const bowAt = (k: number) => {
      const ang = (k - 0.5) * Math.PI;
      return V(Math.sin(ang) * r, yb, cz - Math.cos(ang) * deep);
    };
    b.add(sheet((u, vv) => bowAt(u).setY(yb - 0.022 + vv * 0.044 - 0.006 * Math.pow(2 * u - 1, 2)), 26, 1, (u) => 0.02 - 0.006 * Math.pow(2 * u - 1, 2)), f);
    // front legs, straight and tapered
    for (const sx of [-1, 1]) strut(b, V(sx * fx, 0, fz), V(sx * (fx - 0.005), hs, fz - 0.005), 0.014, 0.017, f, false, 10);
    // back legs: from the floor up past the seat, bending forward under the bow's ends
    for (const sx of [-1, 1]) {
      const end = bowAt(sx < 0 ? 0.17 : 0.83);
      const pts = fillet([V(sx * (w / 2 - 0.05), 0, -d / 2 + 0.035), V(sx * bx, hs, bz), V(sx * (bx - 0.005), hs + 0.12, bz - 0.015), V(end.x, end.y - 0.02, end.z)], 0.08, 6);
      b.add(tube(pts, (s) => lerp(0.014, 0.017, Math.sin(Math.PI * Math.min(1, s * 1.5))), 8), f);
    }
    // seat rails and the woven seat, its cords meeting at the middle
    const ry = hs - 0.045;
    b.box(2 * fx, 0.03, 0.022, 0, ry, fz - 0.005, f, 0.004);
    b.box(2 * bx, 0.03, 0.022, 0, ry, bz, f, 0.004);
    for (const sx of [-1, 1]) b.rod(V(sx * fx, ry + 0.015, fz), V(sx * bx, ry + 0.015, bz), 0.013, f, 8);
    const seat = new THREE.Shape([new THREE.Vector2(-fx - 0.012, -fz - 0.012), new THREE.Vector2(fx + 0.012, -fz - 0.012), new THREE.Vector2(bx + 0.012, -bz + 0.01), new THREE.Vector2(-bx - 0.012, -bz + 0.01)]);
    const sg = new THREE.ExtrudeGeometry(seat, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 1 });
    sg.rotateX(-Math.PI / 2);
    b.add(sg, cord, 0, hs - 0.032, 0);
    const yy = hs + 0.0012;
    for (const [p, q] of [[V(-fx, yy, fz), V(bx, yy, bz)], [V(fx, yy, fz), V(-bx, yy, bz)]]) b.rod(p, q, 0.0045, cordDark, 4);
    // stretchers: low on the sides, higher at the front and back
    for (const sx of [-1, 1]) strut(b, V(sx * (fx + 0.002), 0.14, fz - 0.01), V(sx * (bx + 0.012), 0.14, bz + 0.012), 0.009, 0.009, f, false, 8);
    strut(b, V(-fx, 0.21, fz - 0.003), V(fx, 0.21, fz - 0.003), 0.009, 0.009, f, false, 8);
    strut(b, V(-bx - 0.01, 0.24, bz + 0.004), V(bx + 0.01, 0.24, bz + 0.004), 0.009, 0.009, f, false, 8);
    // the Y: a flat splat from the back rail forking up to the bow
    const y0 = hs - 0.02;
    const yt = yb - 0.02 - y0;
    const ys = new THREE.Shape();
    ys.moveTo(-0.022, 0);
    ys.lineTo(0.022, 0);
    ys.lineTo(0.022, yt * 0.38);
    ys.quadraticCurveTo(0.03, yt * 0.62, 0.105, yt);
    ys.lineTo(0.06, yt);
    ys.quadraticCurveTo(0.012, yt * 0.62, 0, yt * 0.5);
    ys.quadraticCurveTo(-0.012, yt * 0.62, -0.06, yt);
    ys.lineTo(-0.105, yt);
    ys.quadraticCurveTo(-0.03, yt * 0.62, -0.022, yt * 0.38);
    ys.lineTo(-0.022, 0);
    const yg = new THREE.ExtrudeGeometry(ys, { depth: 0.016, bevelEnabled: false, curveSegments: 6 });
    yg.translate(0, 0, -0.008);
    const z1 = bowAt(0.5).z + 0.004;
    const splat = b.add(yg, f, 0, y0, bz - 0.005);
    splat.rotation.x = Math.atan2(z1 - (bz - 0.005), yt);
  },
  // the slatted folding chair: tube frames crossing under the seat, wooden slats
  chair_folding: (b, w, d, h, f, _c, a) => {
    const hs = Math.min(0.45, h * 0.56);
    const r = 0.011;
    const ox = w / 2 - r;
    const ix = ox - 2 * r - 0.003;
    // outer frame: front feet up past the seat's back into the backrest, joined at the top
    const foot = V(0, r, d / 2 - 0.03);
    const pivot = V(0, hs - 0.05, -d / 2 + 0.11);
    const top = V(0, h - 0.06, -d / 2 + 0.03);
    const outer = (sx: number) => [foot.clone().setX(sx * ox), pivot.clone().setX(sx * ox), top.clone().setX(sx * ox)];
    b.add(tube(fillet([...outer(-1), ...outer(1).reverse()], 0.05, 5), r, 8), a);
    // inner frame: back feet up to the seat's front, joined by a bar near the floor
    const bf = V(0, r, -d / 2 + 0.03);
    const sf = V(0, hs - 0.02, d / 2 - 0.08);
    for (const sx of [-1, 1]) b.add(tube([bf.clone().setX(sx * ix), sf.clone().setX(sx * ix)], r, 8), a);
    const low = along(bf, sf, 0.09);
    b.add(tube([low.clone().setX(-ix), low.clone().setX(ix)], r * 0.8, 8), a);
    // seat rails from the front of the inner frame back to the pivot, and the slats on them
    for (const sx of [-1, 1]) b.add(tube([V(sx * ix, hs - 0.02, d / 2 - 0.08), V(sx * ix, hs - 0.04, -d / 2 + 0.11)], r * 0.85, 8), a);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n;
      const z = lerp(d / 2 - 0.04, -d / 2 + 0.11, k);
      b.box(2 * ix + 0.03, 0.016, (d - 0.15) / n - 0.012, 0, lerp(hs - 0.02, hs - 0.04, k) + r * 0.8, z, f, 0.005);
    }
    // rivets where the frames cross
    const cross = along(foot, pivot, hs * 0.5);
    for (const sx of [-1, 1]) b.cyl(0.008, 0.008, 0.008, sx * (ox + r), cross.y, cross.z, mat(C.steel, { metalness: 0.7, roughness: 0.3 }), 10).rotation.z = Math.PI / 2;
    // backrest slats across the raked top of the outer frame
    const ang = Math.atan2(top.z - pivot.z, top.y - pivot.y);
    for (const [k, hh] of [[0.55, 0.06], [0.85, 0.08]] as const) {
      const p = pivot.clone().lerp(top, k);
      b.add(sheet((u, vv) => V((u - 0.5) * (2 * ox + 0.006), p.y + (vv - 0.5) * hh * Math.cos(ang), p.z + r + 0.008 + (vv - 0.5) * hh * Math.sin(ang) + 0.012 * Math.pow(2 * u - 1, 2)), 8, 1, 0.014), f);
    }
    for (const sx of [-1, 1]) for (const [p, x] of [[foot, ox], [bf, ix]] as const) b.sphere(r * 1.25, sx * x, r * 0.6, p.z, mat(C.black), 1, 0.6, 1, 8);
  },
  // a round stool: a thick seat with a rounded edge, four splayed tapered legs, a ring of rungs
  stool_wood: (b, w, d, h, f) => {
    const r = Math.min(w, d) / 2;
    const t = 0.035;
    disc(b, r, t, h - t, f, 0.01, 32);
    const legs: [V3, V3][] = [];
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const lo = V(Math.cos(ang) * (r - 0.02), 0, Math.sin(ang) * (r - 0.02));
      const hi = V(Math.cos(ang) * r * 0.58, h - t, Math.sin(ang) * r * 0.58);
      legs.push([lo, hi]);
      strut(b, lo, hi, 0.013, 0.017, f, false, 10);
    }
    for (let i = 0; i < 4; i++) {
      const y = i % 2 ? h * 0.32 : h * 0.4;
      strut(b, along(legs[i][0], legs[i][1], y), along(legs[(i + 1) % 4][0], legs[(i + 1) % 4][1], y), 0.008, 0.008, f, false, 8);
    }
  },
  // a bench on two A-shaped trestles joined by a stretcher
  dining_bench: (b, w, d, h, f) => {
    const t = 0.04;
    b.box(w, t, d, 0, h - t, 0, f, 0.01);
    const s = 0.022;
    const xe = w / 2 - Math.min(0.16, w * 0.1);
    for (const sx of [-1, 1]) {
      const x = sx * xe;
      for (const sz of [-1, 1]) strut(b, V(x, 0, sz * (d / 2 - 0.03)), V(x, h - t, sz * (d / 2 - 0.09)), s * 0.85, s, f, true);
      b.box(0.044, 0.05, d - 0.12, x, h - t - 0.05, 0, f, 0.004);
      b.box(0.04, 0.035, d - 0.1, x, 0.12, 0, f, 0.004);
    }
    b.box(2 * xe, 0.04, 0.03, 0, 0.1, 0, f, 0.004);
    for (const sz of [-1, 1]) b.box(2 * xe - 0.04, 0.05, 0.018, 0, h - t - 0.05, sz * (d / 2 - 0.1), f, 0.003);
  },
};

/** Classic wooden chair; with `cushion` (the arm chair): arms on raised front legs, back slats, an upholstered seat. */
function woodChair(b: Builder, w: number, d: number, h: number, f: THREE.Material, cushion: THREE.Material | null) {
  const arms = cushion !== null;
  const hs = Math.min(0.46, h * 0.57);
  const t = 0.022;
  const lx = w / 2 - (arms ? 0.045 : 0.022);
  const zf = d / 2 - 0.03;
  const zb = -d / 2 + 0.04;
  const zt = -d / 2 + 0.018;
  const s = 0.018;
  const zPost = (y: number) => lerp(zb, zt, (y - hs) / (h - hs));
  for (const sx of [-1, 1]) {
    const x = sx * lx;
    strut(b, V(x, 0, zf), V(x, hs - t, zf), s * 0.7, s, f, true);
    strut(b, V(x, 0, zb + 0.012), V(x, hs, zb), s * 0.75, s, f, true);
    strut(b, V(x, hs - 0.005, zb), V(x, h, zt), s, s * 0.8, f, true);
  }
  // apron and seat
  const ah = 0.06;
  b.box(2 * lx, ah, 0.02, 0, hs - t - ah, zf - 0.006, f, 0.003);
  b.box(2 * lx, ah, 0.02, 0, hs - t - ah, zb + 0.004, f, 0.003);
  for (const sx of [-1, 1]) b.box(0.02, ah, zf - zb, sx * (lx - 0.004), hs - t - ah, (zf + zb) / 2, f, 0.003);
  if (cushion) {
    b.box(2 * lx + 0.03, t, zf - zb + 0.03, 0, hs - t, (zf + zb) / 2 + 0.005, f, 0.006);
    b.add(sheet((u, vv) => V((u - 0.5) * (2 * lx - 0.01), hs - 0.004, lerp(zb + 0.025, zf + 0.008, vv)), 8, 8, puff(0.018, 0.06)), cushion);
  } else b.box(w, t, zf - zb + 0.05, 0, hs - t, (zf + zb) / 2 + 0.012, f, 0.008);
  // stretchers
  for (const sx of [-1, 1]) strut(b, V(sx * (lx - 0.002), 0.15, zf), V(sx * (lx - 0.002), 0.15, zb + 0.008), 0.009, 0.009, f, true);
  strut(b, V(-lx, 0.2, zf), V(lx, 0.2, zf), 0.008, 0.008, f, true);
  // back: a curved top rail and a lower rail; the arm chair adds three slats between them
  const bow = 0.02;
  const yt0 = h - (arms ? 0.12 : 0.11);
  backRail(b, lx, zPost, yt0, h - 0.012, 0.018, bow, f);
  const yl1 = hs + (arms ? 0.14 : 0.2);
  backRail(b, lx, zPost, yl1 - 0.04, yl1, 0.016, bow, f);
  if (arms) {
    for (const sx of [-0.45, 0, 0.45]) {
      const zOff = -bow * (1 - sx * sx);
      strut(b, V(sx * lx, yl1 - 0.005, zPost(yl1) + zOff), V(sx * lx, yt0 + 0.005, zPost(yt0) + zOff), 0.012, 0.012, f, true);
    }
    // front posts up to the arms, arms from the back posts forward
    const ya = hs + 0.21;
    for (const sx of [-1, 1]) {
      const x = sx * lx;
      strut(b, V(x, hs - 0.01, zf), V(x, ya, zf - 0.03), s, s * 0.75, f, true);
      b.add(sheet((u, vv) => V(x + (u - 0.5) * 0.05, ya + 0.012 * Math.sin(Math.PI * vv), lerp(zPost(ya), zf + 0.015, vv)), 2, 8, 0.024), f);
    }
  }
}
