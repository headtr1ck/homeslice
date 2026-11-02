// The demo's robots drive a fixed tour: from the dock through the rooms of their floor (a
// vacuum the rooms, a mower the garden), back to the dock, a rest, and again. Their position
// is a pretend attribute in plan metres, so the card shows them live like a real one.

const STEP_MS = 1000;
const SPEED = 0.3; // metres a second, the card's own pace for a robot
const REST_MS = 8000;
const INSET = 0.6;

/** A room's corners (rect or polygon, plain numbers). */
function corners(room) {
  if (room.polygon) return room.polygon;
  const [x, y, w, d] = room.rect;
  return [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
}

/** A lap inside a room: round its bounding box, kept clear of the walls. */
function lap(room) {
  const pts = corners(room);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs) + INSET, Math.max(...xs) - INSET];
  const [y0, y1] = [Math.min(...ys) + INSET, Math.max(...ys) - INSET];
  if (x1 <= x0 || y1 <= y0) return [];
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

/** Points every `step` metres along a path. */
function along(path, step) {
  const out = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(path.at(-1));
  return out.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

/** Gives every robot of the house a position the tour can set (plan metres, no calibration needed). */
export function prepareRobots(fixture) {
  for (const r of fixture.model?.robots ?? []) {
    r.position = { attribute: "demo_position", points: [[[0, 0], [0, 0]], [[1, 0], [1, 0]]] };
  }
}

/** Starts the tours; returns a function that stops them. */
export function startTours(fixture, setState) {
  const timers = [];
  for (const robot of fixture.model?.robots ?? []) {
    const level = fixture.model.levels.find((l) => l.id === robot.level);
    if (!level) continue;
    const mower = robot.entity.startsWith("lawn_mower.");
    const rooms = level.rooms.filter((r) => (mower ? r.kind === "outdoor" : (r.kind ?? "room") === "room") && (r.rect || r.polygon));
    const route = [robot.dock, ...rooms.flatMap(lap), robot.dock];
    const points = along(route, (SPEED * STEP_MS) / 1000);
    if (points.length < 3) continue;
    const working = mower ? "mowing" : "cleaning";
    let i = 0;
    let restUntil = 0;
    const tick = () => {
      const now = Date.now();
      if (now < restUntil) return;
      if (i >= points.length) {
        // home: a rest on the dock, then out again
        i = 0;
        restUntil = now + REST_MS;
        setState(robot.entity, "docked", { demo_position: robot.dock });
        return;
      }
      const returning = i > points.length * 0.9;
      setState(robot.entity, returning ? "returning" : working, { demo_position: points[i] });
      i++;
    };
    timers.push(setInterval(tick, STEP_MS));
  }
  return () => timers.forEach(clearInterval);
}
