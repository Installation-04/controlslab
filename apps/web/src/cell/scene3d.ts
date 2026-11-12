// SPDX-License-Identifier: AGPL-3.0-only
/**
 * three.js view of a factory cell. All geometry is built from primitives
 * (original artwork). The view is a pure renderer + picking layer: it never
 * owns the simulation, it pulls a `FrameState` every animation frame.
 */
import { SPECS, resolveParams, type EntityDef, type Item } from '@controlslab/factory';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface FrameState {
  items: Item[];
  belt: Record<string, number>;
  stroke: Record<string, number>;
  pressed(id: string): boolean;
  inputs: Record<string, boolean>;
  outputs: Record<string, boolean | number>;
  bins: Record<string, number>;
  motorSpeed: number;
  running: boolean;
}

export interface ViewCallbacks {
  onSelect(id: string | null): void;
  onMove(id: string, x: number, z: number): void;
  onPress(id: string): void;
  onRelease(id: string): void;
  onOpenPanel(id: string): void;
}

export const GRID = 0.25;
export const snap = (v: number) => Math.round(v / GRID) * GRID;
const BELT_Y = 0.5;

type Updater = (f: FrameState, dtMs: number) => void;
interface Built {
  group: THREE.Group;
  update?: Updater;
}

const mat = (color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...opts });
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
};
const cyl = (r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  mesh.position.set(x, y, z);
  return mesh;
};

const COLORS: Record<string, number> = { green: 0x2fb344, red: 0xe03131, amber: 0xfab005, white: 0xf1f3f5, black: 0x212529 };
const KIND_COLOR = { plastic: 0x4c8dff, metal: 0xaab4be, cardboard: 0xc8a26a } as const;

export function makeLabel(text: string, color = '#0f2a43', scale = 0.5): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.roundRect(4, 8, 248, 48, 12);
  g.fill();
  g.fillStyle = color;
  let size = 30;
  g.font = `bold ${size}px system-ui, sans-serif`;
  while (g.measureText(text).width > 228 && size > 12) {
    size -= 2;
    g.font = `bold ${size}px system-ui, sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(scale * 2, scale * 0.5, 1);
  s.renderOrder = 10;
  s.userData.text = text;
  return s;
}

function stripeTexture(length: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a4048';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#555d66';
  g.fillRect(0, 0, 8, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(Math.max(1, length / 0.2), 1);
  return t;
}

function build(e: EntityDef): Built {
  const p = resolveParams(e);
  const g = new THREE.Group();
  const steel = mat(0x8d98a3, { metalness: 0.5 });
  const dark = mat(0x2b3138);
  let update: Updater | undefined;
  switch (e.type) {
    case 'conveyor': {
      const L = Number(p.length);
      const tex = stripeTexture(L);
      g.add(box(L, 0.1, 0.5, steel, 0, BELT_Y - 0.1, 0));
      const belt = box(L - 0.04, 0.03, 0.42, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), 0, BELT_Y - 0.035, 0);
      g.add(belt);
      g.add(box(L, 0.1, 0.04, steel, 0, BELT_Y - 0.03, 0.23), box(L, 0.1, 0.04, steel, 0, BELT_Y - 0.03, -0.23));
      for (const sx of [-L / 2 + 0.15, L / 2 - 0.15]) for (const sz of [-0.2, 0.2]) g.add(box(0.06, BELT_Y - 0.15, 0.06, dark, sx, (BELT_Y - 0.15) / 2, sz));
      g.add(cyl(0.05, 0.46, dark, L / 2, BELT_Y - 0.1, 0).rotateX(Math.PI / 2), cyl(0.05, 0.46, dark, -L / 2, BELT_Y - 0.1, 0).rotateX(Math.PI / 2));
      const speed = Number(p.speed);
      update = (f, dt) => {
        // 1 texture tile = 0.2 m of belt
        tex.offset.x -= ((f.belt[e.id] ?? 0) * speed * dt) / 1000 / 0.2;
      };
      break;
    }
    case 'spawner': {
      const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.12, 0.45, 4, 1, true), mat(0x6f7c89, { side: THREE.DoubleSide }));
      hopper.rotation.y = Math.PI / 4;
      hopper.position.y = BELT_Y + 0.55;
      g.add(hopper);
      for (const sx of [-0.22, 0.22]) for (const sz of [-0.22, 0.22]) g.add(box(0.04, BELT_Y + 0.4, 0.04, dark, sx, (BELT_Y + 0.4) / 2, sz));
      break;
    }
    case 'photo': {
      g.add(cyl(0.02, 0.5, dark, 0, 0.25, 0), box(0.12, 0.1, 0.12, mat(0x1c7ed6), 0, 0.55, 0));
      const range = Number(p.range);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.55 });
      const beam = box(range, 0.012, 0.012, beamMat, range / 2, 0.55, 0);
      g.add(beam);
      update = (f) => {
        beamMat.color.set(f.inputs[e.io?.detect ?? ''] ? 0x37d67a : 0xff3b3b);
      };
      break;
    }
    case 'prox': {
      const body = cyl(0.04, 0.16, mat(0xc9a227, { metalness: 0.6 }), 0.06, 0.55, 0);
      body.rotation.z = Math.PI / 2;
      const tip = cyl(0.035, 0.02, mat(0x222222), 0.15, 0.55, 0);
      tip.rotation.z = Math.PI / 2;
      g.add(cyl(0.02, 0.5, dark, 0, 0.25, 0), body, tip);
      update = (f) => {
        (tip.material as THREE.MeshStandardMaterial).color.set(f.inputs[e.io?.detect ?? ''] ? 0x37d67a : 0x222222);
        (tip.material as THREE.MeshStandardMaterial).emissive.set(f.inputs[e.io?.detect ?? ''] ? 0x37d67a : 0x000000);
      };
      break;
    }
    case 'pusher': {
      const S = Number(p.stroke);
      g.add(box(0.3, 0.26, 0.3, mat(0x5c6773), -0.15, BELT_Y + 0.1, 0));
      const rod = box(1, 0.05, 0.05, steel, 0.5, BELT_Y + 0.1, 0);
      const plate = box(0.1, 0.22, 0.3, mat(0xe8590c), 0.05, BELT_Y + 0.1, 0);
      g.add(rod, plate, box(0.3, BELT_Y - 0.1, 0.3, dark, -0.15, (BELT_Y - 0.1) / 2, 0));
      update = (f) => {
        const reach = 0.05 + (f.stroke[e.id] ?? 0) * S;
        plate.position.x = reach;
        rod.scale.x = Math.max(0.001, reach);
        rod.position.x = reach / 2;
      };
      break;
    }
    case 'button': {
      g.add(cyl(0.05, 0.9, dark, 0, 0.45, 0), cyl(0.09, 0.05, steel, 0, 0.92, 0));
      const cap = cyl(0.065, 0.05, mat(COLORS[String(p.color)] ?? 0x2fb344), 0, 0.97, 0);
      g.add(cap);
      update = (f) => {
        cap.position.y = f.pressed(e.id) ? 0.945 : 0.97;
      };
      break;
    }
    case 'light': {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), mat(COLORS[String(p.color)] ?? 0x2fb344, { emissive: 0x000000 }));
      lamp.position.y = 1.0;
      g.add(cyl(0.025, 1.0, dark, 0, 0.5, 0), lamp);
      update = (f) => {
        const on = !!f.outputs[e.io?.on ?? ''];
        (lamp.material as THREE.MeshStandardMaterial).emissive.set(on ? (COLORS[String(p.color)] ?? 0x2fb344) : 0x000000);
        (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.2 : 0;
      };
      break;
    }
    case 'stacklight': {
      g.add(cyl(0.025, 1.0, dark, 0, 0.5, 0));
      const lamps = (['green', 'amber', 'red'] as const).map((c, i) => {
        const m = mat(COLORS[c]!, { emissive: 0x000000 });
        g.add(cyl(0.07, 0.09, m, 0, 1.05 + i * 0.1, 0));
        return { c, m };
      });
      update = (f) => {
        for (const l of lamps) {
          const on = !!f.outputs[e.io?.[l.c] ?? ''];
          l.m.emissive.set(on ? COLORS[l.c]! : 0x000000);
          l.m.emissiveIntensity = on ? 1.4 : 0;
        }
      };
      break;
    }
    case 'bin': {
      const S = Number(p.size);
      const wall = mat(0x2f9e8f);
      g.add(box(S, 0.02, S, wall, 0, 0.01, 0));
      g.add(box(S, 0.28, 0.03, wall, 0, 0.14, S / 2), box(S, 0.28, 0.03, wall, 0, 0.14, -S / 2), box(0.03, 0.28, S, wall, S / 2, 0.14, 0), box(0.03, 0.28, S, wall, -S / 2, 0.14, 0));
      const label = makeLabel('0', '#0b6b5e', 0.4);
      label.position.set(0, 0.55, 0);
      g.add(label);
      update = (f) => {
        const n = `${f.bins[e.id] ?? 0}`;
        if (label.userData.text !== n) {
          const next = makeLabel(n, '#0b6b5e', 0.4);
          label.material.map = (next.material as THREE.SpriteMaterial).map;
          label.userData.text = n;
        }
      };
      break;
    }
    case 'panel': {
      const body = mat(0xb9c2cb, { metalness: 0.3 });
      g.add(box(0.35, 1.7, 0.8, body, 0, 0.85, 0));
      g.add(box(0.02, 1.55, 0.7, mat(0xdde3e8), 0.185, 0.85, 0));
      const run = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), mat(0x2fb344, { emissive: 0x000000 }));
      run.position.set(0.21, 1.4, -0.15);
      const bad = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), mat(0xe03131, { emissive: 0x000000 }));
      bad.position.set(0.21, 1.4, 0.15);
      g.add(run, bad, box(0.01, 0.35, 0.4, mat(0x1b2733), 0.2, 1.0, 0));
      update = (f) => {
        (run.material as THREE.MeshStandardMaterial).emissive.set(f.motorSpeed > 0.05 ? 0x2fb344 : 0x000000);
        (run.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.2;
      };
      break;
    }
  }
  const label = makeLabel(e.name ?? e.id, '#0f2a43', e.type === 'panel' ? 0.55 : 0.4);
  const spec = SPECS[e.type];
  const [along] = spec.size(p);
  label.position.set(0, e.type === 'panel' ? 1.95 : e.type === 'conveyor' ? 0.9 : e.type === 'bin' ? 0.8 : 1.35, 0);
  void along;
  label.userData.isLabel = true;
  g.add(label);
  g.rotation.y = (-e.rot * Math.PI) / 180;
  g.position.set(e.x, 0, e.z);
  g.userData.entityId = e.id;
  return { group: g, update };
}

const sigOf = (e: EntityDef) => JSON.stringify([e.type, e.params, e.rot, e.name, e.io && Object.keys(e.io).length]);

export class CellView3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly entities = new Map<string, Built & { sig: string; e: EntityDef }>();
  private readonly itemMeshes = new Map<number, THREE.Mesh>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly highlight = new THREE.BoxHelper(new THREE.Object3D(), 0xffb000);
  private selected: string | null = null;
  private editable = true;
  private dragging: { id: string; dx: number; dz: number; moved: boolean } | null = null;
  private pressedId: string | null = null;
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private readonly ro: ResizeObserver;
  /** Test hook: entity → screen position (px), used by e2e to drag precisely. */
  readonly debug = { frames: 0 };

  constructor(
    private readonly container: HTMLElement,
    private readonly cb: ViewCallbacks,
    private readonly getFrame: () => FrameState,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xe9eef3);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0.5, 5.2, 6.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.3, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 20;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, 8, 3);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0xd5dce3, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(30, 120, 0x9aa7b4, 0xc0c9d2);
    (grid.material as THREE.Material).opacity = 0.55;
    (grid.material as THREE.Material).transparent = true;
    this.scene.add(grid);
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('dblclick', this.onDbl);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setEditable(v: boolean) {
    this.editable = v;
  }

  setSelected(id: string | null) {
    this.selected = id;
    this.updateHighlight();
  }

  setEntities(list: EntityDef[]) {
    const keep = new Set(list.map((e) => e.id));
    for (const [id, b] of this.entities) {
      if (!keep.has(id)) {
        this.scene.remove(b.group);
        this.entities.delete(id);
      }
    }
    for (const e of list) {
      const prev = this.entities.get(e.id);
      const sig = sigOf(e);
      if (prev && prev.sig === sig) {
        prev.group.position.set(e.x, 0, e.z);
        prev.e = e;
        continue;
      }
      if (prev) this.scene.remove(prev.group);
      const built = build(e);
      this.scene.add(built.group);
      this.entities.set(e.id, { ...built, sig, e });
    }
    this.updateHighlight();
  }

  private updateHighlight() {
    const b = this.selected ? this.entities.get(this.selected) : undefined;
    if (!b) {
      this.highlight.visible = false;
      return;
    }
    // Box around the geometry only (labels excluded).
    const tmp = new THREE.Box3();
    b.group.updateMatrixWorld(true);
    b.group.traverse((o) => {
      if (o instanceof THREE.Mesh) tmp.expandByObject(o);
    });
    (this.highlight as unknown as { setFromObject(o: THREE.Box3 | THREE.Object3D): void }).setFromObject(b.group);
    this.highlight.visible = true;
    void tmp;
  }

  /** Move the camera so every entity is in view. */
  frameAll(list: EntityDef[]) {
    if (!list.length) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const e of list) {
      minX = Math.min(minX, e.x - 0.5);
      maxX = Math.max(maxX, e.x + 0.5);
      minZ = Math.min(minZ, e.z - 0.5);
      maxZ = Math.max(maxZ, e.z + 0.5);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, (maxZ - minZ) * 1.4, 3);
    const dist = span * 0.95 / Math.tan((this.camera.fov * Math.PI) / 360) * 0.62 + 1.5;
    this.controls.target.set(cx, 0.3, cz);
    this.camera.position.set(cx + dist * 0.12, dist * 0.72, cz + dist * 0.7);
    this.controls.update();
  }

  /** Floor position (m) under a screen point, or null. */
  screenToFloor(clientX: number, clientY: number): { x: number; z: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.floor, hit) ? { x: hit.x, z: hit.z } : null;
  }

  /** Screen position of an entity (for tests / overlays). */
  entityScreenPos(id: string): { x: number; y: number } | null {
    const b = this.entities.get(id);
    if (!b) return null;
    const v = new THREE.Vector3(b.e.x, 0.4, b.e.z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  private pick(clientX: number, clientY: number): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const groups = [...this.entities.values()].map((b) => b.group);
    const hits = this.raycaster.intersectObjects(groups, true).filter((h) => !(h.object instanceof THREE.Sprite));
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.entityId) o = o.parent;
      if (o) return o.userData.entityId as string;
    }
    return null;
  }

  private onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    const id = this.pick(ev.clientX, ev.clientY);
    this.cb.onSelect(id);
    if (!id) return;
    const b = this.entities.get(id)!;
    if (!this.editable) {
      if (b.e.type === 'button') {
        this.pressedId = id;
        this.cb.onPress(id);
      }
      return;
    }
    if (b.e.locked) return;
    const p = this.screenToFloor(ev.clientX, ev.clientY);
    if (!p) return;
    this.dragging = { id, dx: b.e.x - p.x, dz: b.e.z - p.z, moved: false };
    this.controls.enabled = false;
  };

  private onMove = (ev: PointerEvent) => {
    if (!this.dragging) return;
    const p = this.screenToFloor(ev.clientX, ev.clientY);
    if (!p) return;
    const x = snap(p.x + this.dragging.dx);
    const z = snap(p.z + this.dragging.dz);
    const b = this.entities.get(this.dragging.id);
    if (!b || (b.e.x === x && b.e.z === z)) return;
    this.dragging.moved = true;
    this.cb.onMove(this.dragging.id, x, z);
  };

  private onUp = () => {
    if (this.dragging) {
      this.dragging = null;
      this.controls.enabled = true;
    }
    if (this.pressedId) {
      this.cb.onRelease(this.pressedId);
      this.pressedId = null;
    }
  };

  private onDbl = (ev: MouseEvent) => {
    const id = this.pick(ev.clientX, ev.clientY);
    if (id && this.entities.get(id)?.e.type === 'panel') this.cb.onOpenPanel(id);
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(100, now - this.last);
    this.last = now;
    const f = this.getFrame();
    for (const b of this.entities.values()) b.update?.(f, f.running ? dt : 0);
    // items
    const alive = new Set<number>();
    for (const it of f.items) {
      alive.add(it.id);
      let m = this.itemMeshes.get(it.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.BoxGeometry(it.w, it.h, it.d), mat(KIND_COLOR[it.kind], it.kind === 'metal' ? { metalness: 0.85, roughness: 0.3 } : {}));
        this.scene.add(m);
        this.itemMeshes.set(it.id, m);
      }
      m.position.set(it.x, (it.onFloor ? 0 : BELT_Y) + it.h / 2, it.z);
    }
    for (const [id, m] of this.itemMeshes) {
      if (!alive.has(id)) {
        this.scene.remove(m);
        m.geometry.dispose();
        this.itemMeshes.delete(id);
      }
    }
    if (this.highlight.visible) this.updateHighlight();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.debug.frames++;
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
