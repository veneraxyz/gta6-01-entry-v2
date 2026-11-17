// Vehicles: traffic cars and police cruisers. Both drive on the road graph
// (roads.js): a car is always on a road segment or a turn arc, so traffic never
// clips a building corner and police never cut across a sidewalk.
//
// A car has a route (list of intersection nodes). It drives its current segment in
// the right-hand lane; at the segment end it follows a turn arc into the next
// segment. Traffic picks a random next node at each intersection; police route
// greedily toward the player's road position and ram when close.
import * as THREE from 'three';
import { CFG } from './config.js';
import { lanePoint, turnArc, neighbours, nodePos, nearestNode, routeOnRoads, nearestRoadPoint, roadCoord } from './roads.js';

const CAR_COLORS = [0xc23b2e, 0x2e7ac2, 0xd8d8d8, 0x3aa655, 0xd8a02e, 0x7a4ac2, 0x2e2e2e, 0x8c5a2e];

function buildCarMesh(color, isPolice) {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 4.2), bodyMat);
  body.position.y = 0.55;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.65, 2.1), darkMat);
  cabin.position.set(0, 1.2, -0.2);
  car.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]].forEach(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.36, z);
    car.add(w);
  });
  // Headlights (emissive) so cars read at dusk.
  const lightGeo = new THREE.BoxGeometry(0.4, 0.25, 0.1);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  [-0.6, 0.6].forEach((x) => {
    const l = new THREE.Mesh(lightGeo, lightMat);
    l.position.set(x, 0.6, 2.12);
    car.add(l);
  });
  let lightBar = null;
  if (isPolice) {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.4), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.x = -0.45;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.4), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    blue.position.x = 0.45;
    bar.add(red);
    bar.add(blue);
    bar.position.y = 1.65;
    car.add(bar);
    lightBar = { red, blue };
    // Police livery: white doors stripe.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.3, 2.6), new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }));
    stripe.position.set(0, 0.6, 0);
    car.add(stripe);
  }
  return { group: car, lightBar };
}

class RoadCar {
  constructor(scene, rng, isPolice, color) {
    const { group, lightBar } = buildCarMesh(color, isPolice);
    this.mesh = group;
    this.lightBar = lightBar;
    this.isPolice = isPolice;
    scene.add(group);
    this.rng = rng;
    // Route state: current segment from node `from` to node `to`, progress t.
    this.from = { i: 0, j: 0 };
    this.to = { i: 0, j: 0 };
    this.t = 0;
    this.arc = null; // active turn arc function, or null
    this.arcT = 0;
    this.speed = 0;
    this.maxSpeed = isPolice ? CFG.POLICE_SPEED : CFG.TRAFFIC_SPEED;
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    this.route = []; // remaining nodes (police)
    this.stopped = false;
    this.flashT = 0;
  }

  // Place the car on a random road segment.
  placeRandom() {
    const i = this.rng.int(0, 6);
    const j = this.rng.int(0, 6);
    const from = { i, j };
    const opts = neighbours(from);
    const to = this.rng.pick(opts);
    this.from = from;
    this.to = to;
    this.t = this.rng.next();
    this.arc = null;
    this.updatePose();
  }

  placeAt(node, nextNode) {
    this.from = { ...node };
    this.to = { ...nextNode };
    this.t = 0;
    this.arc = null;
    this.updatePose();
  }

  // Current direction of travel as a unit vector.
  direction() {
    const a = nodePos(this.from);
    const b = nodePos(this.to);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  updatePose() {
    if (this.arc) {
      const p = this.arc(this.arcT);
      this.x = p.x;
      this.z = p.z;
      this.heading = p.heading;
    } else {
      const p = lanePoint(this.from, this.to, this.t);
      this.x = p.x;
      this.z = p.z;
      this.heading = p.heading;
    }
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
  }

  // Advance along the route by `dist` world units. Returns true if it reached
  // the end of its current segment (caller picks the next leg).
  advance(dist) {
    if (this.arc) {
      // Arc length ~ quarter circle of radius ~6-9: approximate 12 units.
      this.arcT += dist / 12;
      if (this.arcT >= 1) {
        this.arc = null;
        this.arcT = 0;
        this.t = 0;
        return true;
      }
      return false;
    }
    const segLen = CFG.ROAD_SPACING;
    this.t += dist / segLen;
    if (this.t >= 1) {
      this.t = 1;
      return true;
    }
    return false;
  }

  // Begin the next leg: from the current `to` node toward `next`.
  startLeg(next) {
    const inDir = this.direction();
    const newFrom = { ...this.to };
    const newTo = { ...next };
    const outDir = (() => {
      const a = nodePos(newFrom);
      const b = nodePos(newTo);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      return { x: dx / len, z: dz / len };
    })();
    this.from = newFrom;
    this.to = newTo;
    this.t = 0;
    this.arc = turnArc(newFrom, inDir, outDir);
    this.arcT = 0;
  }
}

// Re-sync a car's route state onto the road segment it is actually on, with the
// correct direction and fractional position. Used after a police ram so the car
// does not teleport when road-following resumes.
function resyncToRoad(car) {
  const x = car.x;
  const z = car.z;
  // Nearest vertical road (x = roadCoord(i)) and nearest horizontal road.
  let bestI = 0;
  let dv = Infinity;
  for (let i = 0; i < CFG.ROAD_COUNT; i++) {
    const d = Math.abs(x - roadCoord(i));
    if (d < dv) {
      dv = d;
      bestI = i;
    }
  }
  let bestJ = 0;
  let dh = Infinity;
  for (let j = 0; j < CFG.ROAD_COUNT; j++) {
    const d = Math.abs(z - roadCoord(j));
    if (d < dh) {
      dh = d;
      bestJ = j;
    }
  }
  car.arc = null;
  car.arcT = 0;
  if (dv <= dh) {
    // On vertical road bestI: segment between nodes (bestI, j) and (bestI, j+1).
    const j = Math.max(0, Math.min(CFG.ROAD_COUNT - 2, Math.floor(z / CFG.ROAD_SPACING + 3)));
    const forward = Math.cos(car.heading) >= 0; // moving toward +z?
    if (forward) {
      car.from = { i: bestI, j };
      car.to = { i: bestI, j: j + 1 };
      car.t = Math.max(0, Math.min(1, (z - roadCoord(j)) / CFG.ROAD_SPACING));
    } else {
      car.from = { i: bestI, j: j + 1 };
      car.to = { i: bestI, j };
      car.t = Math.max(0, Math.min(1, (roadCoord(j + 1) - z) / CFG.ROAD_SPACING));
    }
  } else {
    // On horizontal road bestJ.
    const i = Math.max(0, Math.min(CFG.ROAD_COUNT - 2, Math.floor(x / CFG.ROAD_SPACING + 3)));
    const forward = Math.sin(car.heading) >= 0; // moving toward +x?
    if (forward) {
      car.from = { i, j: bestJ };
      car.to = { i: i + 1, j: bestJ };
      car.t = Math.max(0, Math.min(1, (x - roadCoord(i)) / CFG.ROAD_SPACING));
    } else {
      car.from = { i: i + 1, j: bestJ };
      car.to = { i, j: bestJ };
      car.t = Math.max(0, Math.min(1, (roadCoord(i + 1) - x) / CFG.ROAD_SPACING));
    }
  }
}

export class Traffic {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.cars = [];
    for (let i = 0; i < CFG.TRAFFIC_COUNT; i++) {
      const car = new RoadCar(scene, rng, false, CAR_COLORS[i % CAR_COLORS.length]);
      car.placeRandom();
      car.speed = CFG.TRAFFIC_SPEED * rng.range(0.85, 1.1);
      this.cars.push(car);
    }
  }

  update(dt, playerPos, playerInCar) {
    for (const car of this.cars) {
      // Slow down for a car ahead in the same lane (same segment, same direction).
      let targetSpeed = car.maxSpeed;
      for (const other of this.cars) {
        if (other === car) continue;
        if (other.from.i === car.from.i && other.from.j === car.from.j && other.to.i === car.to.i && other.to.j === car.to.j) {
          if (other.t > car.t && other.t - car.t < 0.16) targetSpeed = 0;
        }
      }
      // Brake for the player if they are right in front of the car.
      if (playerPos) {
        const dx = playerPos.x - car.x;
        const dz = playerPos.z - car.z;
        const dist = Math.hypot(dx, dz);
        const fwd = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
        const ahead = dx * fwd.x + dz * fwd.z;
        if (dist < CFG.TRAFFIC_MIN_GAP && ahead > 0) targetSpeed = 0;
      }
      car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 3);
      if (car.speed < 0.01) {
        car.updatePose();
        continue;
      }
      const done = car.advance(car.speed * dt);
      if (done) {
        // Pick a random next node (no U-turn back onto the previous node).
        const opts = neighbours(car.to).filter((n) => !(n.i === car.from.i && n.j === car.from.j));
        const next = opts.length ? this.rng.pick(opts) : car.from;
        car.startLeg(next);
      }
      car.updatePose();
    }
  }

  // Add a fresh traffic car (used when the player steals one).
  respawn() {
    const car = new RoadCar(this.scene, this.rng, false, CAR_COLORS[this.rng.int(0, CAR_COLORS.length - 1)]);
    car.placeRandom();
    car.speed = CFG.TRAFFIC_SPEED * this.rng.range(0.85, 1.1);
    this.cars.push(car);
  }

  // All traffic cars, for collision checks.
  all() {
    return this.cars;
  }
}

export class Police {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.cruisers = [];
    this.spawnCooldown = 0;
  }

  setWanted(level, playerPos) {
    // Spawn cruisers up to the wanted level; remove extras when it falls.
    while (this.cruisers.length < level) {
      const c = new RoadCar(this.scene, this.rng, true, 0x1a2a4a);
      // Spawn on a road 60-100 units from the player (off-screen, on a road).
      const angle = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(60, 100);
      const sx = playerPos.x + Math.cos(angle) * dist;
      const sz = playerPos.z + Math.sin(angle) * dist;
      const rp = nearestRoadPoint(sx, sz);
      const node = nearestNode(rp.x, rp.z);
      const opts = neighbours(node);
      const next = this.rng.pick(opts);
      c.placeAt(node, next);
      c.speed = 0;
      this.cruisers.push(c);
    }
    while (this.cruisers.length > level) {
      const c = this.cruisers.pop();
      this.scene.remove(c.mesh);
    }
  }

  update(dt, playerPos, playerInCar, playerSpeed) {
    const targetNode = nearestNode(playerPos.x, playerPos.z);
    for (const c of this.cruisers) {
      // Flash the light bar.
      c.flashT += dt;
      if (c.lightBar) {
        const on = Math.floor(c.flashT * 4) % 2 === 0;
        c.lightBar.red.visible = on;
        c.lightBar.blue.visible = !on;
      }
      const dx = playerPos.x - c.x;
      const dz = playerPos.z - c.z;
      const dist = Math.hypot(dx, dz);
      // If the player is close and on the same road, ram: drive straight at
      // them (the player is on the road, so the cruiser stays on the road too).
      // Otherwise follow the road graph toward the player's node.
      let targetSpeed = CFG.POLICE_SPEED;
      if (dist < CFG.RAM_RANGE && playerInCar) {
        // Ram: steer directly at the player (both on the road).
        const want = Math.atan2(dx, dz);
        let dh = want - c.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        c.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, dh));
        c.x += Math.sin(c.heading) * targetSpeed * dt;
        c.z += Math.cos(c.heading) * targetSpeed * dt;
        c.mesh.position.set(c.x, 0, c.z);
        c.mesh.rotation.y = c.heading;
        // Re-sync the route state onto the road segment the cruiser is
        // actually on (so the next road-following frame does not teleport it).
        resyncToRoad(c);
        continue;
      }
      // Route along roads toward the player's node.
      if (c.route.length === 0 || c.route[c.route.length - 1].i !== targetNode.i || c.route[c.route.length - 1].j !== targetNode.j) {
        const cur = nearestNode(c.x, c.z);
        c.route = routeOnRoads(cur, targetNode);
        // Drop the first node (we are already there / heading there).
        if (c.route.length > 1) c.route.shift();
      }
      // If the cruiser is off its current segment (after a ram), re-place it.
      const done = c.advance(c.speed * dt);
      if (done) {
        const next = c.route.length > 0 ? c.route.shift() : null;
        if (next) {
          c.startLeg(next);
        } else {
          // Arrived at the player's node: circle the block (pick a random leg).
          const opts = neighbours(c.to).filter((n) => !(n.i === c.from.i && n.j === c.from.j));
          const n2 = opts.length ? this.rng.pick(opts) : c.from;
          c.startLeg(n2);
        }
      }
      // Speed: faster when far, slower when close (so it can corner).
      targetSpeed = dist > 40 ? CFG.POLICE_SPEED : CFG.POLICE_SPEED * 0.7;
      c.speed += (targetSpeed - c.speed) * Math.min(1, dt * 2);
      c.updatePose();
    }
  }

  // Distance from the nearest cruiser to a point (for arrest / siren volume).
  nearestDistance(x, z) {
    let best = Infinity;
    for (const c of this.cruisers) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < best) best = d;
    }
    return best;
  }

  all() {
    return this.cruisers;
  }
}
