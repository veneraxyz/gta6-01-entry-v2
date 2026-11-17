// Neon Harbor II — main game: player, camera, wanted system, combat, save, and
// the game loop. The camera auto-follow fix: auto-follow only engages when the
// mouse has been idle for 2.5s, and blends gently — it never fights an active
// mouse orbit, even while sprinting.
import * as THREE from 'three';
import { CFG } from './config.js';
import { makeRng } from './rng.js';
import { buildCity } from './city.js';
import { Traffic, Police } from './vehicles.js';
import { Pedestrians } from './people.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { nearestRoadPoint, isOnRoad } from './roads.js';

const SAVE_KEY = 'neon-harbor-2-save';

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot');
const SEED = parseInt(params.get('seed') || '1', 10);
const rng = makeRng(SEED);

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500);

const city = buildCity(scene, rng);
const traffic = new Traffic(scene, rng);
const police = new Police(scene, rng);
const peds = new Pedestrians(scene, rng);
const missions = new Missions(scene);
const hud = new HUD();
const audio = new AudioEngine();
const input = new Input(canvas);

// --- Player ---
const player = {
  x: 0,
  z: 60,
  heading: Math.PI,
  speed: 0,
  inCar: false,
  car: null, // the car object the player is driving (mesh + state)
  health: 100,
  cash: 100,
  wanted: 0,
  lastCrime: 0,
  arrestTimer: 0,
  pressedPhoto: false,
  moving: false,
};

// Player on-foot mesh (a simple agent figure).
const playerMesh = new THREE.Group();
{
  const jacket = new THREE.MeshLambertMaterial({ color: 0x2e7ac2 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf0c8a0 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x22222e });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.85, 0.38), jacket);
  body.position.y = 1.05;
  playerMesh.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), skin);
  head.position.y = 1.7;
  playerMesh.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.68, 0.26), pants);
  legL.position.set(-0.16, 0.34, 0);
  playerMesh.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.16;
  playerMesh.add(legR);
  playerMesh.userData.legL = legL;
  playerMesh.userData.legR = legR;
}
scene.add(playerMesh);

// The player's starter car (parked near the spawn).
function makePlayerCarMesh(color) {
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
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  [-0.6, 0.6].forEach((x) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.1), lightMat);
    l.position.set(x, 0.6, 2.12);
    car.add(l);
  });
  return car;
}

const parkedCars = []; // cars the player can enter (traffic steals + the starter)
function spawnStarterCar() {
  const mesh = makePlayerCarMesh(0xc23b2e);
  mesh.position.set(3, 0, 54);
  mesh.rotation.y = Math.PI;
  scene.add(mesh);
  parkedCars.push({ mesh, x: 3, z: 54, heading: Math.PI, speed: 0 });
}
spawnStarterCar();

// Muzzle flash + tracer for shooting.
const tracer = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0 }),
);
scene.add(tracer);
let tracerTimer = 0;

// --- Camera ---
const cam = {
  yaw: Math.PI,
  pitch: 0.35,
  dist: 9,
  // Auto-follow: only when the mouse has been idle 2.5s; blends gently.
  autoFollowDelay: 2.5,
};

function updateCamera(dt) {
  // Mouse orbit.
  if (input.mouseDX !== 0 || input.mouseDY !== 0) {
    cam.yaw -= input.mouseDX * 0.004;
    cam.pitch = Math.max(0.05, Math.min(1.1, cam.pitch + input.mouseDY * 0.003));
  }
  const mouseIdle = performance.now() - input.lastMouseMove > cam.autoFollowDelay * 1000;
  const target = player.inCar ? player.car : player;
  // Auto-follow: ease the camera behind the player's heading — but ONLY when the
  // mouse is idle, and slowly, so it never fights an active orbit (even sprinting).
  // Never in shot mode (the staged camera angle must hold).
  if (mouseIdle && player.moving && !SHOT) {
    const wantYaw = target.heading;
    let diff = wantYaw - cam.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    // Gentle blend: 0.6/s — a slow drift, never a snap.
    cam.yaw += diff * Math.min(1, dt * 0.6);
  }
  const dist = player.inCar ? 11 : 9;
  const height = player.inCar ? 4.5 : 3.5;
  const tx = target.x;
  const tz = target.z;
  const cx = tx - Math.sin(cam.yaw) * Math.cos(cam.pitch) * dist;
  const cz = tz - Math.cos(cam.yaw) * Math.cos(cam.pitch) * dist;
  const cy = height + Math.sin(cam.pitch) * dist * 0.5;
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, 1.5, tz);
}

// --- Wanted ---
function addWanted(n, reason) {
  if (player.wanted >= 5) return;
  player.wanted = Math.min(5, player.wanted + n);
  player.lastCrime = performance.now();
  hud.setStars(player.wanted);
  hud.showMessage(reason + ` (Wanted ${player.wanted}★)`, 3);
}

function updateWanted(dt) {
  const now = performance.now();
  const sinceCrime = (now - player.lastCrime) / 1000;
  const nearestPolice = police.nearestDistance(player.x, player.z);
  // Shot mode: the wanted level is staged — never decay it (a screenshot takes
  // ~30s of wall time in headless, which would otherwise drop the stars).
  if (!SHOT && player.wanted > 0 && sinceCrime > CFG.WANTED_DECAY_SECONDS && nearestPolice > 40) {
    player.wanted--;
    player.lastCrime = now;
    hud.setStars(player.wanted);
    if (player.wanted === 0) hud.showMessage('You lost the cops.', 3);
  }
  police.setWanted(player.wanted, player);
  // Arrest: on foot, slow, and a cruiser right next to you.
  if (!player.inCar && player.wanted > 0 && nearestPolice < 6 && player.speed < 2) {
    player.arrestTimer += dt;
    if (player.arrestTimer > CFG.ARREST_SECONDS) {
      player.arrestTimer = 0;
      busted();
    }
  } else {
    player.arrestTimer = 0;
  }
}

function busted() {
  const fine = Math.min(player.cash, CFG.BUST_FINE);
  player.cash -= fine;
  player.wanted = 0;
  player.health = 100;
  hud.setStars(0);
  hud.setCash(player.cash);
  hud.setHealth(100);
  // Respawn at the police station (downtown).
  player.x = 3;
  player.z = 3;
  player.heading = Math.PI;
  if (player.inCar) exitCar();
  hud.showMessage(`BUSTED! Fined $${fine}. The Fixer bailed you out.`, 5);
  saveGame();
}

// --- Cars: enter / exit / drive ---
function nearestEnterableCar() {
  let best = null;
  let bestD = CFG.ENTER_RANGE;
  for (const c of parkedCars) {
    const d = Math.hypot(player.x - c.x, player.z - c.z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  // Traffic cars are stealable too.
  for (const c of traffic.all()) {
    const d = Math.hypot(player.x - c.x, player.z - c.z);
    if (d < bestD) {
      bestD = d;
      best = { trafficCar: c, x: c.x, z: c.z, heading: c.heading, speed: 0 };
    }
  }
  return best;
}

function enterCar() {
  const target = nearestEnterableCar();
  if (!target) return;
  if (target.trafficCar) {
    // Steal a traffic car: remove it from traffic, keep its mesh.
    const tc = target.trafficCar;
    const idx = traffic.cars.indexOf(tc);
    if (idx !== -1) traffic.cars.splice(idx, 1);
    // Respawn a replacement traffic car elsewhere.
    traffic.respawn();
    player.car = { mesh: tc.mesh, x: tc.x, z: tc.z, heading: tc.heading, speed: 0, stolen: true };
    addWanted(1, 'Car stolen');
    peds.scare(tc.x, tc.z, 25);
  } else {
    const idx = parkedCars.indexOf(target);
    if (idx !== -1) parkedCars.splice(idx, 1);
    player.car = { mesh: target.mesh, x: target.x, z: target.z, heading: target.heading, speed: 0, stolen: false };
  }
  player.inCar = true;
  player.x = player.car.x;
  player.z = player.car.z;
  player.heading = player.car.heading;
  playerMesh.visible = false;
  audio.click();
}

function exitCar() {
  if (!player.inCar || !player.car) return;
  const car = player.car;
  parkedCars.push({ mesh: car.mesh, x: car.x, z: car.z, heading: car.heading, speed: 0 });
  // Step out to the side of the car.
  player.x = car.x + Math.cos(car.heading) * 2.5;
  player.z = car.z - Math.sin(car.heading) * 2.5;
  player.heading = car.heading;
  player.speed = 0;
  player.car = null;
  player.inCar = false;
  playerMesh.visible = true;
  playerMesh.position.set(player.x, 0, player.z);
  audio.click();
}

// Building collision: push a circle (the player/car) out of building AABBs.
function collideBuildings(x, z, radius) {
  for (const b of city.buildings) {
    const dx = x - b.x;
    const dz = z - b.z;
    const hx = b.w / 2 + radius;
    const hz = b.d / 2 + radius;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      // Push out along the smaller penetration axis.
      const px = hx - Math.abs(dx);
      const pz = hz - Math.abs(dz);
      if (px < pz) x = b.x + (dx > 0 ? hx : -hx);
      else z = b.z + (dz > 0 ? hz : -hz);
    }
  }
  return { x, z };
}

function driveCar(dt) {
  const car = player.car;
  const { fwd, str } = input.moveAxis();
  if (fwd > 0) car.speed += CFG.CAR_ACCEL * dt;
  else if (fwd < 0) car.speed -= (car.speed > 0.5 ? CFG.CAR_BRAKE : CFG.CAR_ACCEL * 0.5) * dt;
  else car.speed *= Math.max(0, 1 - dt * 0.8); // rolling drag
  car.speed = Math.max(-12, Math.min(CFG.CAR_TOP_SPEED, car.speed));
  // Shot mode: hold a steady cruise speed so the staged scene shows motion
  // (no key is held during a screenshot, so drag would otherwise stop the car).
  if (SHOT && car.cruise) car.speed = car.cruise;
  // Steering scales with speed (less twitchy at speed) and reverses in reverse.
  const steerRate = CFG.CAR_TURN * Math.min(1, Math.abs(car.speed) / 10 + 0.2);
  car.heading += str * steerRate * dt * Math.sign(car.speed || 1);
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const fixed = collideBuildings(nx, nz, 1.4);
  // If the collision pushed us back a lot, we hit a wall — kill speed.
  if (Math.hypot(fixed.x - nx, fixed.z - nz) > 0.5) car.speed *= 0.4;
  car.x = Math.max(-CFG.CITY_HALF + 4, Math.min(CFG.CITY_HALF - 4, fixed.x));
  car.z = Math.max(-CFG.CITY_HALF + 4, Math.min(CFG.CITY_HALF - 4, fixed.z));
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  player.x = car.x;
  player.z = car.z;
  player.heading = car.heading;
  player.speed = Math.abs(car.speed);
  player.moving = Math.abs(car.speed) > 1;
  // Ram a police cruiser? (raises wanted)
  for (const c of police.all()) {
    if (Math.hypot(c.x - car.x, c.z - car.z) < 3 && Math.abs(car.speed) > 12) {
      addWanted(1, 'You rammed a police cruiser');
      car.speed *= 0.5;
    }
  }
  // Run over a ped? (the peds module handles the knockdown; we add the crime)
  for (const p of peds.all()) {
    if (p.state === 'down' && p.stateT < 0.1 && Math.hypot(p.x - car.x, p.z - car.z) < 3) {
      addWanted(1, 'Pedestrian down');
    }
  }
}

function walkPlayer(dt) {
  const { fwd, str } = input.moveAxis();
  const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
  const speed = sprint ? CFG.SPRINT_SPEED : CFG.WALK_SPEED;
  // Move relative to the camera yaw (not the player heading).
  const moveX = Math.sin(cam.yaw) * fwd + Math.cos(cam.yaw) * str;
  const moveZ = Math.cos(cam.yaw) * fwd - Math.sin(cam.yaw) * str;
  const len = Math.hypot(moveX, moveZ);
  player.moving = len > 0.1;
  if (player.moving) {
    const ux = moveX / len;
    const uz = moveZ / len;
    player.heading = Math.atan2(ux, uz);
    player.speed = speed;
    const nx = player.x + ux * speed * dt;
    const nz = player.z + uz * speed * dt;
    const fixed = collideBuildings(nx, nz, 0.6);
    player.x = Math.max(-CFG.CITY_HALF + 4, Math.min(CFG.CITY_HALF - 4, fixed.x));
    player.z = Math.max(-CFG.CITY_HALF + 4, Math.min(CFG.CITY_HALF - 4, fixed.z));
  } else {
    player.speed = 0;
  }
  playerMesh.position.set(player.x, 0, player.z);
  playerMesh.rotation.y = player.heading;
  // Walk cycle.
  const phase = performance.now() / 1000 * (player.moving ? speed * 1.4 : 0);
  playerMesh.userData.legL.rotation.x = player.moving ? Math.sin(phase) * 0.6 : 0;
  playerMesh.userData.legR.rotation.x = player.moving ? -Math.sin(phase) * 0.6 : 0;
}

// --- Combat ---
function shoot() {
  audio.gunshot();
  // Muzzle flash + tracer from the player toward the camera aim.
  const dir = { x: Math.sin(cam.yaw), z: Math.cos(cam.yaw) };
  const from = new THREE.Vector3(player.x, 1.5, player.z);
  const to = new THREE.Vector3(player.x + dir.x * 40, 1.5, player.z + dir.z * 40);
  tracer.geometry.setFromPoints([from, to]);
  tracer.material.opacity = 0.9;
  tracerTimer = 0.08;
  // Hit the nearest ped within 30 units in front of the shot.
  let best = null;
  let bestD = 30;
  for (const p of peds.all()) {
    if (p.state === 'down') continue;
    const dx = p.x - player.x;
    const dz = p.z - player.z;
    const d = Math.hypot(dx, dz);
    const dot = (dx * dir.x + dz * dir.z) / (d || 1);
    if (d < bestD && dot > 0.92) {
      bestD = d;
      best = p;
    }
  }
  if (best) {
    peds.knockDown(best);
    addWanted(1, 'Shot fired');
  } else {
    addWanted(1, 'Shot fired');
  }
  peds.scare(player.x, player.z, 35);
}

function punch() {
  audio.punch();
  // Knock down the nearest ped within 2.5 units.
  let best = null;
  let bestD = 2.5;
  for (const p of peds.all()) {
    if (p.state === 'down') continue;
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) {
    peds.knockDown(best);
    addWanted(1, 'Assault');
    peds.scare(player.x, player.z, 20);
  }
}

// --- Missions ---
missions.onComplete = (reward) => {
  player.cash += reward;
  hud.setCash(player.cash);
  audio.jingle();
  saveGame();
};
missions.onFail = () => {
  // The player can retry the same mission.
};

function startNextMission() {
  const next = missions.completed;
  if (next >= CFG.MISSION_COUNT) {
    hud.showMessage('All jobs done — you run this city now.', 5);
    return;
  }
  missions.start(next, traffic);
  const m = missions.current();
  hud.showMessage(`NEW JOB: ${m.name} — ${m.brief}`, 6);
  if (m.type === 'getaway') {
    player.wanted = 3;
    player.lastCrime = performance.now();
    hud.setStars(3);
  }
  hud.setMission(missions.objectiveText());
}

// --- Save / load ---
function saveGame() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        cash: player.cash,
        completed: missions.completed,
        x: player.x,
        z: player.z,
        wanted: player.wanted,
        health: player.health,
      }),
    );
  } catch {
    // Storage unavailable — ignore.
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    player.cash = s.cash ?? 100;
    missions.completed = s.completed ?? 0;
    player.x = s.x ?? 0;
    player.z = s.z ?? 60;
    player.wanted = s.wanted ?? 0;
    player.health = s.health ?? 100;
    hud.setCash(player.cash);
    hud.setStars(player.wanted);
    hud.setHealth(player.health);
    return true;
  } catch {
    return false;
  }
}

// --- UI: start screen + pause ---
let started = false;
let paused = false;
const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const continueBtn = document.getElementById('btn-continue');

function hasSave() {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}
if (hasSave()) continueBtn.style.display = 'inline-block';

function startGame(fromSave) {
  audio.ensure();
  audio.startMusic();
  if (fromSave) loadGame();
  started = true;
  startScreen.style.display = 'none';
  hud.setCash(player.cash);
  hud.setStars(player.wanted);
  hud.setHealth(player.health);
  hud.setMission(missions.objectiveText());
  hud.showMessage('Welcome to Neon Harbor. Press F near the Fixer to start a job. E enters a car.', 6);
}

document.getElementById('btn-new').addEventListener('click', () => {
  audio.ensure();
  audio.click();
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
  missions.completed = 0;
  player.cash = 100;
  player.wanted = 0;
  player.health = 100;
  startGame(false);
});
continueBtn.addEventListener('click', () => {
  audio.ensure();
  audio.click();
  startGame(true);
});
document.getElementById('btn-resume').addEventListener('click', () => {
  paused = false;
  pauseScreen.style.display = 'none';
  audio.click();
});
document.getElementById('btn-quit').addEventListener('click', () => {
  saveGame();
  paused = false;
  started = false;
  pauseScreen.style.display = 'none';
  startScreen.style.display = 'flex';
  audio.stopMusic();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Screenshot mode ---
function setupShot() {
  // Auto-start, deterministic scene per shot.
  started = true;
  startScreen.style.display = 'none';
  if (SHOT === 'drive') {
    // Player driving east on a downtown road, HUD + minimap live.
    const car = parkedCars[0];
    parkedCars.splice(0, 1);
    player.car = { mesh: car.mesh, x: -60, z: 0, heading: Math.PI / 2, speed: 18, cruise: 18, stolen: false };
    player.car.mesh.position.set(-60, 0, 0);
    player.car.mesh.rotation.y = Math.PI / 2;
    player.inCar = true;
    player.x = -60;
    player.z = 0;
    player.heading = Math.PI / 2;
    playerMesh.visible = false;
    cam.yaw = Math.PI / 2;
    cam.pitch = 0.32;
    missions.start(1, traffic); // The Drop — beacon visible ahead
    hud.setMission(missions.objectiveText());
  } else if (SHOT === 'foot') {
    // On foot at a downtown intersection, peds around.
    player.x = 3;
    player.z = 3;
    player.heading = Math.PI * 0.75;
    playerMesh.position.set(3, 0, 3);
    cam.yaw = Math.PI * 0.75;
    cam.pitch = 0.4;
    // Pull a few peds near the intersection.
    peds.all().slice(0, 6).forEach((p, i) => {
      p.x = 3 + (i - 2.5) * 4;
      p.z = 3 + (i % 2) * 6 - 3;
      p.mesh.position.set(p.x, 0, p.z);
    });
  } else if (SHOT === 'chase') {
    // 3 stars, player driving, two cruisers on the tail.
    const car = parkedCars[0];
    parkedCars.splice(0, 1);
    player.car = { mesh: car.mesh, x: -30, z: 60, heading: Math.PI / 2, speed: 28, cruise: 28, stolen: false };
    player.car.mesh.position.set(-30, 0, 60);
    player.car.mesh.rotation.y = Math.PI / 2;
    player.inCar = true;
    player.x = -30;
    player.z = 60;
    player.heading = Math.PI / 2;
    playerMesh.visible = false;
    player.wanted = 3;
    player.lastCrime = performance.now();
    hud.setStars(3);
    // Side camera (90° off the heading) so the pursuing cruisers are in frame.
    cam.yaw = Math.PI / 2 + Math.PI / 2;
    cam.pitch = 0.3;
    police.setWanted(3, player);
    // Place two cruisers right behind the player on the same road.
    const cruisers = police.all();
    if (cruisers[0]) {
      cruisers[0].x = -45;
      cruisers[0].z = 57;
      cruisers[0].heading = Math.PI / 2;
      cruisers[0].mesh.position.set(-45, 0, 57);
      cruisers[0].mesh.rotation.y = Math.PI / 2;
    }
    if (cruisers[1]) {
      cruisers[1].x = -52;
      cruisers[1].z = 63;
      cruisers[1].heading = Math.PI / 2;
      cruisers[1].mesh.position.set(-52, 0, 63);
      cruisers[1].mesh.rotation.y = Math.PI / 2;
    }
  } else if (SHOT === 'mission') {
    // Mission run: The Big Score, beacon pillar visible AHEAD, player driving to it.
    // First package is at (-177, -180); start west of it on the same road, heading west.
    const car = parkedCars[0];
    parkedCars.splice(0, 1);
    player.car = { mesh: car.mesh, x: -60, z: -180, heading: -Math.PI / 2, speed: 16, cruise: 16, stolen: false };
    player.car.mesh.position.set(-60, 0, -180);
    player.car.mesh.rotation.y = -Math.PI / 2;
    player.inCar = true;
    player.x = -60;
    player.z = -180;
    player.heading = -Math.PI / 2;
    playerMesh.visible = false;
    cam.yaw = -Math.PI / 2;
    cam.pitch = 0.3;
    missions.start(5, traffic);
    hud.setMission(missions.objectiveText());
  }
  hud.setCash(player.cash);
  hud.setHealth(player.health);
  hud.setMission(missions.objectiveText());
}

if (SHOT) setupShot();

// --- Main loop ---
let last = performance.now();
let saveTimer = 0;
let shotFrames = 0;
const clock = { dt: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - last) / 1000;
  last = now;
  const dt = Math.min(rawDt, 0.05); // clamp: headless SwiftShader runs slow
  clock.dt = dt;

  if (!started || paused) {
    // Still render the scene behind the menus.
    renderer.render(scene, camera);
    input.endFrame();
    return;
  }

  try {
    // Pause.
    if (input.wasPressed('Escape') || input.wasPressed('KeyP')) {
      paused = true;
      pauseScreen.style.display = 'flex';
      input.endFrame();
      return;
    }

    // Enter / exit car.
    if (input.wasPressed('KeyE')) {
      if (player.inCar) exitCar();
      else enterCar();
    }

    // F: photo (photo mission) or punch / start mission.
    if (input.wasPressed('KeyF')) {
      const m = missions.current();
      if (missions.isActive() && m && m.type === 'photo') {
        player.pressedPhoto = true;
      } else if (!missions.isActive()) {
        startNextMission();
      } else if (!player.inCar) {
        punch();
      }
    }

    // G or click: shoot (on foot only).
    if (!player.inCar && (input.wasPressed('KeyG') || input.wasPressed('MouseLeft'))) {
      shoot();
    }

    // Movement.
    if (player.inCar) driveCar(dt);
    else walkPlayer(dt);

    // World updates.
    const playerCarRef = player.inCar ? { x: player.x, z: player.z, speed: player.car.speed } : null;
    traffic.update(dt, player, player.inCar);
    updateWanted(dt);
    police.update(dt, player, player.inCar, player.speed);
    // Chase shot: hold the cruisers in formation behind the player (scripted,
    // so the flashing light bars are visible in frame).
    if (SHOT === 'chase') {
      const h = player.heading;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      const rx = -Math.cos(h);
      const rz = Math.sin(h);
      const formation = [
        { back: 8, lat: -3 },
        { back: 12, lat: -3 },
        { back: 16, lat: 0 },
      ];
      police.all().forEach((c, i) => {
        const f = formation[i % formation.length];
        c.x = player.x - fx * f.back + rx * f.lat;
        c.z = player.z - fz * f.back + rz * f.lat;
        c.heading = h;
        c.mesh.position.set(c.x, 0, c.z);
        c.mesh.rotation.y = h;
      });
    }
    peds.update(dt, traffic.all(), playerCarRef);
    const missionResult = missions.update(dt, player, player.wanted);
    if (missionResult) {
      hud.showMessage(missionResult.message, 5);
      hud.setMission(missions.objectiveText());
      if (missionResult.done && missions.completed < CFG.MISSION_COUNT) {
        hud.showMessage(missionResult.message + ' Press F for the next job.', 5);
      }
    }

    // Tracer fade.
    if (tracerTimer > 0) {
      tracerTimer -= dt;
      if (tracerTimer <= 0) tracer.material.opacity = 0;
    }

    // Audio.
    audio.setEngine(player.inCar ? Math.abs(player.car.speed) / CFG.CAR_TOP_SPEED : 0, player.inCar);
    const nearestPolice = police.nearestDistance(player.x, player.z);
    audio.setSiren(player.wanted > 0 && nearestPolice < 80, dt);
    // Sirens scare peds.
    if (player.wanted > 0 && nearestPolice < 40) peds.scare(player.x, player.z, 30);

    // HUD.
    hud.setSpeed(player.inCar ? Math.abs(player.car.speed) * 3.6 : 0, player.inCar);
    hud.setMission(missions.objectiveText());
    hud.update(dt);
    const beacon = missions.beaconPos();
    const courier = missions.isActive() && missions.current() && missions.current().type === 'tail' ? missions.courier : null;
    hud.drawMinimap(player, beacon, police.all(), traffic.all(), courier);
    // Interaction prompt.
    if (!player.inCar) {
      const near = nearestEnterableCar();
      hud.setPrompt(near ? 'Press E to enter the car' : missions.isActive() ? '' : 'Press F to start a job');
    } else {
      hud.setPrompt('Press E to exit the car');
    }

    // Camera.
    updateCamera(dt);

    // Periodic save.
    saveTimer += dt;
    if (saveTimer > 10) {
      saveTimer = 0;
      saveGame();
    }
  } finally {
    // Always end the frame, even if an update threw — a stale key press must
    // never fire twice (the v1 E-exit bug).
    input.endFrame();
  }

  renderer.render(scene, camera);

  // Screenshot readiness: after ~90 frames the scene is settled.
  if (SHOT) {
    shotFrames++;
    if (shotFrames === 90) {
      window.__shotReady = true;
    }
  }
}

// Initial camera + first render.
updateCamera(0.016);
renderer.render(scene, camera);
requestAnimationFrame(frame);

// Expose a tiny debug hook for the playtest harness.
window.__game = {
  player,
  missions,
  traffic,
  police,
  peds,
  get started() {
    return started;
  },
  setStarted(v) {
    started = v;
  },
  startGame,
  enterCar,
  exitCar,
  shoot,
  punch,
  startNextMission,
  saveGame,
  loadGame,
};
