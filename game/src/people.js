// Pedestrians: 24 walkers on the sidewalks (block edges). They stroll along the
// sidewalk, turn at corners, flee gunshots/sirens/speeding cars, and fall when a
// car hits them (then get up and run away).
import * as THREE from 'three';
import { CFG } from './config.js';
import { roadCoord } from './roads.js';

const SHIRT_COLORS = [0xc23b2e, 0x2e7ac2, 0x3aa655, 0xd8a02e, 0x7a4ac2, 0xd8d8d8, 0x2e2e2e, 0xe87a5a];
const SKIN_COLORS = [0xf0c8a0, 0xc89060, 0x8a5a30, 0xe8b088];

function buildPedMesh(shirt, skin) {
  const ped = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: shirt });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.35), bodyMat);
  body.position.y = 1.05;
  ped.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skinMat);
  head.position.y = 1.68;
  ped.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.65, 0.25), pantsMat);
  legL.position.set(-0.15, 0.32, 0);
  ped.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.65, 0.25), pantsMat);
  legR.position.set(0.15, 0.32, 0);
  ped.add(legR);
  return { group: ped, legL, legR };
}

export class Pedestrians {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.peds = [];
    for (let i = 0; i < CFG.PED_COUNT; i++) {
      const shirt = SHIRT_COLORS[i % SHIRT_COLORS.length];
      const skin = SKIN_COLORS[i % SKIN_COLORS.length];
      const { group, legL, legR } = buildPedMesh(shirt, skin);
      scene.add(group);
      // Start on a random sidewalk: pick a random block edge.
      const bi = rng.int(0, 5);
      const bj = rng.int(0, 5);
      const edge = rng.int(0, 3);
      const inset = CFG.ROAD_HALF + 1.5;
      const x0 = roadCoord(bi) + inset;
      const x1 = roadCoord(bi + 1) - inset;
      const z0 = roadCoord(bj) + inset;
      const z1 = roadCoord(bj + 1) - inset;
      let x;
      let z;
      let heading;
      if (edge === 0) {
        x = rng.range(x0, x1);
        z = z0;
        heading = rng.chance(0.5) ? 0 : Math.PI;
      } else if (edge === 1) {
        x = rng.range(x0, x1);
        z = z1;
        heading = rng.chance(0.5) ? 0 : Math.PI;
      } else if (edge === 2) {
        x = x0;
        z = rng.range(z0, z1);
        heading = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
      } else {
        x = x1;
        z = rng.range(z0, z1);
        heading = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
      }
      this.peds.push({
        mesh: group,
        legL,
        legR,
        x,
        z,
        heading,
        speed: CFG.PED_WALK * rng.range(0.8, 1.2),
        state: 'walk', // walk | flee | down
        stateT: 0,
        fleeX: 0,
        fleeZ: 0,
        walkPhase: rng.range(0, Math.PI * 2),
        block: { bi, bj },
      });
    }
  }

  // A gunshot / siren / speeding car at (x, z) scares nearby peds.
  scare(x, z, radius) {
    for (const p of this.peds) {
      if (p.state === 'down') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius) {
        p.state = 'flee';
        p.stateT = 0;
        // Flee directly away from the threat.
        const dx = p.x - x;
        const dz = p.z - z;
        const len = Math.hypot(dx, dz) || 1;
        p.fleeX = dx / len;
        p.fleeZ = dz / len;
      }
    }
  }

  // A car hit a ped: they fall down.
  knockDown(p) {
    if (p.state === 'down') return;
    p.state = 'down';
    p.stateT = 0;
    p.mesh.rotation.x = -Math.PI / 2;
    p.mesh.position.y = 0.3;
  }

  update(dt, cars, playerCar) {
    for (const p of this.peds) {
      p.stateT += dt;
      if (p.state === 'down') {
        // Get up after 4s and flee.
        if (p.stateT > 4) {
          p.state = 'flee';
          p.stateT = 0;
          p.mesh.rotation.x = 0;
          p.mesh.position.y = 0;
          p.fleeX = this.rng.range(-1, 1);
          p.fleeZ = this.rng.range(-1, 1);
          const len = Math.hypot(p.fleeX, p.fleeZ) || 1;
          p.fleeX /= len;
          p.fleeZ /= len;
        }
        continue;
      }
      let speed = p.speed;
      if (p.state === 'flee') {
        speed = CFG.PED_FLEE;
        p.heading = Math.atan2(p.fleeX, p.fleeZ);
        if (p.stateT > 3.5) {
          p.state = 'walk';
          p.stateT = 0;
        }
      } else {
        // Walk along the sidewalk; turn at the block edge.
        const inset = CFG.ROAD_HALF + 1.5;
        const { bi, bj } = p.block;
        const x0 = roadCoord(bi) + inset;
        const x1 = roadCoord(bi + 1) - inset;
        const z0 = roadCoord(bj) + inset;
        const z1 = roadCoord(bj + 1) - inset;
        // If about to leave the block edge, turn 90 degrees (walk the perimeter).
        const nx = p.x + Math.sin(p.heading) * speed * dt;
        const nz = p.z + Math.cos(p.heading) * speed * dt;
        if (nx < x0 || nx > x1 || nz < z0 || nz > z1) {
          p.heading += (this.rng.chance(0.5) ? 1 : -1) * (Math.PI / 2);
        }
      }
      // Move.
      p.x += Math.sin(p.heading) * speed * dt;
      p.z += Math.cos(p.heading) * speed * dt;
      // Keep inside the city.
      p.x = Math.max(-CFG.CITY_HALF + 5, Math.min(CFG.CITY_HALF - 5, p.x));
      p.z = Math.max(-CFG.CITY_HALF + 5, Math.min(CFG.CITY_HALF - 5, p.z));
      // Walk cycle: swing legs and arms.
      p.walkPhase += dt * speed * 2.2;
      const swing = Math.sin(p.walkPhase) * 0.55;
      p.legL.rotation.x = swing;
      p.legR.rotation.x = -swing;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.heading;
      // Hit by a car? (traffic or the player's car)
      const allCars = playerCar ? [...cars, playerCar] : cars;
      for (const c of allCars) {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < 1.6 && c.speed > 3) {
          this.knockDown(p);
          break;
        }
      }
    }
  }

  all() {
    return this.peds;
  }
}
