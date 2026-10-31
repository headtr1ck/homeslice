// Robot vacuums and lawn mowers: their status and, where Home Assistant knows it, their
// position on the plan.

import type { Robot, Vec2 } from "../model/types";
import type { Hass } from "./hass";

export type RobotStatus = "active" | "returning" | "docked" | "paused" | "error" | "idle" | "unknown";

/** HA's vacuum and lawn_mower states, grouped. */
export function robotStatus(state: string | undefined): RobotStatus {
  switch (state) {
    case "cleaning":
    case "mowing":
      return "active";
    case "returning":
      return "returning";
    case "docked":
    case "charging":
      return "docked";
    case "paused":
      return "paused";
    case "error":
      return "error";
    case "idle":
      return "idle";
    default:
      return "unknown";
  }
}

/** The robot's own position reading: map units, or [latitude, longitude]. */
export function rawPosition(hass: Hass, position: NonNullable<Robot["position"]>): { at: Vec2; gps: boolean } | null {
  const s = hass.states[position.entity];
  if (!s) return null;
  if (position.attribute) {
    const v = s.attributes[position.attribute] as unknown;
    if (Array.isArray(v) && v.length >= 2 && v.every((n) => typeof n === "number")) return { at: [v[0], v[1]], gps: false };
    if (v && typeof v === "object" && typeof (v as { x?: unknown }).x === "number" && typeof (v as { y?: unknown }).y === "number")
      return { at: [(v as { x: number }).x, (v as { y: number }).y], gps: false };
    return null;
  }
  const lat = s.attributes.latitude;
  const lon = s.attributes.longitude;
  return typeof lat === "number" && typeof lon === "number" ? { at: [lat, lon], gps: true } : null;
}

/** Latitude/longitude as metres east and south of a reference point. */
export function gpsToMetres([lat, lon]: Vec2, [lat0, lon0]: Vec2): Vec2 {
  return [(lon - lon0) * Math.cos((lat0 * Math.PI) / 180) * 111320, -(lat - lat0) * 110574];
}

/**
 * Plan position from a reading and calibration points (reading → plan). Two points fix
 * position, rotation and scale; three or more also a mirrored map.
 */
export function readingToPlan(at: Vec2, points: [Vec2, Vec2][], gps: boolean): Vec2 | null {
  if (points.length < 2) return null;
  const ref = points[0][0];
  const local = (p: Vec2): Vec2 => (gps ? gpsToMetres(p, ref) : p);
  const src = points.map(([a]) => local(a));
  const dst = points.map(([, b]) => b);
  const p = local(at);
  if (points.length >= 3) {
    // affine through the first three points
    const [[x1, y1], [x2, y2], [x3, y3]] = src;
    const det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    if (Math.abs(det) > 1e-9) {
      const u = ((p[0] - x1) * (y3 - y1) - (x3 - x1) * (p[1] - y1)) / det;
      const v = ((x2 - x1) * (p[1] - y1) - (p[0] - x1) * (y2 - y1)) / det;
      return [dst[0][0] + u * (dst[1][0] - dst[0][0]) + v * (dst[2][0] - dst[0][0]), dst[0][1] + u * (dst[1][1] - dst[0][1]) + v * (dst[2][1] - dst[0][1])];
    }
  }
  // similarity: complex numbers, z = d1 + (p − s1)·(d2 − d1)/(s2 − s1)
  const [s1, s2] = src;
  const [d1, d2] = dst;
  const sx = s2[0] - s1[0];
  const sy = s2[1] - s1[1];
  const den = sx * sx + sy * sy;
  if (den < 1e-12) return null;
  const dx = d2[0] - d1[0];
  const dy = d2[1] - d1[1];
  const kr = (dx * sx + dy * sy) / den;
  const ki = (dy * sx - dx * sy) / den;
  const px = p[0] - s1[0];
  const py = p[1] - s1[1];
  return [d1[0] + px * kr - py * ki, d1[1] + px * ki + py * kr];
}

export interface RobotReading {
  status: RobotStatus;
  /** HA's state, as it says it. */
  state: string;
  battery: number | null;
  /** Where it is on the plan: live, or at the dock while docked; null when unknown. */
  at: Vec2 | null;
  live: boolean;
}

export function readRobot(hass: Hass, robot: Robot): RobotReading {
  const s = hass.states[robot.entity];
  const status = robotStatus(s?.state);
  const b = s?.attributes.battery_level ?? s?.attributes.battery;
  const battery = typeof b === "number" ? b : typeof b === "string" && b !== "" && !isNaN(Number(b)) ? Number(b) : null;
  const raw = robot.position ? rawPosition(hass, robot.position) : null;
  const live = raw && robot.position ? readingToPlan(raw.at, robot.position.points, raw.gps) : null;
  // without a live position: at the dock while docked, otherwise somewhere unknown
  const at = live ?? (status === "docked" || status === "unknown" || status === "idle" ? robot.dock : null);
  return { status, state: s?.state ?? "unknown", battery, at, live: !!live };
}
