"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, useTexture } from "@react-three/drei";
import {
  SatData, SimClock, propagateGeodetic, geodeticToScene, sunDirectionScene, footprintHalfAngleDeg, EARTH_RADIUS_KM, type Site,
} from "@/lib/satellites";
import { GEO_ALT_KM } from "@/lib/catalog";
import type { GroundStation } from "@/lib/stations";

const UP = new THREE.Vector3(0, 1, 0);

export interface RouteView {
  /** station currently receiving (or next to receive) the selected satellite */
  stationId: string | null;
  /** stations currently in view of the selected satellite */
  inViewIds: string[];
  relayLonDeg: number | null;
  relayVisible: boolean;
  fibreFrom: Site | null;
}

export interface SceneProps {
  /** set by the scene: renders a fresh frame and returns a JPEG data URL, or null if the buffer is empty */
  snapshotRef?: React.MutableRefObject<(() => string | null) | null>;
  sats: SatData[];
  clockRef: React.MutableRefObject<SimClock>;
  routeRef: React.MutableRefObject<RouteView>;
  selected: number | null;
  onSelect: (i: number | null) => void;
  onPickGround: (lat: number, lon: number, kind: "dc" | "target") => void;
  stations: GroundStation[];
  dataCentre: Site & { name: string };
  target: (Site & { name: string }) | null;
  minElDeg: number;
  showLabels: boolean;
  showAllSats: boolean;
  relays: { name: string; lonDeg: number; system: string }[];
}

/* ---------------------------------- Earth --------------------------------- */
const EARTH_VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vNormal;
  void main() { vUv = uv; vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayMap; uniform sampler2D nightMap; uniform vec3 sunDir;
  varying vec2 vUv; varying vec3 vNormal;
  void main() { vec3 n = normalize(vNormal);
    float sunAmt = smoothstep(-0.12, 0.18, dot(n, normalize(sunDir)));
    vec3 day = texture2D(dayMap, vUv).rgb; vec3 night = texture2D(nightMap, vUv).rgb;
    gl_FragColor = vec4(mix(night * vec3(1.7, 1.6, 1.3), day, sunAmt), 1.0);
    #include <colorspace_fragment> }`;

function Earth({ clockRef }: { clockRef: React.MutableRefObject<SimClock> }) {
  const [day, night] = useTexture(["/textures/earth-day.jpg", "/textures/earth-night.jpg"]);
  const material = useMemo(() => {
    day.colorSpace = THREE.SRGBColorSpace; night.colorSpace = THREE.SRGBColorSpace;
    day.anisotropy = 8; night.anisotropy = 8;
    return new THREE.ShaderMaterial({
      uniforms: { dayMap: { value: day }, nightMap: { value: night }, sunDir: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
    });
  }, [day, night]);
  useFrame(() => {
    const [x, y, z] = sunDirectionScene(new Date(clockRef.current.simMs));
    material.uniforms.sunDir.value.set(x, y, z);
  });
  return (
    <mesh material={material} name="earth">
      <sphereGeometry args={[1, 96, 96]} />
    </mesh>
  );
}

function Atmosphere() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vNormal; void main(){ vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: `varying vec3 vNormal; void main(){ float i = pow(0.72 - dot(vNormal, vec3(0.0,0.0,1.0)), 4.0); gl_FragColor = vec4(0.25,0.55,1.0,1.0)*i; }`,
    blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
  }), []);
  return (<mesh material={material} scale={1.06}><sphereGeometry args={[1, 64, 64]} /></mesh>);
}

/* ------------------------------- helpers --------------------------------- */
function canvasTex(draw: (ctx: CanvasRenderingContext2D) => void, w = 64, h = 64): THREE.Texture {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function labelTex(text: string, color: string): THREE.Texture {
  return canvasTex((ctx) => {
    ctx.font = "600 30px 'Courier New', monospace"; ctx.fillStyle = color;
    ctx.shadowColor = "rgba(0,0,0,0.95)"; ctx.shadowBlur = 5; ctx.textBaseline = "middle"; ctx.fillText(text, 8, 34);
  }, 512, 64);
}
function markerTex(color: string, shape: "square" | "circle" | "diamond" | "cross"): THREE.Texture {
  return canvasTex((ctx) => {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 5;
    if (shape === "square") { ctx.strokeRect(16, 16, 32, 32); ctx.fillRect(27, 27, 10, 10); }
    if (shape === "circle") { ctx.beginPath(); ctx.arc(32, 32, 16, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(32, 6); ctx.lineTo(32, 58); ctx.moveTo(6, 32); ctx.lineTo(58, 32); ctx.stroke(); }
    if (shape === "diamond") { ctx.beginPath(); ctx.moveTo(32, 6); ctx.lineTo(58, 32); ctx.lineTo(32, 58); ctx.lineTo(6, 32); ctx.closePath(); ctx.stroke(); ctx.fillRect(28, 28, 8, 8); }
    if (shape === "cross") { ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(54, 54); ctx.moveTo(54, 10); ctx.lineTo(10, 54); ctx.stroke(); ctx.beginPath(); ctx.arc(32, 32, 8, 0, Math.PI * 2); ctx.stroke(); }
  });
}
function sprite(tex: THREE.Texture, scale: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(scale, scale, 1); return s;
}
function lineObj(n: number, color: number, opacity = 0.7, segments = false): THREE.Line | THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const l = segments ? new THREE.LineSegments(geo, mat) : new THREE.Line(geo, mat);
  l.frustumCulled = false; return l;
}
function setLine(l: THREE.Line | THREE.LineSegments, pts: number[]) {
  const attr = l.geometry.getAttribute("position") as THREE.BufferAttribute;
  const n = Math.min(pts.length / 3, attr.count);
  for (let i = 0; i < n * 3; i++) attr.array[i] = pts[i];
  l.geometry.setDrawRange(0, n); attr.needsUpdate = true;
}
/** great-circle arc between two scene unit vectors, lifted by `lift` */
function arcPoints(a: THREE.Vector3, b: THREE.Vector3, n: number, lift: number): number[] {
  const out: number[] = [];
  const q0 = a.clone().normalize(), q1 = b.clone().normalize();
  const omega = Math.acos(THREE.MathUtils.clamp(q0.dot(q1), -1, 1));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let p: THREE.Vector3;
    if (omega < 1e-4) p = q0.clone();
    else p = q0.clone().multiplyScalar(Math.sin((1 - t) * omega) / Math.sin(omega)).add(q1.clone().multiplyScalar(Math.sin(t * omega) / Math.sin(omega)));
    p.normalize().multiplyScalar(1 + lift * Math.sin(Math.PI * t) + 0.002);
    out.push(p.x, p.y, p.z);
  }
  return out;
}

/* ------------------------------- Satellites ------------------------------ */
interface LayerProps extends SceneProps { posArr: Float32Array }

function SatellitesLayer({ sats, clockRef, selected, posArr, showLabels, showAllSats, minElDeg }: LayerProps) {
  const { group, items, footprint, track } = useMemo(() => {
    const dot = markerTex("#8fd3ff", "square");
    const selTex = markerTex("#ffe14a", "diamond");
    const group = new THREE.Group();
    const items = sats.map((s) => {
      const marker = sprite(dot, 0.012);
      const sel = sprite(selTex, 0.03); sel.visible = false;
      const label = sprite(labelTex(s.name, "#bfe7ff"), 0.2); label.center.set(-0.1, 0.5); label.scale.set(0.2, 0.025, 1); label.visible = false;
      group.add(marker, sel, label);
      return { marker, sel, label };
    });
    const footprint = lineObj(129, 0xffe14a, 0.6);
    const track = lineObj(400, 0x35ff6a, 0.45);
    group.add(footprint, track);
    return { group, items, footprint, track };
  }, [sats]);

  const frame = useRef(0);
  const nadir = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const clock = clockRef.current;
    if (clock.live) clock.simMs = Date.now();
    else if (!clock.paused) clock.simMs += delta * 1000 * clock.speed;
    const date = new Date(clock.simMs);
    let selAlt = 0;
    for (let i = 0; i < sats.length; i++) {
      const it = items[i];
      const show = showAllSats || i === selected;
      const st = show ? propagateGeodetic(sats[i].satrec, date) : null;
      if (!st) { it.marker.visible = it.label.visible = it.sel.visible = false; posArr[i * 3] = NaN; continue; }
      const [x, y, z] = geodeticToScene(st.latDeg, st.lonDeg, st.altKm);
      posArr[i * 3] = x; posArr[i * 3 + 1] = y; posArr[i * 3 + 2] = z;
      it.marker.visible = i !== selected; it.marker.position.set(x, y, z);
      it.sel.visible = i === selected; it.sel.position.set(x, y, z);
      it.label.visible = showLabels || i === selected; it.label.position.set(x, y, z);
      if (i === selected) selAlt = st.altKm;
    }
    // footprint circle of the selected satellite at the elevation mask
    if (selected != null && !Number.isNaN(posArr[selected * 3])) {
      nadir.set(posArr[selected * 3], posArr[selected * 3 + 1], posArr[selected * 3 + 2]).normalize();
      const half = (footprintHalfAngleDeg(selAlt, minElDeg) * Math.PI) / 180;
      const u = Math.abs(nadir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const e1 = new THREE.Vector3().crossVectors(nadir, u).normalize();
      const e2 = new THREE.Vector3().crossVectors(nadir, e1).normalize();
      const pts: number[] = [];
      for (let k = 0; k <= 128; k++) {
        const a = (k / 128) * Math.PI * 2;
        const p = nadir.clone().multiplyScalar(Math.cos(half)).add(e1.clone().multiplyScalar(Math.sin(half) * Math.cos(a))).add(e2.clone().multiplyScalar(Math.sin(half) * Math.sin(a))).multiplyScalar(1.004);
        pts.push(p.x, p.y, p.z);
      }
      setLine(footprint, pts); footprint.visible = true;
      if (frame.current++ % 60 === 0) {
        const periodMs = ((2 * Math.PI) / sats[selected].satrec.no) * 60000;
        const pts2: number[] = [];
        for (let j = 0; j < 400; j++) {
          const s2 = propagateGeodetic(sats[selected].satrec, new Date(clock.simMs + ((j - 60) / 340) * periodMs));
          if (!s2) break;
          const [x, y, z] = geodeticToScene(s2.latDeg, s2.lonDeg, s2.altKm);
          pts2.push(x, y, z);
        }
        setLine(track, pts2); track.visible = true;
      }
    } else { footprint.visible = false; track.visible = false; }
  });
  return <primitive object={group} />;
}

/* ------------------------- ground sites & links --------------------------- */
function Ground({ stations, dataCentre, target, routeRef, posArr, selected, relays, clockRef }: LayerProps) {
  const objs = useMemo(() => {
    const g = new THREE.Group();
    const stTex = markerTex("#35ffe0", "circle");
    const stHot = markerTex("#ffffff", "circle");
    const stItems = stations.map((s) => {
      const m = sprite(stTex, 0.03);
      const [x, y, z] = geodeticToScene(s.latDeg, s.lonDeg, 8);
      m.position.set(x, y, z);
      const l = sprite(labelTex(s.name, "#9ff5e6"), 0.2); l.center.set(-0.12, 0.5); l.scale.set(0.16, 0.02, 1); l.position.set(x, y, z);
      g.add(m, l);
      return { m, l, hot: new THREE.SpriteMaterial({ map: stHot, depthWrite: false, transparent: true }), normal: m.material };
    });
    const dc = sprite(markerTex("#ff5ce0", "diamond"), 0.045);
    const dcLabel = sprite(labelTex("DATA CENTRE: " + dataCentre.name, "#ffb3f0"), 0.2); dcLabel.center.set(-0.08, 0.5); dcLabel.scale.set(0.3, 0.0375, 1);
    const tg = sprite(markerTex("#ff9a3c", "cross"), 0.045);
    const tgLabel = sprite(labelTex("TARGET: " + (target?.name ?? ""), "#ffc896"), 0.2); tgLabel.center.set(-0.08, 0.5); tgLabel.scale.set(0.3, 0.0375, 1);
    const links = lineObj(stations.length * 2 + 2, 0x39ffb0, 0.35, true);
    const active = lineObj(2, 0xffffff, 0.9);
    const fibre = lineObj(65, 0xff5ce0, 0.8);
    const relayLine = lineObj(2, 0xffd166, 0.8);
    const relayItems = relays.map((r) => {
      const m = sprite(markerTex("#ffd166", "square"), 0.08);
      const rr = 1 + GEO_ALT_KM / EARTH_RADIUS_KM;
      const [x, y, z] = geodeticToScene(0, r.lonDeg, 0);
      m.position.set(x * rr, y * rr, z * rr);
      const l = sprite(labelTex(r.name, "#ffe6a8"), 0.2); l.center.set(-0.1, 0.5); l.scale.set(0.5, 0.0625, 1); l.position.copy(m.position);
      g.add(m, l);
      return { m, l, lon: r.lonDeg };
    });
    g.add(dc, dcLabel, tg, tgLabel, links, active, fibre, relayLine);
    return { g, stItems, dc, dcLabel, tg, tgLabel, links, active, fibre, relayLine, relayItems };
  }, [stations, dataCentre, target, relays]);

  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const r = routeRef.current;
    const [dx, dy, dz] = geodeticToScene(dataCentre.latDeg, dataCentre.lonDeg, 8);
    objs.dc.position.set(dx, dy, dz); objs.dcLabel.position.set(dx, dy, dz);
    objs.tg.visible = objs.tgLabel.visible = !!target;
    if (target) { const [tx, ty, tz] = geodeticToScene(target.latDeg, target.lonDeg, 8); objs.tg.position.set(tx, ty, tz); objs.tgLabel.position.set(tx, ty, tz); }

    const hasSel = selected != null && !Number.isNaN(posArr[selected * 3]);
    const sx = hasSel ? posArr[selected! * 3] : 0, sy = hasSel ? posArr[selected! * 3 + 1] : 0, sz = hasSel ? posArr[selected! * 3 + 2] : 0;
    const pts: number[] = [];
    objs.stItems.forEach((it, i) => {
      const st = stations[i];
      const inView = hasSel && r.inViewIds.includes(st.id);
      it.m.material = inView ? it.hot : it.normal;
      if (inView) pts.push(it.m.position.x, it.m.position.y, it.m.position.z, sx, sy, sz);
    });
    setLine(objs.links, pts);
    // active station link (bright) and fibre arc to the data centre
    const act = r.stationId ? objs.stItems[stations.findIndex((s) => s.id === r.stationId)] : null;
    if (act && hasSel && r.inViewIds.includes(r.stationId!)) { setLine(objs.active, [act.m.position.x, act.m.position.y, act.m.position.z, sx, sy, sz]); objs.active.visible = true; }
    else objs.active.visible = false;
    if (r.fibreFrom) {
      const [fx, fy, fz] = geodeticToScene(r.fibreFrom.latDeg, r.fibreFrom.lonDeg, 0);
      setLine(objs.fibre, arcPoints(new THREE.Vector3(fx, fy, fz), new THREE.Vector3(dx, dy, dz), 64, 0.04)); objs.fibre.visible = true;
    } else objs.fibre.visible = false;
    // relay line
    const rel = r.relayLonDeg != null ? objs.relayItems.find((x) => x.lon === r.relayLonDeg) : null;
    if (rel && hasSel && r.relayVisible) { setLine(objs.relayLine, [sx, sy, sz, rel.m.position.x, rel.m.position.y, rel.m.position.z]); objs.relayLine.visible = true; }
    else objs.relayLine.visible = false;
    void v; void clockRef;
  });
  return <primitive object={objs.g} />;
}

/* ------------------------------ Camera & picker --------------------------- */
function CameraFocus({ selected, posArr, controlsRef }: { selected: number | null; posArr: Float32Array; controlsRef: React.MutableRefObject<{ enabled: boolean } | null> }) {
  const { camera } = useThree();
  const prevSel = useRef<number | null>(null);
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; radius: number; t: number } | null>(null);
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    if (selected !== prevSel.current) {
      prevSel.current = selected;
      if (selected != null && !Number.isNaN(posArr[selected * 3])) {
        const from = camera.position.clone().normalize();
        const to = new THREE.Vector3(posArr[selected * 3], posArr[selected * 3 + 1], posArr[selected * 3 + 2]).normalize();
        if (from.dot(to) < -0.999) to.x += 0.001;
        anim.current = { from, to, radius: camera.position.length(), t: 0 };
      }
    }
    const a = anim.current; if (!a) return;
    a.t = Math.min(1, a.t + delta / 1.1);
    const k = 1 - Math.pow(1 - a.t, 3);
    dir.copy(a.from).lerp(a.to, k).normalize();
    camera.position.copy(dir).multiplyScalar(a.radius); camera.lookAt(0, 0, 0);
    if (controlsRef.current) controlsRef.current.enabled = a.t >= 1;
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

function Picker({ count, posArr, onSelect, onPickGround }: { count: number; posArr: Float32Array; onSelect: (i: number | null) => void; onPickGround: SceneProps["onPickGround"] }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    let down: [number, number] | null = null;
    const v = new THREE.Vector3(); const cp = new THREE.Vector3();
    const ray = new THREE.Raycaster(); const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down[0], dy = e.clientY - down[1]; down = null;
      if (dx * dx + dy * dy > 25) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (e.shiftKey || e.altKey) {
        ray.setFromCamera(ndc, camera);
        const hit = new THREE.Vector3();
        if (ray.ray.intersectSphere(sphere, hit)) {
          const lat = (Math.asin(hit.y) * 180) / Math.PI;
          const lon = (Math.atan2(-hit.z, hit.x) * 180) / Math.PI;
          onPickGround(lat, lon, e.shiftKey ? "dc" : "target");
        }
        return;
      }
      camera.getWorldPosition(cp);
      let best = -1, bestD = 16;
      for (let i = 0; i < count; i++) {
        const x = posArr[i * 3]; if (Number.isNaN(x)) continue;
        const y = posArr[i * 3 + 1], z = posArr[i * 3 + 2];
        const dxs = x - cp.x, dys = y - cp.y, dzs = z - cp.z;
        const L = Math.sqrt(dxs * dxs + dys * dys + dzs * dzs);
        const t = -(cp.x * dxs + cp.y * dys + cp.z * dzs) / L;
        const d2 = cp.lengthSq() - t * t;
        if (d2 < 1 && t > 0 && t - Math.sqrt(1 - d2) < L - 0.01) continue; // behind the globe
        v.set(x, y, z).project(camera); if (v.z > 1) continue;
        const sx = ((v.x + 1) / 2) * rect.width, sy = ((1 - v.y) / 2) * rect.height;
        const d = Math.hypot(sx - (e.clientX - rect.left), sy - (e.clientY - rect.top));
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) onSelect(best);
    };
    el.addEventListener("pointerdown", onDown); el.addEventListener("pointerup", onUp);
    return () => { el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointerup", onUp); };
  }, [camera, gl, count, posArr, onSelect, onPickGround]);
  return null;
}

function Snapshot({ snapshotRef }: { snapshotRef?: SceneProps["snapshotRef"] }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    if (!snapshotRef) return;
    snapshotRef.current = () => {
      try {
        gl.render(scene, camera);
        const src = gl.domElement;
        const w = Math.min(1400, src.width), h = Math.round((src.height / src.width) * w);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(src, 0, 0, w, h);
        // empty-buffer check: sample pixels, require some non-black content
        const d = ctx.getImageData(0, 0, w, h).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
        if (lit < 20) return null;
        return c.toDataURL("image/jpeg", 0.85);
      } catch { return null; }
    };
    return () => { snapshotRef.current = null; };
  }, [gl, scene, camera, snapshotRef]);
  return null;
}

/* ---------------------------------- Scene --------------------------------- */
export default function Scene(props: SceneProps) {
  const posArr = useMemo(() => new Float32Array(props.sats.length * 3).fill(NaN), [props.sats]);
  const controlsRef = useRef<{ enabled: boolean } | null>(null);
  return (
    <div className="absolute inset-0">
      <Canvas camera={{ position: [0, 0.9, 3.0], fov: 45, near: 0.01, far: 100 }} dpr={[1, 2]} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={["#01020a"]} />
        <Stars radius={40} depth={20} count={4000} factor={3} saturation={0.4} fade speed={0.2} />
        <Suspense fallback={null}><Earth clockRef={props.clockRef} /></Suspense>
        <Atmosphere />
        <SatellitesLayer {...props} posArr={posArr} />
        <Ground {...props} posArr={posArr} />
        <Snapshot snapshotRef={props.snapshotRef} />
        <Picker count={props.sats.length} posArr={posArr} onSelect={props.onSelect} onPickGround={props.onPickGround} />
        <CameraFocus selected={props.selected} posArr={posArr} controlsRef={controlsRef} />
        <OrbitControls ref={controlsRef as React.Ref<never>} enablePan={false} enableDamping dampingFactor={0.08} minDistance={1.2} maxDistance={16} rotateSpeed={0.5} zoomSpeed={0.7} />
      </Canvas>
    </div>
  );
}
