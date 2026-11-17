// Keyboard + mouse input. Tracks held keys, pressed-this-frame keys, and mouse
// orbit deltas. The camera auto-follow (main.js) reads `lastMouseMove` to know
// when the player is actively orbiting — auto-follow never fights the mouse.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.lastMouseMove = 0; // performance.now() of the last mouse drag
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true;
      if (e.button === 0) this.pressed.add('MouseLeft');
    });
    window.addEventListener('mouseup', () => {
      this.mouseDown = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseDown) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
      this.lastMouseMove = performance.now();
    });
    // Touch: drag to orbit.
    canvas.addEventListener('touchstart', (e) => {
      this.mouseDown = true;
      this.lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    });
    canvas.addEventListener('touchmove', (e) => {
      if (!this.lastTouch) return;
      const t = e.touches[0];
      this.mouseDX += t.clientX - this.lastTouch.x;
      this.mouseDY += t.clientY - this.lastTouch.y;
      this.lastTouch = { x: t.clientX, y: t.clientY };
      this.lastMouseMove = performance.now();
      e.preventDefault();
    });
    canvas.addEventListener('touchend', () => {
      this.mouseDown = false;
      this.lastTouch = null;
    });
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  // Consume the per-frame state (call once per frame, after reading).
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  // Axis helpers: forward/back and strafe, from WASD + arrows.
  moveAxis() {
    let fwd = 0;
    let str = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) fwd += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) fwd -= 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) str -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) str += 1;
    return { fwd, str };
  }
}
