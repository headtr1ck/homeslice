// Weather around the house: rain as falling streaks, snow as drifting flakes, fog as haze.
// Only drawn while it is that weather; nothing runs otherwise.

import * as THREE from "three";

export type WeatherKind = "rain" | "snow" | "fog";

/** The weather entity's condition as what to draw, and how much (0…1). */
export function weatherEffect(condition: string | undefined): { kind: WeatherKind; amount: number } | null {
  switch (condition) {
    case "pouring":
      return { kind: "rain", amount: 1 };
    case "rainy":
    case "lightning-rainy":
    case "hail":
      return { kind: "rain", amount: 0.55 };
    case "snowy":
      return { kind: "snow", amount: 0.8 };
    case "snowy-rainy":
      return { kind: "snow", amount: 0.5 };
    case "fog":
      return { kind: "fog", amount: 1 };
    default:
      return null;
  }
}

export class Weather {
  readonly object = new THREE.Group();
  kind: WeatherKind | null = null;
  private box = new THREE.Box3();
  private drops: THREE.LineSegments | THREE.Points | null = null;
  private speeds: Float32Array = new Float32Array();
  private last = 0;
  /** How many drops at most (fewer on weak devices). */
  constructor(private readonly max = 1600) {}

  /** Starts (or stops, null) the weather around the box (the house in world coordinates). */
  set(effect: { kind: WeatherKind; amount: number } | null, box: THREE.Box3, scene: THREE.Scene) {
    const kind = effect?.kind ?? null;
    scene.fog = kind === "fog" ? new THREE.Fog("#c9ced3", box.getSize(new THREE.Vector3()).length() * 0.6, box.getSize(new THREE.Vector3()).length() * 2.2) : null;
    if (kind === this.kind && this.box.equals(box)) return;
    this.kind = kind;
    this.box = box.clone().expandByVector(new THREE.Vector3(3, 2, 3));
    this.clear();
    if (kind !== "rain" && kind !== "snow") return;
    const n = Math.round(this.max * (effect?.amount ?? 0.5) * (kind === "snow" ? 0.6 : 1));
    const size = this.box.getSize(new THREE.Vector3());
    const at = () => [this.box.min.x + Math.random() * size.x, this.box.min.y + Math.random() * size.y, this.box.min.z + Math.random() * size.z];
    this.speeds = new Float32Array(n).map(() => (kind === "rain" ? 7 + Math.random() * 3 : 0.6 + Math.random() * 0.5));
    if (kind === "rain") {
      // streaks: two points each, the lower one ahead
      const pos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const [x, y, z] = at();
        pos.set([x, y, z, x + 0.02, y + 0.28, z], i * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.drops = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: "#a9c2db", transparent: true, opacity: 0.55, depthWrite: false }));
    } else {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set(at(), i * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.drops = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#ffffff", size: 0.07, transparent: true, opacity: 0.9, depthWrite: false }));
    }
    this.drops.frustumCulled = false;
    this.object.add(this.drops);
  }

  get falling() {
    return !!this.drops;
  }

  /** Moves the drops on (they come back in at the top). */
  step(now: number) {
    const dt = this.last && now - this.last < 500 ? (now - this.last) / 1000 : 1 / 30;
    this.last = now;
    if (!this.drops) return;
    const pos = this.drops.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const per = this.kind === "rain" ? 2 : 1;
    const height = this.box.max.y - this.box.min.y;
    for (let i = 0; i < this.speeds.length; i++) {
      const fall = this.speeds[i] * dt;
      // flakes drift a little
      const drift = this.kind === "snow" ? Math.sin(now / 900 + i) * 0.15 * dt : 0;
      let y = a[i * per * 3 + 1] - fall;
      const wrap = y < this.box.min.y ? height : 0;
      for (let k = 0; k < per; k++) {
        a[(i * per + k) * 3 + 1] += wrap - fall;
        a[(i * per + k) * 3] += drift;
      }
      y += wrap;
    }
    pos.needsUpdate = true;
  }

  private clear() {
    if (!this.drops) return;
    this.object.remove(this.drops);
    this.drops.geometry.dispose();
    (this.drops.material as THREE.Material).dispose();
    this.drops = null;
  }

  dispose() {
    this.clear();
  }
}
