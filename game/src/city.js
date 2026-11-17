// City generation: painted ground texture, instanced buildings in four districts,
// a landmark tower (Harbor Spire), a central park, a container yard + pier, and
// street props. Everything is procedural — no external assets.
import * as THREE from 'three';
import { CFG } from './config.js';
import { roadCoord } from './roads.js';

const S = CFG.ROAD_SPACING;
const N = CFG.ROAD_COUNT;

// District of a block (bi, bj in 0..5): downtown centre, park, industrial south,
// midtown elsewhere.
export function districtOf(bi, bj) {
  const cx = Math.abs(bi - 2.5);
  const cz = Math.abs(bj - 2.5);
  if (bi === 2 && bj === 2) return 'park';
  if (cx <= 1 && cz <= 1) return 'downtown';
  if (bj >= 4) return 'industrial';
  return 'midtown';
}

function districtColors(d) {
  switch (d) {
    case 'downtown':
      return [0x2e3a5c, 0x3a4a6b, 0x46586e, 0x5a6b8c, 0x33415e];
    case 'midtown':
      return [0x7a5a4a, 0x8c6a52, 0x6b5a6e, 0x5a6e7a, 0x8c7a5a];
    case 'industrial':
      return [0x5a5a5a, 0x6e6a5a, 0x4a5a6e, 0x7a6a5a, 0x5a6e5a];
    default:
      return [0x6a7a5a];
  }
}

// Paint the ground texture on a canvas: asphalt roads with lane dashes, sidewalks,
// block fills by district, park grass, pier planks. 1024x1024 over 480 world units.
export function makeGroundTexture() {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const scale = size / CFG.GROUND_SIZE; // px per world unit
  const W = (x) => (x + CFG.GROUND_SIZE / 2) * scale; // world -> px

  // Base: sidewalk grey.
  g.fillStyle = '#6b6560';
  g.fillRect(0, 0, size, size);

  // Blocks by district.
  for (let bi = 0; bi < N - 1; bi++) {
    for (let bj = 0; bj < N - 1; bj++) {
      const x0 = roadCoord(bi) + CFG.ROAD_HALF;
      const x1 = roadCoord(bi + 1) - CFG.ROAD_HALF;
      const z0 = roadCoord(bj) + CFG.ROAD_HALF;
      const z1 = roadCoord(bj + 1) - CFG.ROAD_HALF;
      const d = districtOf(bi, bj);
      g.fillStyle =
        d === 'park' ? '#4a7a3a' : d === 'industrial' ? '#7a7268' : d === 'downtown' ? '#5a5560' : '#6e6258';
      g.fillRect(W(x0), W(z0), (x1 - x0) * scale, (z1 - z0) * scale);
      // Sidewalk border inside the block edge.
      g.strokeStyle = '#8a837c';
      g.lineWidth = 2;
      g.strokeRect(W(x0), W(z0), (x1 - x0) * scale, (z1 - z0) * scale);
    }
  }

  // Roads (asphalt) with centre dashes.
  g.fillStyle = '#2e2a28';
  for (let i = 0; i < N; i++) {
    const r = roadCoord(i);
    g.fillRect(W(r - CFG.ROAD_HALF), 0, CFG.ROAD_WIDTH * scale, size);
    g.fillRect(0, W(r - CFG.ROAD_HALF), size, CFG.ROAD_WIDTH * scale);
  }
  g.fillStyle = '#e8d44d';
  for (let i = 0; i < N; i++) {
    const r = roadCoord(i);
    for (let d = -CFG.CITY_HALF; d < CFG.CITY_HALF; d += 12) {
      g.fillRect(W(r) - 1, W(d), 2, 6 * scale);
      g.fillRect(W(d), W(r) - 1, 6 * scale, 2);
    }
  }
  // Crosswalks at every intersection.
  g.fillStyle = '#d8d4cc';
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = roadCoord(i);
      const z = roadCoord(j);
      for (let k = -2; k <= 2; k++) {
        g.fillRect(W(x + k * 2) - 1, W(z - CFG.ROAD_HALF - 2), 2, 3 * scale);
        g.fillRect(W(x + k * 2) - 1, W(z + CFG.ROAD_HALF - 1), 2, 3 * scale);
      }
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Build the whole city into a THREE.Group. Returns { group, buildings, landmark }.
// buildings: array of {x, z, w, d, h} for collision/placement reference.
export function buildCity(scene, rng) {
  const group = new THREE.Group();
  const buildings = [];

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CFG.GROUND_SIZE, CFG.GROUND_SIZE),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Buildings: one InstancedMesh per colour bucket is overkill — use a single
  // InstancedMesh with per-instance colour.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const boxMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const placements = [];
  for (let bi = 0; bi < N - 1; bi++) {
    for (let bj = 0; bj < N - 1; bj++) {
      const d = districtOf(bi, bj);
      if (d === 'park') continue;
      const x0 = roadCoord(bi) + CFG.ROAD_HALF + 3;
      const x1 = roadCoord(bi + 1) - CFG.ROAD_HALF - 3;
      const z0 = roadCoord(bj) + CFG.ROAD_HALF + 3;
      const z1 = roadCoord(bj + 1) - CFG.ROAD_HALF - 3;
      const colours = districtColors(d);
      if (d === 'downtown') {
        // One tall tower per downtown block, varied height.
        const h = rng.range(38, 78);
        const w = rng.range(20, 30);
        const depth = rng.range(20, 30);
        placements.push({
          x: (x0 + x1) / 2,
          z: (z0 + z1) / 2,
          w,
          d: depth,
          h,
          color: rng.pick(colours),
        });
      } else if (d === 'industrial') {
        // Two low wide warehouses.
        for (let k = 0; k < 2; k++) {
          placements.push({
            x: (x0 + x1) / 2 + (k === 0 ? -9 : 9),
            z: (z0 + z1) / 2,
            w: 14,
            d: 30,
            h: rng.range(7, 11),
            color: rng.pick(colours),
          });
        }
      } else {
        // Midtown: 2-4 mid-rise blocks.
        const count = rng.int(2, 4);
        for (let k = 0; k < count; k++) {
          placements.push({
            x: rng.range(x0 + 8, x1 - 8),
            z: rng.range(z0 + 8, z1 - 8),
            w: rng.range(10, 16),
            d: rng.range(10, 16),
            h: rng.range(12, 26),
            color: rng.pick(colours),
          });
        }
      }
    }
  }
  const inst = new THREE.InstancedMesh(boxGeo, boxMat, placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  placements.forEach((p, idx) => {
    m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.w, p.h, p.d));
    inst.setMatrixAt(idx, m);
    inst.setColorAt(idx, col.setHex(p.color));
    buildings.push(p);
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);

  // Window strips on downtown towers (one InstancedMesh, cheap glow at dusk).
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  const winGeo = new THREE.PlaneGeometry(1, 1);
  const winPlacements = [];
  placements.forEach((p) => {
    if (p.h < 30) return;
    const rows = Math.floor(p.h / 6);
    for (let r = 0; r < rows; r++) {
      winPlacements.push({ x: p.x, y: 4 + r * 6, z: p.z + p.d / 2 + 0.06, w: p.w * 0.7 });
    }
  });
  const winInst = new THREE.InstancedMesh(winGeo, winMat, winPlacements.length);
  winPlacements.forEach((w, idx) => {
    m.compose(new THREE.Vector3(w.x, w.y, w.z), q, new THREE.Vector3(w.w, 0.7, 1));
    winInst.setMatrixAt(idx, m);
  });
  winInst.instanceMatrix.needsUpdate = true;
  group.add(winInst);

  // LANDMARK: Harbor Spire — a tall tapered tower with a glowing crown, at the
  // downtown edge (block 3,2), visible from across the city.
  const spire = new THREE.Group();
  const spireBase = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 10, 95, 8),
    new THREE.MeshLambertMaterial({ color: 0x3a4a6e }),
  );
  spireBase.position.y = 47.5;
  spire.add(spireBase);
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff5a8a }),
  );
  crown.position.y = 100;
  spire.add(crown);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 14, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd27a }),
  );
  tip.position.y = 112;
  spire.add(tip);
  const spireX = roadCoord(3) + 24;
  const spireZ = roadCoord(2) + 24;
  spire.position.set(spireX, 0, spireZ);
  group.add(spire);

  // PARK: trees + a pond in block (2,2). Two InstancedMeshes (trunks, leaves).
  const parkX0 = roadCoord(2) + CFG.ROAD_HALF + 4;
  const parkZ0 = roadCoord(2) + CFG.ROAD_HALF + 4;
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 3, 5);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
  const leafGeo = new THREE.ConeGeometry(2.6, 6, 6);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e6b2e });
  const treeSpots = [];
  for (let t = 0; t < 26; t++) {
    treeSpots.push({ x: rng.range(parkX0, parkX0 + 36), z: rng.range(parkZ0, parkZ0 + 36) });
  }
  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
  const leafInst = new THREE.InstancedMesh(leafGeo, leafMat, treeSpots.length);
  treeSpots.forEach((s, idx) => {
    m.compose(new THREE.Vector3(s.x, 1.5, s.z), q, new THREE.Vector3(1, 1, 1));
    trunkInst.setMatrixAt(idx, m);
    m.compose(new THREE.Vector3(s.x, 5.5, s.z), q, new THREE.Vector3(1, 1, 1));
    leafInst.setMatrixAt(idx, m);
  });
  trunkInst.instanceMatrix.needsUpdate = true;
  leafInst.instanceMatrix.needsUpdate = true;
  group.add(trunkInst);
  group.add(leafInst);
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(9, 24),
    new THREE.MeshLambertMaterial({ color: 0x2a6b8c }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(parkX0 + 18, 0.05, parkZ0 + 18);
  group.add(pond);

  // CONTAINER YARD + PIER (south edge, z = 200): one InstancedMesh, per-instance colour.
  const contColors = [0xc23b2e, 0x2e7ac2, 0x3aa655, 0xd8a02e, 0x7a4ac2];
  const contGeo = new THREE.BoxGeometry(6, 2.6, 2.6);
  const contMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const contInst = new THREE.InstancedMesh(contGeo, contMat, 22);
  for (let i = 0; i < 22; i++) {
    const row = Math.floor(i / 11);
    const colIdx = i % 11;
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i % 2) * 0.06, 0));
    m.compose(
      new THREE.Vector3(-150 + colIdx * 14, 1.3 + (i % 3 === 0 ? 2.6 : 0), 186 + row * 8),
      rot,
      new THREE.Vector3(1, 1, 1),
    );
    contInst.setMatrixAt(i, m);
    contInst.setColorAt(i, col.setHex(contColors[i % contColors.length]));
  }
  contInst.instanceMatrix.needsUpdate = true;
  if (contInst.instanceColor) contInst.instanceColor.needsUpdate = true;
  group.add(contInst);
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(90, 1, 14),
    new THREE.MeshLambertMaterial({ color: 0x8a6a4a }),
  );
  pier.position.set(120, 0.5, 204);
  group.add(pier);
  // A couple of moored boats (simple hulls) by the pier.
  const hullGeo = new THREE.BoxGeometry(10, 2, 3.5);
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
  for (let b = 0; b < 2; b++) {
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.set(100 + b * 22, 1, 216);
    group.add(hull);
  }

  // STREET PROPS: lamp posts along roads (two InstancedMeshes) + traffic lights.
  const lampPoleGeo = new THREE.CylinderGeometry(0.15, 0.2, 7, 5);
  const lampPoleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const lampHeadGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const lampSpots = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N - 1; j++) {
      lampSpots.push({ x: roadCoord(i) + CFG.ROAD_HALF + 1, z: (roadCoord(j) + roadCoord(j + 1)) / 2 });
    }
  }
  const poleInst = new THREE.InstancedMesh(lampPoleGeo, lampPoleMat, lampSpots.length);
  const headInst = new THREE.InstancedMesh(lampHeadGeo, lampHeadMat, lampSpots.length);
  lampSpots.forEach((s, idx) => {
    m.compose(new THREE.Vector3(s.x, 3.5, s.z), q, new THREE.Vector3(1, 1, 1));
    poleInst.setMatrixAt(idx, m);
    m.compose(new THREE.Vector3(s.x, 7.2, s.z), q, new THREE.Vector3(1, 1, 1));
    headInst.setMatrixAt(idx, m);
  });
  poleInst.instanceMatrix.needsUpdate = true;
  headInst.instanceMatrix.needsUpdate = true;
  group.add(poleInst);
  group.add(headInst);
  // Traffic lights at a few downtown intersections.
  const lightPoleGeo = new THREE.CylinderGeometry(0.18, 0.18, 5.5, 5);
  const lightBoxGeo = new THREE.BoxGeometry(0.8, 2.2, 0.8);
  const lightBoxMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const bulbGeo = new THREE.SphereGeometry(0.28, 6, 5);
  const bulbMats = [0xff3b30, 0xffcc00, 0x34c759].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  [[2, 2], [3, 3], [4, 2], [2, 4]].forEach(([i, j]) => {
    const x = roadCoord(i) + CFG.ROAD_HALF + 0.6;
    const z = roadCoord(j) - CFG.ROAD_HALF - 0.6;
    const pole = new THREE.Mesh(lightPoleGeo, lampPoleMat);
    pole.position.set(x, 2.75, z);
    group.add(pole);
    const box = new THREE.Mesh(lightBoxGeo, lightBoxMat);
    box.position.set(x, 6.2, z);
    group.add(box);
    bulbMats.forEach((bm, k) => {
      const bulb = new THREE.Mesh(bulbGeo, bm);
      bulb.position.set(x, 6.9 - k * 0.7, z + 0.45);
      group.add(bulb);
    });
  });

  // Sky: big gradient dome (BackSide sphere with vertex colours) + fog.
  const skyGeo = new THREE.SphereGeometry(900, 16, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(CFG.SKY_TOP) },
      bottom: { value: new THREE.Color(CFG.SKY_BOTTOM) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0, 0.55, h)), 1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  group.add(sky);

  // Lighting.
  const sun = new THREE.DirectionalLight(CFG.SUN_COLOR, CFG.SUN_INTENSITY);
  sun.position.set(-140, 180, 60);
  group.add(sun);
  const hemi = new THREE.HemisphereLight(CFG.HEMI_SKY, CFG.HEMI_GROUND, CFG.HEMI_INTENSITY);
  group.add(hemi);

  scene.add(group);
  scene.fog = new THREE.Fog(CFG.FOG_COLOR, 220, 700);

  return { group, buildings, landmark: { x: spireX, z: spireZ } };
}
