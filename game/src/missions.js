// Missions: 6 jobs from "the Fixer", each with a distinct objective. A mission
// has a briefing, a target (or targets), a purple beacon + ring at the target,
// and a cash reward. The mission tracker in the HUD shows the current objective.
//
// Mission types:
//  1. steal — steal a marked car, deliver it to the garage.
//  2. drop — drive to a pickup, collect a package, deliver to a second point.
//  3. tail — follow a marked courier car for 60s (stay 15-40 units away).
//  4. getaway — lose a 3-star wanted level (evade until it decays to 0).
//  5. photo — drive to a viewpoint and photograph the Harbor Spire (press F).
//  6. score — timed: collect 3 packages across the city in 180s.
import * as THREE from 'three';
import { CFG } from './config.js';
import { roadCoord } from './roads.js';

export const MISSION_DEFS = [
  {
    id: 1,
    name: 'First Wheels',
    type: 'steal',
    brief: 'The Fixer needs a ride. Steal the marked coupe on 3rd & Main and bring it to the garage. No scratches — or at least, no witnesses.',
    reward: 300,
    target: { x: roadCoord(3) + 3, z: roadCoord(1) },
    garage: { x: roadCoord(1), z: roadCoord(5) },
  },
  {
    id: 2,
    name: 'The Drop',
    type: 'drop',
    brief: 'Pick up the package at the container yard, then deliver it to the pier. Two stops, one payday. Don\'t open the box.',
    reward: 350,
    pickup: { x: -120, z: 186 },
    dropoff: { x: 120, z: 204 },
  },
  {
    id: 3,
    name: 'Tail the Courier',
    type: 'tail',
    brief: 'A courier is moving something valuable across town. Follow them for 60 seconds — stay 15 to 40 units back. Get too close and they\'ll spook.',
    reward: 400,
    duration: 60,
  },
  {
    id: 4,
    name: 'Clean Getaway',
    type: 'getaway',
    brief: 'The heat is on — 3 stars and climbing. Lose the cops: break line of sight and stay clean until the wanted level drops to zero.',
    reward: 450,
  },
  {
    id: 5,
    name: 'Photo Op',
    type: 'photo',
    brief: 'The Fixer wants a photo of the Harbor Spire for the crew\'s wall. Drive to the viewpoint on the pier road and press F to snap it.',
    reward: 300,
    viewpoint: { x: 60, z: 180 },
  },
  {
    id: 6,
    name: 'The Big Score',
    type: 'score',
    brief: 'Three packages, three corners of the city, 3 minutes. Grab them all before the timer runs out — the Fixer pays double for speed.',
    reward: 800,
    timeLimit: 180,
    packages: [
      { x: roadCoord(0) + 3, z: roadCoord(0) },
      { x: roadCoord(6) - 3, z: roadCoord(1) },
      { x: roadCoord(2), z: roadCoord(6) - 3 },
    ],
  },
];

export class Missions {
  constructor(scene) {
    this.scene = scene;
    this.index = 0; // current mission (0-based)
    this.completed = 0;
    this.state = 'idle'; // idle | active | done
    this.stage = 0; // sub-stage for multi-leg missions
    this.timer = 0;
    this.tailTime = 0;
    this.collected = 0;
    this.courier = null; // the tail target (a traffic car)
    this.beacon = null;
    this.ring = null;
    this.packageMarkers = [];
    this.onComplete = null; // callback(reward)
    this.onFail = null;
    this._makeBeacon();
  }

  _makeBeacon() {
    // Purple beacon pillar + ring at the current target.
    const beamGeo = new THREE.CylinderGeometry(1.2, 1.2, 120, 12, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xb44dff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.beacon = new THREE.Mesh(beamGeo, beamMat);
    this.beacon.position.y = 60;
    this.beacon.visible = false;
    this.scene.add(this.beacon);
    const ringGeo = new THREE.RingGeometry(4.5, 5.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xb44dff, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.1;
    this.ring.visible = false;
    this.scene.add(this.ring);
  }

  _setBeacon(x, z) {
    this.beacon.position.x = x;
    this.beacon.position.z = z;
    this.ring.position.x = x;
    this.ring.position.z = z;
    this.beacon.visible = true;
    this.ring.visible = true;
  }

  _hideBeacon() {
    this.beacon.visible = false;
    this.ring.visible = false;
  }

  _clearPackages() {
    for (const m of this.packageMarkers) this.scene.remove(m);
    this.packageMarkers = [];
  }

  _addPackage(x, z) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshLambertMaterial({ color: 0xffd24d }),
    );
    box.position.set(x, 0.6, z);
    this.scene.add(box);
    this.packageMarkers.push(box);
    return box;
  }

  current() {
    return MISSION_DEFS[this.index] || null;
  }

  isActive() {
    return this.state === 'active';
  }

  start(index, traffic) {
    this.index = index;
    this.state = 'active';
    this.stage = 0;
    this.timer = 0;
    this.tailTime = 0;
    this.collected = 0;
    this._clearPackages();
    const m = this.current();
    if (!m) return;
    if (m.type === 'steal') {
      this._setBeacon(m.target.x, m.target.z);
    } else if (m.type === 'drop') {
      this._setBeacon(m.pickup.x, m.pickup.z);
      this._addPackage(m.pickup.x, m.pickup.z);
    } else if (m.type === 'tail') {
      // Pick a traffic car as the courier.
      const cars = traffic.all();
      this.courier = cars.length ? cars[Math.floor(Math.random() * cars.length)] : null;
      this._hideBeacon();
    } else if (m.type === 'getaway') {
      this._hideBeacon();
    } else if (m.type === 'photo') {
      this._setBeacon(m.viewpoint.x, m.viewpoint.z);
    } else if (m.type === 'score') {
      this.timer = m.timeLimit;
      for (const p of m.packages) this._addPackage(p.x, p.z);
      this._setBeacon(m.packages[0].x, m.packages[0].z);
    }
  }

  // Returns { done: bool, failed: bool, message: string } when the mission ends.
  update(dt, player, wanted) {
    if (this.state !== 'active') return null;
    const m = this.current();
    if (!m) return null;
    const px = player.x;
    const pz = player.z;
    const near = (pt, r) => Math.hypot(px - pt.x, pz - pt.z) < r;

    if (m.type === 'steal') {
      if (this.stage === 0) {
        // Reach the marked car.
        if (near(m.target, 6)) {
          this.stage = 1;
          this._setBeacon(m.garage.x, m.garage.z);
          return { done: false, failed: false, message: 'Got the coupe. Now bring it to the garage.' };
        }
      } else if (near(m.garage, 7) && player.inCar) {
        return this._finish(m);
      }
    } else if (m.type === 'drop') {
      if (this.stage === 0) {
        if (near(m.pickup, 5)) {
          this.stage = 1;
          this._clearPackages();
          this._setBeacon(m.dropoff.x, m.dropoff.z);
          return { done: false, failed: false, message: 'Package collected. Deliver it to the pier.' };
        }
      } else if (near(m.dropoff, 6)) {
        return this._finish(m);
      }
    } else if (m.type === 'tail') {
      if (!this.courier) return null;
      const d = Math.hypot(px - this.courier.x, pz - this.courier.z);
      if (d < 15) {
        return this._fail(m, 'Too close — the courier spotted you.');
      }
      if (d <= 40) {
        this.tailTime += dt;
        if (this.tailTime >= m.duration) return this._finish(m);
      }
    } else if (m.type === 'getaway') {
      if (wanted === 0) return this._finish(m);
    } else if (m.type === 'photo') {
      if (near(m.viewpoint, 8) && player.pressedPhoto) {
        player.pressedPhoto = false;
        return this._finish(m);
      }
    } else if (m.type === 'score') {
      this.timer -= dt;
      if (this.timer <= 0) return this._fail(m, 'Time\'s up — the packages are gone.');
      const remaining = m.packages.filter((_, i) => !this.packageMarkers[i] || this.packageMarkers[i].visible);
      // Check each package.
      for (let i = 0; i < m.packages.length; i++) {
        const marker = this.packageMarkers[i];
        if (!marker || !marker.visible) continue;
        if (near(m.packages[i], 5)) {
          marker.visible = false;
          this.collected++;
          const left = m.packages.length - this.collected;
          if (left === 0) return this._finish(m);
          // Move the beacon to the next package.
          const next = m.packages.find((_, j) => this.packageMarkers[j] && this.packageMarkers[j].visible);
          if (next) this._setBeacon(next.x, next.z);
          return { done: false, failed: false, message: `Package ${this.collected}/3. ${left} left.` };
        }
      }
      void remaining;
    }
    return null;
  }

  _finish(m) {
    this.state = 'done';
    this._hideBeacon();
    this._clearPackages();
    this.completed++;
    if (this.onComplete) this.onComplete(m.reward);
    return { done: true, failed: false, message: `Job done: ${m.name}. +$${m.reward}` };
  }

  _fail(m, reason) {
    this.state = 'idle';
    this._hideBeacon();
    this._clearPackages();
    if (this.onFail) this.onFail(reason);
    return { done: false, failed: true, message: reason };
  }

  // Objective text for the HUD tracker.
  objectiveText() {
    if (this.state !== 'active') return 'No active job — drive to the Fixer (F) to start one.';
    const m = this.current();
    if (!m) return '';
    switch (m.type) {
      case 'steal':
        return this.stage === 0 ? `Steal the coupe at 3rd & Main` : 'Deliver the coupe to the garage';
      case 'drop':
        return this.stage === 0 ? 'Pick up the package at the container yard' : 'Deliver the package to the pier';
      case 'tail':
        return `Tail the courier: ${Math.ceil(m.duration - this.tailTime)}s left (stay 15-40 away)`;
      case 'getaway':
        return 'Lose the cops — wanted level must hit 0';
      case 'photo':
        return 'Drive to the viewpoint and press F to photograph the Spire';
      case 'score':
        return `Collect ${m.packages.length - this.collected} packages — ${Math.ceil(this.timer)}s left`;
      default:
        return '';
    }
  }

  // Beacon position for the minimap (null if hidden).
  beaconPos() {
    if (!this.beacon.visible) return null;
    return { x: this.beacon.position.x, z: this.beacon.position.z };
  }
}
