// Road graph for the 7x7 city grid. Traffic and police both drive on this graph,
// which is what keeps them on the roads: a car never leaves a road segment or a
// turn arc, so it can never clip a building corner or cut across a sidewalk.
//
// Roads run at x = -180..180 and z = -180..180 (spacing 60). Intersections are the
// 49 crossings. A car drives in the RIGHT-hand lane (offset LANE_OFFSET from the
// road centre in its direction of travel). At an intersection it either goes
// straight or turns via a quarter-circle arc from its incoming lane to its outgoing
// lane — the arc stays inside the intersection's road area, so the car never
// touches a block corner.
import { CFG } from './config.js';

const N = CFG.ROAD_COUNT;
const S = CFG.ROAD_SPACING;
const OFF = CFG.LANE_OFFSET;
const HALF = (N - 1) / 2; // roads indexed 0..6, coord = (i - 3) * 60

export function roadCoord(i) {
  return (i - HALF) * S;
}

// A node is an intersection: { i, j } -> position (roadCoord(i), roadCoord(j)).
export function nodePos(node) {
  return { x: roadCoord(node.i), z: roadCoord(node.j) };
}

export function nodeKey(node) {
  return node.i + ',' + node.j;
}

// Neighbours of a node (up to 4, no diagonals).
export function neighbours(node) {
  const out = [];
  if (node.i > 0) out.push({ i: node.i - 1, j: node.j });
  if (node.i < N - 1) out.push({ i: node.i + 1, j: node.j });
  if (node.j > 0) out.push({ i: node.i, j: node.j - 1 });
  if (node.j < N - 1) out.push({ i: node.i, j: node.j + 1 });
  return out;
}

// The lane position for driving from node A to node B: the road centre offset to
// the right of the direction of travel (right-hand traffic).
// from: {i,j} node, to: {i,j} node (adjacent). Returns {x, z} lane point at `t`
// (0..1) along the segment, plus the heading angle.
export function lanePoint(from, to, t) {
  const a = nodePos(from);
  const b = nodePos(to);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  // Right-hand offset: rotate direction by -90deg (in x,z plane, y-up).
  const rx = -uz;
  const rz = ux;
  return {
    x: a.x + dx * t + rx * OFF,
    z: a.z + dz * t + rz * OFF,
    heading: Math.atan2(ux, uz),
  };
}

// A turn arc at intersection `node`, from incoming direction `inDir` to outgoing
// direction `outDir`. Directions are unit vectors {x, z}.
// Returns a function arc(t) -> {x, z, heading} for t in 0..1, or null if the car
// goes straight (no arc needed — the lane continues across the intersection).
//
// The arc is a quarter circle whose radius keeps the car inside the road: for a
// right turn the radius is ROAD_HALF - LANE_OFFSET (tight, hugging the corner);
// for a left turn the radius is ROAD_HALF + LANE_OFFSET (wide, swinging across
// the intersection). Both stay within the road area.
export function turnArc(node, inDir, outDir) {
  // Straight?
  if (inDir.x === outDir.x && inDir.z === outDir.z) return null;
  // U-turn (should not happen — routes never reverse) — treat as a wide arc.
  const c = nodePos(node);
  // Incoming lane point at the intersection edge, outgoing lane point at the
  // intersection edge. The arc connects them.
  const inLane = laneOffset(inDir);
  const outLane = laneOffset(outDir);
  const p0 = { x: c.x - inDir.x * CFG.ROAD_HALF + inLane.x, z: c.z - inDir.z * CFG.ROAD_HALF + inLane.z };
  const p1 = { x: c.x + outDir.x * CFG.ROAD_HALF + outLane.x, z: c.z + outDir.z * CFG.ROAD_HALF + outLane.z };
  // Simpler robust centre: the intersection point of the two lane lines extended.
  // Lane lines: incoming lane line passes through p0 with direction inDir;
  // outgoing lane line passes through p1 with direction outDir. Their
  // intersection is the arc centre only for a 90-degree turn when the radii
  // match; instead we use a quadratic Bezier through a control point at the
  // corner, which is smooth, stays inside the road, and never clips a block.
  const ctrl = {
    x: c.x + inLane.x + outLane.x,
    z: c.z + inLane.z + outLane.z,
  };
  return function arc(t) {
    // Quadratic Bezier p0 -> ctrl -> p1.
    const u = 1 - t;
    const x = u * u * p0.x + 2 * u * t * ctrl.x + t * t * p1.x;
    const z = u * u * p0.z + 2 * u * t * ctrl.z + t * t * p1.z;
    // Derivative for heading.
    const dx = 2 * u * (ctrl.x - p0.x) + 2 * t * (p1.x - ctrl.x);
    const dz = 2 * u * (ctrl.z - p0.z) + 2 * t * (p1.z - ctrl.z);
    return { x, z, heading: Math.atan2(dx, dz) };
  };
}

function laneOffset(dir) {
  // Right-hand offset for a direction vector.
  return { x: -dir.z * OFF, z: dir.x * OFF };
}

// Nearest intersection to a world position.
export function nearestNode(x, z) {
  const i = Math.max(0, Math.min(N - 1, Math.round(x / S + HALF)));
  const j = Math.max(0, Math.min(N - 1, Math.round(z / S + HALF)));
  return { i, j };
}

// Nearest point on any road (road centre) to a world position — used to place
// police spawns and to route police to the player's road position.
export function nearestRoadPoint(x, z) {
  // Distance to the nearest vertical road (x = roadCoord(i)) and horizontal road.
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < N; i++) {
    const rx = roadCoord(i);
    const d = Math.abs(x - rx);
    if (d < bestD) {
      bestD = d;
      best = { x: rx, z };
    }
  }
  for (let j = 0; j < N; j++) {
    const rz = roadCoord(j);
    const d = Math.abs(z - rz);
    if (d < bestD) {
      bestD = d;
      best = { x, z: rz };
    }
  }
  return best;
}

// Greedy road route from node A to node B (Manhattan descent, no diagonal
// shortcuts): returns a list of nodes. Used by police — they always stay on roads.
export function routeOnRoads(from, to) {
  const path = [{ i: from.i, j: from.j }];
  let cur = { i: from.i, j: from.j };
  let guard = 0;
  while ((cur.i !== to.i || cur.j !== to.j) && guard < 40) {
    guard++;
    const options = neighbours(cur).filter((n) => {
      // Never step back onto the previous node (no immediate U-turn).
      const prev = path[path.length - 2];
      return !(prev && n.i === prev.i && n.j === prev.j);
    });
    // Pick the neighbour that minimises Manhattan distance to the target.
    options.sort((a, b) => {
      const da = Math.abs(a.i - to.i) + Math.abs(a.j - to.j);
      const db = Math.abs(b.i - to.i) + Math.abs(b.j - to.j);
      return da - db;
    });
    const next = options[0];
    if (!next) break;
    path.push(next);
    cur = next;
  }
  return path;
}

// Is a world point on a road (within the road width of a road centre line)?
export function isOnRoad(x, z) {
  for (let i = 0; i < N; i++) {
    if (Math.abs(x - roadCoord(i)) <= CFG.ROAD_HALF) return true;
  }
  for (let j = 0; j < N; j++) {
    if (Math.abs(z - roadCoord(j)) <= CFG.ROAD_HALF) return true;
  }
  return false;
}

// The sidewalk band around a block: peds walk on the block edge, inset from the
// road by the sidewalk width. Returns the clamped point on the nearest block edge.
export function sidewalkPoint(x, z) {
  const inset = CFG.ROAD_HALF + 1.5;
  // Find the block the point is in (or nearest to) and clamp to its edge band.
  const bi = Math.floor((x + CFG.CITY_HALF) / S);
  const bj = Math.floor((z + CFG.CITY_HALF) / S);
  const bx0 = -CFG.CITY_HALF + bi * S + inset;
  const bx1 = -CFG.CITY_HALF + (bi + 1) * S - inset;
  const bz0 = -CFG.CITY_HALF + bj * S + inset;
  const bz1 = -CFG.CITY_HALF + (bj + 1) * S - inset;
  const cx = Math.max(bx0, Math.min(bx1, x));
  const cz = Math.max(bz0, Math.min(bz1, z));
  return { x: cx, z: cz };
}
