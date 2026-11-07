import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Login artwork (web only): plain coins floating at different depths over the whole box.
 *
 * - Plain on purpose: simple discs with a thin rim, no skin or embossing.
 * - Subtle: small, white scales, low opacity; far coins smaller and fainter, a few near ones softer.
 * - Smart coverage: best-candidate sampling spreads coins evenly; `avoid` rects stay clear.
 * - Individually reactive: each coin is pushed away, spins and lights up when the cursor gets
 *   close, then springs back; a click bursts only the coins nearby.
 * - Hold Ctrl: coins that come close to the pointer are captured and fly to a neat stack that
 *   hangs from the pointer (flat discs piled one over the other, same depth and size). Nothing is
 *   pulled at random and nothing falls off: every captured coin stays in the stack while Ctrl is
 *   held, and the stack follows the pointer, capturing more coins it passes near. Release Ctrl and
 *   the coins spring back home.
 * - Honors prefers-reduced-motion (static, no reactions). Without WebGL it renders nothing.
 */
export type Rect = { l: number; t: number; r: number; b: number };
type Props = {
  /** Rectangles, in CSS px inside the box, that must stay free (text). Receives the box size. */
  avoid?: (w: number, h: number) => Rect[];
  /** Approximate distance between coins in px (lower = denser). */
  spacing?: number;
};

const FOV = 30;
const DIST = 14;
const MAX_COINS = 44;
const STACK_Z = 1; // depth of the stack
const STACK_SIZE = 0.3; // coin radius in the stack
const STACK_GAP = 0.075; // vertical distance between stacked coins
const STACK_TILT = 1.15; // rad: top faces turned toward the camera so the pile reads as a stack

// seeded random: the layout is the same on every load
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Item = {
  mesh: THREE.Object3D;
  mats: THREE.MeshStandardMaterial[];
  baseOpacity: number;
  size: number;
  home: THREE.Vector3;
  off: THREE.Vector3; // reactive offset
  vel: THREE.Vector3;
  phase: number;
  bob: number;
  drift: number;
  tilt: THREE.Vector3;
  spin: THREE.Vector3;
  extraAxis: THREE.Vector3;
  extraAngle: number;
  extraVel: number;
  glow: number;
  cap: boolean; // captured in the stack
  slot: number; // position in the stack (0 = bottom)
  cp: THREE.Vector3; // position while in the stack
  cvel: THREE.Vector3;
  blend: number; // 0 free .. 1 stacked (orientation and size)
};

export function ControlScene({ avoid, spacing = 100 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const avoidRef = useRef(avoid);
  avoidRef.current = avoid;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
    camera.position.set(0, 0, DIST);
    scene.add(new THREE.AmbientLight(0xbcd0ff, 1.15));
    const key = new THREE.DirectionalLight(0xdfe8ff, 1.6);
    key.position.set(3, 5, 6);
    scene.add(key);
    const rimLight = new THREE.PointLight(0xdfe6f5, 10, 40);
    rimLight.position.set(-5, -2, 2);
    scene.add(rimLight);

    const geo = new THREE.CylinderGeometry(1, 1, 0.16, 48, 1);
    const edge = new THREE.TorusGeometry(1, 0.03, 10, 48);
    edge.rotateX(Math.PI / 2);
    // white in scales (cool whites to soft grays), not tinted by the brand color: keeps the artwork discreet
    const palette = ['#FFFFFF', '#E6EAF2', '#CDD4E2', '#B3BCCF'].map((c) => new THREE.Color(c));

    const items: Item[] = [];
    const stack: Item[] = [];
    /** Ctrl released: everything in the stack springs back home from where it is */
    const releaseStack = () => {
      stack.forEach((it) => {
        it.cap = false;
        it.off.copy(it.cp).sub(it.home);
        it.vel.copy(it.cvel).multiplyScalar(0.3);
      });
      stack.length = 0;
    };
    const clearScene = () => {
      items.forEach((it) => {
        scene.remove(it.mesh);
        it.mats.forEach((m) => m.dispose());
      });
      items.length = 0;
      stack.length = 0;
    };

    let W = 1, H = 1, halfW = 1, halfH = 1;
    const toWorld = (u: number, v: number, z: number) => {
      const k = (DIST - z) / DIST;
      return new THREE.Vector3((u * 2 - 1) * halfW * k, (1 - v * 2) * halfH * k, z);
    };

    const build = () => {
      clearScene();
      const rand = rng(11);
      const rects = avoidRef.current?.(W, H) ?? [];
      const blocked = (px: number, py: number, pad: number) => rects.some((r) => px > r.l - pad && px < r.r + pad && py > r.t - pad && py < r.b + pad);

      // best-candidate sampling in screen space: spreads coins evenly and fills the whole box
      const target = Math.min(MAX_COINS, Math.max(6, Math.round((W * H) / (spacing * spacing))));
      const pts: { u: number; v: number }[] = [];
      for (let n = 0; n < target; n++) {
        let best: { u: number; v: number } | null = null;
        let bestD = -1;
        for (let c = 0; c < 24; c++) {
          const u = 0.04 + rand() * 0.92;
          const v = 0.04 + rand() * 0.92;
          if (blocked(u * W, v * H, 36)) continue;
          const d = pts.length ? Math.min(...pts.map((p) => Math.hypot((p.u - u) * W, (p.v - v) * H))) : 1e9;
          if (d > bestD) {
            bestD = d;
            best = { u, v };
          }
        }
        if (best) pts.push(best);
      }

      pts.forEach((p, i) => {
        // depth spread: mostly mid and far coins, a few near ones (softer, like out of focus)
        const z = rand() < 0.22 ? 0.5 + rand() * 2.5 : -9 + rand() * 9;
        const depth = (z + 9) / 12.5; // 0 far .. 1 near
        const color = palette[Math.floor(rand() * palette.length)].clone();
        const base = (0.13 + Math.min(1, depth * 1.25) * 0.27) * (z > 1.5 ? 0.7 : 1); // far coins fainter, nearest softer
        const size = 0.17 + depth * 0.1 + rand() * 0.09;
        const mk = (c: THREE.Color, metal: number, rough: number) => {
          const m = new THREE.MeshStandardMaterial({ color: c, metalness: metal, roughness: rough, transparent: true, opacity: base });
          m.emissive.set(0x9db4ff);
          m.emissiveIntensity = 0;
          return m;
        };
        const body = mk(color, 0.45, 0.4);
        const rim = mk(color.clone().offsetHSL(0, 0, 0.1), 0.6, 0.3);
        const mesh = new THREE.Group();
        mesh.add(new THREE.Mesh(geo, body));
        const up = new THREE.Mesh(edge, rim);
        up.position.y = 0.08;
        const down = new THREE.Mesh(edge, rim);
        down.position.y = -0.08;
        mesh.add(up, down);
        mesh.scale.setScalar(size);
        scene.add(mesh);
        items.push({
          mesh,
          mats: [body, rim],
          baseOpacity: base,
          size,
          home: toWorld(p.u, p.v, z),
          off: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          phase: rand() * Math.PI * 2 + i,
          bob: 0.1 + rand() * 0.16,
          drift: 0.06 + rand() * 0.1,
          tilt: new THREE.Vector3(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI),
          spin: new THREE.Vector3(0.12 + rand() * 0.2, 0.1 + rand() * 0.25, 0.05 + rand() * 0.1),
          extraAxis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
          extraAngle: 0,
          extraVel: 0,
          glow: 0,
          cap: false,
          slot: 0,
          cp: new THREE.Vector3(),
          cvel: new THREE.Vector3(),
          blend: 0,
        });
      });
    };

    // pointer, in NDC, and only while it is over the box; `ctrl` flips repel into attract
    const pointer = { nx: 0, ny: 0, active: false, ctrl: false };
    const setCtrl = (v: boolean) => {
      if (pointer.ctrl && !v) releaseStack();
      pointer.ctrl = v;
      if (parent) parent.style.cursor = v && pointer.active ? 'crosshair' : '';
    };
    const parent = el.parentElement;
    const track = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      pointer.active = inside;
      if (inside) {
        pointer.nx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
        pointer.ny = 1 - ((e.clientY - r.top) / Math.max(1, r.height)) * 2;
      }
      setCtrl(e.ctrlKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrl(e.type === 'keydown');
    };
    const onBlur = () => setCtrl(false);
    const pointerWorld = (z: number, out: THREE.Vector3) => {
      const k = (DIST - z) / DIST;
      return out.set(pointer.nx * halfW * k, pointer.ny * halfH * k, z);
    };
    const burst = (e: PointerEvent) => {
      track(e);
      if (!pointer.active) return;
      const pw = new THREE.Vector3();
      const dir = new THREE.Vector3();
      items.forEach((it) => {
        pointerWorld(it.home.z, pw);
        const R = 0.55 * halfH * ((DIST - it.home.z) / DIST);
        dir.copy(it.home).add(it.off).sub(pw);
        const d = Math.max(dir.length(), 0.001);
        if (d > R) return;
        const f = 1 - d / R;
        it.vel.addScaledVector(dir.divideScalar(d), 14 * f);
        it.extraVel += (Math.random() > 0.5 ? 1 : -1) * 12 * f;
      });
    };
    if (!reduced) {
      window.addEventListener('pointermove', track, { passive: true });
      window.addEventListener('pointerdown', burst, { passive: true });
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
      window.addEventListener('blur', onBlur);
    }

    const resize = () => {
      W = Math.max(1, el.clientWidth);
      H = Math.max(1, el.clientHeight);
      renderer.setSize(W, H, false);
      renderer.domElement.style.width = `${W}px`;
      renderer.domElement.style.height = `${H}px`;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      halfH = Math.tan((FOV * Math.PI) / 360) * DIST;
      halfW = halfH * camera.aspect;
      build();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const pw = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const qa = new THREE.Quaternion();
    const qs = new THREE.Quaternion();
    const euler = new THREE.Euler();
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = reduced ? 0 : (now - t0) / 1000;
      items.forEach((it) => {
        let f = 0;
        if (!reduced) {
          if (it.cap) {
            // in the stack: flies to its slot, hanging from the pointer; lower coins follow a bit tighter
            pointerWorld(STACK_Z, pw);
            const k = 46 / (1 + 0.07 * it.slot);
            it.cvel.x += (pw.x - it.cp.x) * k * dt;
            it.cvel.y += (pw.y - 0.1 + it.slot * STACK_GAP - it.cp.y) * k * dt;
            it.cvel.z += (STACK_Z - it.cp.z) * k * dt;
            it.cvel.multiplyScalar(Math.exp(-8.5 * dt));
            it.cp.addScaledVector(it.cvel, dt);
            f = 0.5;
          } else {
            if (pointer.active) {
              pointerWorld(it.home.z, pw);
              const k = (DIST - it.home.z) / DIST;
              if (pointer.ctrl) {
                // coin close enough to the pointer: captured, goes to the top of the stack
                const p = it.mesh.position;
                if (Math.hypot(p.x - pw.x, p.y - pw.y) < 0.42 * halfH * k) {
                  it.cap = true;
                  it.slot = stack.length;
                  stack.push(it);
                  it.cp.copy(p);
                  it.cvel.set(0, 0, 0);
                }
              } else {
                dir.copy(it.home).add(it.off).sub(pw);
                dir.z = 0;
                const d = Math.max(dir.length(), 0.001);
                const R = 0.26 * halfH * k;
                if (d < R) {
                  f = (1 - d / R) ** 2;
                  it.vel.addScaledVector(dir.divideScalar(d), f * 70 * dt); // pushed away
                  it.extraVel += f * 14 * dt * (it.phase > 3 ? 1 : -1); // spins up
                }
              }
            }
            // spring back to home
            it.vel.addScaledVector(it.off, -8 * dt);
            it.vel.multiplyScalar(Math.exp(-3.4 * dt));
            it.off.addScaledVector(it.vel, dt);
            if (it.off.length() > 4.5) it.off.setLength(4.5);
          }
          it.extraVel *= Math.exp(-2.2 * dt);
          it.extraAngle += it.extraVel * dt;
          it.glow += (f - it.glow) * (1 - Math.exp(-9 * dt));
          it.blend += ((it.cap ? 1 : 0) - it.blend) * (1 - Math.exp(-7 * dt));
        }
        if (it.cap) it.mesh.position.copy(it.cp);
        else
          it.mesh.position.set(
            it.home.x + it.off.x + Math.sin(t * it.drift + it.phase) * 0.35,
            it.home.y + it.off.y + Math.sin(t * 0.5 + it.phase) * it.bob,
            it.home.z + it.off.z,
          );
        euler.set(it.tilt.x + t * it.spin.x, it.tilt.y + t * it.spin.y, it.tilt.z + t * it.spin.z);
        q.setFromEuler(euler);
        qa.setFromAxisAngle(it.extraAxis, it.extraAngle);
        it.mesh.quaternion.copy(qa.multiply(q));
        if (it.blend > 0.001) {
          // stacked: flat disc tilted toward the camera, same size for every coin
          it.mesh.quaternion.slerp(qs.setFromEuler(euler.set(STACK_TILT, 0, 0)), it.blend);
        }
        it.mesh.scale.setScalar((it.size + (STACK_SIZE - it.size) * it.blend) * (1 + it.glow * 0.2));
        const o = Math.min(0.85, it.baseOpacity + it.glow * 0.35 + it.blend * 0.3);
        it.mats.forEach((m) => {
          m.opacity = o;
          m.emissiveIntensity = it.glow * 0.3;
        });
      });
      renderer.render(scene, camera);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerdown', burst);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      if (parent) parent.style.cursor = '';
      clearScene();
      geo.dispose();
      edge.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [spacing]);

  return <div ref={host} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', userSelect: 'none' }} />;
}
