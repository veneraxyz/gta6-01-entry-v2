// HUD: wanted stars, cash, health, mission tracker, speed, and a canvas minimap.
// The minimap is a top-down view of the city: roads, the player arrow, the mission
// beacon, police blips (red/blue) and traffic dots.
import { CFG } from './config.js';
import { roadCoord } from './roads.js';

export class HUD {
  constructor() {
    this.starsEl = document.getElementById('stars');
    this.cashEl = document.getElementById('cash');
    this.healthEl = document.getElementById('health-fill');
    this.missionEl = document.getElementById('mission-text');
    this.speedEl = document.getElementById('speed');
    this.promptEl = document.getElementById('prompt');
    this.messageEl = document.getElementById('message');
    this.mapCanvas = document.getElementById('minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.messageTimer = 0;
  }

  setStars(n) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < n ? '★' : '☆';
    this.starsEl.textContent = s;
    this.starsEl.style.color = n >= 3 ? '#ff4444' : n > 0 ? '#ffcc00' : '#ffffff';
  }

  setCash(amount) {
    this.cashEl.textContent = '$' + Math.floor(amount).toLocaleString('en-US');
  }

  setHealth(hp) {
    const pct = Math.max(0, Math.min(100, hp));
    this.healthEl.style.width = pct + '%';
    this.healthEl.style.background = pct > 50 ? '#34c759' : pct > 25 ? '#ffcc00' : '#ff4444';
  }

  setMission(text) {
    this.missionEl.textContent = text;
  }

  setSpeed(kmh, inCar) {
    this.speedEl.textContent = inCar ? Math.round(kmh) + ' km/h' : '';
  }

  setPrompt(text) {
    this.promptEl.textContent = text || '';
  }

  showMessage(text, seconds = 4) {
    this.messageEl.textContent = text;
    this.messageEl.style.opacity = '1';
    this.messageTimer = seconds;
  }

  update(dt) {
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.messageEl.style.opacity = '0';
    }
  }

  drawMinimap(player, beacon, police, traffic, courier) {
    const ctx = this.mapCtx;
    const W = this.mapCanvas.width;
    const H = this.mapCanvas.height;
    const scale = W / (CFG.CITY_HALF * 2);
    const toMap = (x, z) => ({ x: (x + CFG.CITY_HALF) * scale, y: (z + CFG.CITY_HALF) * scale });
    // Background.
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);
    // Roads.
    ctx.strokeStyle = '#4a4a6a';
    ctx.lineWidth = 2;
    for (let i = 0; i < CFG.ROAD_COUNT; i++) {
      const r = roadCoord(i);
      const p = toMap(r, 0);
      ctx.beginPath();
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, H);
      ctx.stroke();
      const q = toMap(0, r);
      ctx.beginPath();
      ctx.moveTo(0, q.y);
      ctx.lineTo(W, q.y);
      ctx.stroke();
    }
    // Traffic dots (white).
    ctx.fillStyle = '#cccccc';
    for (const c of traffic) {
      const p = toMap(c.x, c.z);
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    // Police blips (red/blue, flashing).
    const flash = Math.floor(performance.now() / 300) % 2 === 0;
    ctx.fillStyle = flash ? '#ff3333' : '#3366ff';
    for (const c of police) {
      const p = toMap(c.x, c.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Courier (yellow) for the tail mission.
    if (courier) {
      const p = toMap(courier.x, courier.z);
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mission beacon (purple).
    if (beacon) {
      const p = toMap(beacon.x, beacon.z);
      ctx.fillStyle = '#b44dff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Player arrow (green, rotated by heading).
    const pp = toMap(player.x, player.z);
    ctx.save();
    ctx.translate(pp.x, pp.y);
    ctx.rotate(player.heading);
    ctx.fillStyle = '#34c759';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
