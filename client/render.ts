import * as THREE from "three";
import type { GameEvent, PlayerState, RoomState } from "../shared/protocol";

/**
 * The renderer is intentionally a one-way adapter: the server snapshot is the
 * source of truth and Three.js only owns presentation, interpolation, and
 * short-lived effects.
 */

const DEFAULT_RADIUS = 9;
const INTERPOLATION_MS = 70;
const MAX_PIXEL_RATIO = 1.5;
const TAU = Math.PI * 2;

type MaybeRenderer = THREE.WebGLRenderer | null;

interface BandVisual {
  group: THREE.Group;
  innerRadius: number;
  outerRadius: number;
  baseY: number;
  index: number;
}

interface PlayerVisual {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  aura: THREE.Mesh;
  chargeRing: THREE.Mesh;
  localMarker: THREE.Mesh;
  accentMaterial: THREE.MeshStandardMaterial;
  auraMaterial: THREE.MeshBasicMaterial;
  nameSprite?: THREE.Sprite;
  id: string;
  decorative: boolean;
  seed: number;
  deathStartedAt: number | null;
  wasAlive: boolean;
}

interface EffectVisual {
  id: string;
  type: GameEvent["type"];
  group: THREE.Group;
  startedAt: number;
  duration: number;
  primaryMaterial?: THREE.MeshBasicMaterial;
  secondaryMaterial?: THREE.MeshBasicMaterial;
  ring?: THREE.Mesh;
  secondaryRing?: THREE.Mesh;
  beam?: THREE.Mesh;
  particles?: THREE.Mesh[];
  angle: number;
}

interface DisplayPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  alive: boolean;
  charge: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value + 0x6d2b79f5, 1 | value);
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function colorOrFallback(value: string | undefined, fallback: number): THREE.Color {
  const color = new THREE.Color(fallback);
  if (!value) return color;
  try {
    color.set(value);
  } catch {
    // A malformed lobby color should never take down the render loop.
  }
  return color;
}

function findPlayer(state: RoomState | null, id: string): PlayerState | undefined {
  return state?.players.find((player) => player.id === id);
}

function cloneState(state: RoomState): RoomState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    events: state.events.map((event) => ({ ...event })),
  };
}

function disposeMaterial(material: THREE.Material, disposed: Set<THREE.Material>): void {
  if (disposed.has(material)) return;
  disposed.add(material);
  material.dispose();
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => materials.add(item));
    } else if (material) {
      materials.add(material);
    }
    const sprite = object as THREE.Sprite;
    const spriteMaterial = sprite.material;
    if (spriteMaterial) {
      const materialList = Array.isArray(spriteMaterial) ? spriteMaterial : [spriteMaterial];
      materialList.forEach((item) => materials.add(item));
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  const disposedMaterials = new Set<THREE.Material>();
  materials.forEach((material) => {
    const texture = (material as THREE.MeshBasicMaterial).map;
    if (texture) texture.dispose();
    disposeMaterial(material, disposedMaterials);
  });
}

function makeLabelTexture(text: string, color: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = "700 28px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(3, 9, 18, 0.78)";
  context.strokeStyle = "rgba(111, 238, 255, 0.18)";
  context.lineWidth = 3;
  context.roundRect(7, 9, 242, 46, 14);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.fillText(text.slice(0, 18), 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeLimbSegment(length: number, radius: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 8), material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeTorus(
  radius: number,
  tube: number,
  material: THREE.Material,
  tubularSegments = 64,
  radialSegments = 12,
): THREE.Mesh {
  // Three's constructor takes the small cross-section count first and the
  // count around the ring second.  Callers pass the visually useful order
  // (around-ring, cross-section), so accretion rings stay genuinely round
  // instead of becoming low-poly decagons.
  const torus = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments), material);
  torus.rotation.x = Math.PI / 2;
  torus.castShadow = true;
  torus.receiveShadow = true;
  return torus;
}

/** Build a closed, beveled annular wedge so every arena segment has real depth. */
function makeSectorGeometry(innerRadius: number, outerRadius: number, thetaStart: number, thetaLength: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const steps = 8;
  for (let step = 0; step <= steps; step += 1) {
    const angle = thetaStart + (thetaLength * step) / steps;
    const x = Math.cos(angle) * outerRadius;
    const y = Math.sin(angle) * outerRadius;
    if (step === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const endAngle = thetaStart + thetaLength;
  if (innerRadius > 0) {
    shape.lineTo(Math.cos(endAngle) * innerRadius, Math.sin(endAngle) * innerRadius);
    for (let step = steps - 1; step >= 0; step -= 1) {
      const angle = thetaStart + (thetaLength * step) / steps;
      shape.lineTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius);
    }
  } else {
    shape.lineTo(0, 0);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.105,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    curveSegments: 3,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export class ArenaRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: MaybeRenderer;
  private readonly arenaRoot = new THREE.Group();
  private readonly effectRoot = new THREE.Group();
  private readonly attractRoot = new THREE.Group();
  private readonly blackHoleRoot = new THREE.Group();
  private readonly starRoot = new THREE.Group();
  private readonly debrisRoot = new THREE.Group();
  private readonly bands: BandVisual[] = [];
  private readonly playerVisuals = new Map<string, PlayerVisual>();
  private readonly effects = new Map<string, EffectVisual>();
  private readonly attractVisuals: PlayerVisual[] = [];
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly contextOverlay: HTMLDivElement | null;
  private readonly onResize = (): void => this.resize();
  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.showContextOverlay(true);
  };
  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    this.showContextOverlay(false);
    this.resize();
  };

  private previousState: RoomState | null = null;
  private latestState: RoomState | null = null;
  private latestLocalId: string | null = null;
  private snapshotReceivedAt = 0;
  private displayRadius = DEFAULT_RADIUS;
  private activeBoundary: THREE.Mesh | null = null;
  private activeBoundaryMaterial: THREE.MeshBasicMaterial | null = null;
  private starField: THREE.Points | null = null;
  private nebula: THREE.Sprite | null = null;
  private rafId: number | null = null;
  private lastFrameAt = 0;
  private disposed = false;
  private contextLost = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030817);
    this.scene.fog = new THREE.FogExp2(0x030817, 0.0045);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 19, 24);
    this.camera.lookAt(0, 0, 0);

    let renderer: MaybeRenderer = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        logarithmicDepthBuffer: false,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.18;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setClearColor(0x030817, 1);
    } catch {
      // A browser with WebGL disabled can still show the rest of the DOM UI.
      renderer = null;
    }
    this.renderer = renderer;

    this.contextOverlay = this.createContextOverlay();
    this.scene.add(this.starRoot, this.blackHoleRoot, this.arenaRoot, this.effectRoot, this.attractRoot, this.debrisRoot);
    this.createLights();
    this.createStarfield();
    this.createBlackHole();
    this.createArena();
    this.createAttractScene();

    canvas.addEventListener("webglcontextlost", this.onContextLost, false);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored, false);
    if (typeof window !== "undefined") window.addEventListener("resize", this.onResize, { passive: true });
    this.resize();
    this.lastFrameAt = typeof performance !== "undefined" ? performance.now() : 0;
    this.rafId = typeof window !== "undefined" ? window.requestAnimationFrame(this.renderLoop) : null;
  }

  /** Store a server snapshot; no authoritative state is mutated in the scene. */
  update(state: RoomState | null, localId: string | null): void {
    if (this.disposed) return;
    this.latestLocalId = localId;
    if (!state) {
      this.previousState = null;
      this.latestState = null;
      this.snapshotReceivedAt = typeof performance !== "undefined" ? performance.now() : 0;
      return;
    }
    this.previousState = this.latestState;
    this.latestState = cloneState(state);
    this.snapshotReceivedAt = typeof performance !== "undefined" ? performance.now() : 0;
  }

  /** Keep the camera and drawing buffer correct for portrait and landscape. */
  resize(): void {
    if (this.disposed || !this.renderer) return;
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.width || 1);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.height || 1);
    const aspect = width / height;
    const fitHalfWidth = 10.6;
    const distance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const portraitFov = (2 * Math.atan(fitHalfWidth / Math.max(1, distance * aspect)) * 180) / Math.PI;
    this.camera.fov = clamp(portraitFov, 34, 70);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const pixelRatio = typeof window !== "undefined" ? Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1) : 1;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null && typeof window !== "undefined") window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    if (typeof window !== "undefined") window.removeEventListener("resize", this.onResize);
    disposeObject(this.scene);
    this.renderer?.dispose();
    this.contextOverlay?.remove();
    this.playerVisuals.clear();
    this.effects.clear();
    this.attractVisuals.length = 0;
  }

  private readonly renderLoop = (now: number): void => {
    if (this.disposed) return;
    const delta = clamp((now - this.lastFrameAt) / 1000, 0, 0.1);
    this.lastFrameAt = now;
    this.animate(now, delta);
    if (this.renderer && !this.contextLost) this.renderer.render(this.scene, this.camera);
    if (typeof window !== "undefined") this.rafId = window.requestAnimationFrame(this.renderLoop);
  };

  private createContextOverlay(): HTMLDivElement | null {
    if (typeof document === "undefined" || !this.canvas.parentElement) return null;
    const overlay = document.createElement("div");
    overlay.textContent = "Graphics paused — reload to restore the arena view.";
    overlay.setAttribute("aria-live", "polite");
    overlay.style.cssText = [
      "position:absolute",
      "inset:0",
      "display:none",
      "place-items:center",
      "padding:24px",
      "box-sizing:border-box",
      "background:rgba(2,4,10,.92)",
      "color:#bfeeff",
      "font:600 14px/1.4 system-ui,sans-serif",
      "letter-spacing:.04em",
      "text-align:center",
      "pointer-events:none",
      "z-index:3",
    ].join(";");
    const parentStyle = window.getComputedStyle(this.canvas.parentElement);
    if (parentStyle.position === "static") this.canvas.parentElement.style.position = "relative";
    this.canvas.parentElement.appendChild(overlay);
    return overlay;
  }

  private showContextOverlay(show: boolean): void {
    if (this.contextOverlay) this.contextOverlay.style.display = show ? "grid" : "none";
  }

  private createLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x83d9ff, 0x11152c, 2.15));

    const keyLight = new THREE.DirectionalLight(0xd7efff, 3.2);
    keyLight.position.set(-8, 18, 12);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 45;
    keyLight.shadow.camera.left = -14;
    keyLight.shadow.camera.right = 14;
    keyLight.shadow.camera.top = 14;
    keyLight.shadow.camera.bottom = -14;
    this.scene.add(keyLight);

    const cyanLight = new THREE.PointLight(0x44eaff, 18, 26, 2);
    cyanLight.position.set(-5, 1.3, 4);
    this.scene.add(cyanLight);
    const violetLight = new THREE.PointLight(0x8b63ff, 19, 24, 2);
    violetLight.position.set(5, -1, -4);
    this.scene.add(violetLight);
  }

  private createStarfield(): void {
    const random = seededRandom(0x91a7c3);
    const positions: number[] = [];
    const colors: number[] = [];
    const starColors = [new THREE.Color(0xb9eaff), new THREE.Color(0x8c87ff), new THREE.Color(0xffffff)];
    for (let index = 0; index < 1050; index += 1) {
      const theta = random() * TAU;
      const phi = Math.acos(2 * random() - 1);
      const radius = 23 + random() * 28;
      const x = Math.sin(phi) * Math.cos(theta) * radius;
      const y = Math.cos(phi) * radius * 0.68 + 3;
      const z = Math.sin(phi) * Math.sin(theta) * radius;
      positions.push(x, y, z);
      const color = starColors[Math.floor(random() * starColors.length)];
      colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.11,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
    });
    this.starField = new THREE.Points(geometry, material);
    this.starRoot.add(this.starField);

    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (context) {
        const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 128);
        gradient.addColorStop(0, "rgba(75, 137, 255, .34)");
        gradient.addColorStop(0.45, "rgba(94, 75, 214, .14)");
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 256, 256);
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0.88,
        });
        this.nebula = new THREE.Sprite(spriteMaterial);
        this.nebula.position.set(0, 5, -18);
        this.nebula.scale.set(26, 18, 1);
        this.starRoot.add(this.nebula);
      }
    }
  }

  private createBlackHole(): void {
    // The arena floats in front of the singularity.  Keeping this set a few
    // units up and back lets the dark core and its ring read in the portrait
    // composition instead of disappearing underneath the playfield.
    this.blackHoleRoot.position.set(0, 3.55, -10.8);

    // A soft, procedural disk gives the singularity a luminous silhouette;
    // the crisp torus rings below then read as detail instead of a flat white
    // polygon.  It is a tiny canvas texture, not a downloaded asset.
    if (typeof document !== "undefined") {
      const diskCanvas = document.createElement("canvas");
      diskCanvas.width = 512;
      diskCanvas.height = 256;
      const diskContext = diskCanvas.getContext("2d");
      if (diskContext) {
        diskContext.clearRect(0, 0, diskCanvas.width, diskCanvas.height);
        diskContext.save();
        diskContext.translate(256, 128);
        diskContext.scale(1, 0.34);
        diskContext.filter = "blur(7px)";
        for (let stroke = 0; stroke < 7; stroke += 1) {
          const radius = 82 + stroke * 12;
          const gradient = diskContext.createLinearGradient(-radius, 0, radius, 0);
          gradient.addColorStop(0, "rgba(70, 213, 255, 0)");
          gradient.addColorStop(0.2, "rgba(70, 213, 255, .58)");
          gradient.addColorStop(0.5, stroke % 2 === 0 ? "rgba(190, 113, 255, .8)" : "rgba(106, 229, 255, .74)");
          gradient.addColorStop(0.8, "rgba(70, 213, 255, .58)");
          gradient.addColorStop(1, "rgba(70, 213, 255, 0)");
          diskContext.beginPath();
          diskContext.strokeStyle = gradient;
          diskContext.globalAlpha = 0.32 + stroke * 0.04;
          diskContext.lineWidth = 5 + stroke * 1.6;
          diskContext.ellipse(0, 0, radius * 1.55, radius, 0, 0, TAU);
          diskContext.stroke();
        }
        diskContext.restore();
        const diskTexture = new THREE.CanvasTexture(diskCanvas);
        diskTexture.colorSpace = THREE.SRGBColorSpace;
        const diskMaterial = new THREE.SpriteMaterial({
          map: diskTexture,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const disk = new THREE.Sprite(diskMaterial);
        disk.position.set(0, -1.78, -0.18);
        disk.scale.set(13.5, 5.3, 1);
        this.blackHoleRoot.add(disk);
      }
    }
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x010207,
      roughness: 0.98,
      metalness: 0.28,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(4.15, 48, 28), coreMaterial);
    core.position.y = -3.15;
    core.scale.set(1, 0.84, 1);
    core.castShadow = true;
    core.receiveShadow = true;
    this.blackHoleRoot.add(core);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x58d9ff,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = makeTorus(4.65, 0.22, ringMaterial, 64, 14);
    ring.position.y = -1.82;
    ring.scale.set(1, 0.43, 1);
    this.blackHoleRoot.add(ring);

    const innerMaterial = new THREE.MeshBasicMaterial({
      color: 0xb47aff,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const innerRing = makeTorus(5.32, 0.048, innerMaterial, 64, 8);
    innerRing.position.y = -1.74;
    innerRing.scale.set(1, 0.39, 1);
    this.blackHoleRoot.add(innerRing);

    const hotRing = makeTorus(3.95, 0.032, new THREE.MeshBasicMaterial({
      color: 0xf5b9ff,
      transparent: true,
      opacity: 0.74,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }), 64, 8);
    hotRing.position.y = -1.68;
    hotRing.scale.set(1, 0.48, 1);
    this.blackHoleRoot.add(hotRing);

    const horizon = new THREE.Mesh(
      new THREE.SphereGeometry(4.24, 40, 24),
      new THREE.MeshBasicMaterial({ color: 0x000106, transparent: true, opacity: 0.64 }),
    );
    horizon.position.y = -3.15;
    horizon.scale.set(1, 0.84, 1);
    this.blackHoleRoot.add(horizon);

    const random = seededRandom(0x5ea11);
    for (let index = 0; index < 14; index += 1) {
      const angle = random() * TAU;
      const radius = 5.9 + random() * 3.7;
      const size = 0.035 + random() * 0.1;
      const material = new THREE.MeshStandardMaterial({
        color: index % 2 === 0 ? 0x85d8ff : 0xaa76ff,
        emissive: index % 2 === 0 ? 0x154e68 : 0x321356,
        emissiveIntensity: 1.8,
        metalness: 0.72,
        roughness: 0.32,
      });
      const debris = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), material);
      debris.position.set(Math.cos(angle) * radius, -1.4 + (random() - 0.5) * 1.8, Math.sin(angle) * radius);
      debris.rotation.set(random() * TAU, random() * TAU, random() * TAU);
      debris.castShadow = true;
      this.debrisRoot.add(debris);
    }
  }

  private createArena(): void {
    const pedestalMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a131f,
      metalness: 0.9,
      roughness: 0.29,
    });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(9.15, 9.62, 0.5, 96, 1, true), pedestalMaterial);
    pedestal.position.y = -0.36;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    this.arenaRoot.add(pedestal);

    const undersideMaterial = new THREE.MeshStandardMaterial({
      color: 0x07101d,
      metalness: 0.85,
      roughness: 0.42,
    });
    const underside = new THREE.Mesh(new THREE.CylinderGeometry(8.75, 9.2, 0.12, 96), undersideMaterial);
    underside.position.y = -0.08;
    underside.castShadow = true;
    underside.receiveShadow = true;
    this.arenaRoot.add(underside);

    const seamMaterials = [
      new THREE.MeshBasicMaterial({ color: 0x3aeaff, transparent: true, opacity: 0.36, blending: THREE.AdditiveBlending, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0x8a6cff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0x52eaff, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xaa76ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
    ];
    const radii = [3, 5, 7, 9];
    const segmentCount = 20;
    for (let bandIndex = 0; bandIndex < radii.length; bandIndex += 1) {
      const outerRadius = radii[bandIndex];
      const innerRadius = bandIndex === 0 ? 0 : radii[bandIndex - 1];
      const group = new THREE.Group();
      group.name = `arena-band-${outerRadius}`;
      const material = new THREE.MeshStandardMaterial({
        color: bandIndex % 2 === 0 ? 0x456b7d : 0x3d5874,
        metalness: 0.86,
        roughness: 0.38,
        emissive: bandIndex % 2 === 0 ? 0x174c62 : 0x2a2160,
        emissiveIntensity: 1.45,
        side: THREE.DoubleSide,
      });
      const alternateMaterial = new THREE.MeshStandardMaterial({
        color: bandIndex % 2 === 0 ? 0x527f8e : 0x4c6790,
        metalness: 0.82,
        roughness: 0.4,
        emissive: bandIndex % 2 === 0 ? 0x1d5d70 : 0x382b72,
        emissiveIntensity: 1.28,
        side: THREE.DoubleSide,
      });
      // A continuous, slightly recessed plate gives every collapsed ring a
      // readable metal silhouette.  Segmented tiles and emissive seams sit
      // above it, while the whole plate still falls away with its band.
      const plateMaterial = new THREE.MeshStandardMaterial({
        color: bandIndex % 2 === 0 ? 0x35566a : 0x33486b,
        metalness: 0.76,
        roughness: 0.44,
        emissive: bandIndex % 2 === 0 ? 0x16405a : 0x27205a,
        emissiveIntensity: 1.35,
        side: THREE.DoubleSide,
      });
      const plateGeometry = new THREE.RingGeometry(
        innerRadius + (innerRadius > 0 ? 0.018 : 0),
        outerRadius - 0.018,
        96,
        1,
      );
      plateGeometry.rotateX(-Math.PI / 2);
      const plate = new THREE.Mesh(plateGeometry, plateMaterial);
      plate.position.y = 0.045 + bandIndex * 0.012;
      plate.receiveShadow = true;
      group.add(plate);
      const gap = TAU / segmentCount * 0.08;
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const theta = (segment / segmentCount) * TAU;
        const geometry = makeSectorGeometry(
          innerRadius + (innerRadius > 0 ? 0.035 : 0),
          outerRadius - 0.05,
          theta + gap,
          TAU / segmentCount - gap * 2,
        );
        const tile = new THREE.Mesh(geometry, segment % 2 === 0 ? material : alternateMaterial);
        tile.position.y = 0.08 + bandIndex * 0.012;
        tile.castShadow = true;
        tile.receiveShadow = true;
        group.add(tile);

        // A few structural spokes keep the arena legible without turning the
        // whole playfield into a luminous wireframe.
        if (segment % 4 === 0) {
          const radialSeam = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.025, outerRadius - innerRadius - 0.16), seamMaterials[bandIndex]);
          const middle = (innerRadius + outerRadius) / 2;
          radialSeam.position.set(Math.cos(theta) * middle, 0.19 + bandIndex * 0.012, Math.sin(theta) * middle);
          radialSeam.rotation.y = theta - Math.PI / 2;
          group.add(radialSeam);
        }
      }
      const boundary = makeTorus(outerRadius - 0.06, bandIndex === 3 ? 0.08 : 0.052, seamMaterials[bandIndex], 64, 8);
      boundary.position.y = 0.14 + bandIndex * 0.012;
      group.add(boundary);
      group.position.y = 0.08;
      this.arenaRoot.add(group);
      this.bands.push({ group, innerRadius, outerRadius, baseY: 0.08, index: bandIndex });
    }

    const centerPlate = new THREE.Mesh(
      new THREE.CircleGeometry(2.36, 48),
      new THREE.MeshStandardMaterial({ color: 0x101d2d, metalness: 0.92, roughness: 0.27, emissive: 0x071628, emissiveIntensity: 0.8 }),
    );
    centerPlate.rotation.x = -Math.PI / 2;
    centerPlate.position.y = 0.16;
    centerPlate.receiveShadow = true;
    this.arenaRoot.add(centerPlate);

    this.activeBoundaryMaterial = new THREE.MeshBasicMaterial({
      color: 0x81efff,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.activeBoundary = makeTorus(8.95, 0.065, this.activeBoundaryMaterial, 64, 8);
    this.activeBoundary.position.y = 0.22;
    this.arenaRoot.add(this.activeBoundary);
  }

  private createAttractScene(): void {
    const samples = [
      { id: "__attract-cyan", name: "DEMO", color: "#4deaff", x: -4.55, z: 2.2 },
      { id: "__attract-violet", name: "DEMO", color: "#a77bff", x: 3.5, z: 2.7 },
      { id: "__attract-amber", name: "DEMO", color: "#ffc66c", x: 0.2, z: -3.7 },
    ];
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const visual = this.createPlayerVisual(sample.id, sample.name, sample.color, true);
      visual.root.position.set(sample.x, 0.22, sample.z);
      visual.root.rotation.y = index * 2.2;
      this.attractRoot.add(visual.root);
      this.attractVisuals.push(visual);
    }
  }

  private createPlayerVisual(id: string, name: string, colorValue: string, decorative: boolean): PlayerVisual {
    const root = new THREE.Group();
    root.name = decorative ? `attract-${id}` : `player-${id}`;
    const body = new THREE.Group();
    body.position.y = 0.12;
    root.add(body);

    const accentColor = colorOrFallback(colorValue, 0x4deaff);
    const accentHex = `#${accentColor.getHexString()}`;
    const suitMaterial = this.getSuitMaterial();
    const darkMaterial = this.getDarkMaterial();
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: decorative ? 1.9 : 1.25,
      metalness: 0.6,
      roughness: 0.25,
    });
    const visorMaterial = new THREE.MeshStandardMaterial({
      color: 0x01060d,
      emissive: accentColor.clone().multiplyScalar(0.17),
      emissiveIntensity: 1.2,
      metalness: 0.58,
      roughness: 0.12,
    });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.29, 0.32, 6, 12), suitMaterial);
    torso.position.y = 0.78;
    torso.scale.set(0.9, 1, 0.72);
    torso.castShadow = true;
    torso.receiveShadow = true;
    body.add(torso);

    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.2, 0.045), accentMaterial);
    chestPlate.position.set(0, 0.87, 0.235);
    chestPlate.castShadow = true;
    body.add(chestPlate);
    const chestCore = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.062, 0.06), new THREE.MeshBasicMaterial({ color: 0xcaf8ff, transparent: true, opacity: 0.95 }));
    chestCore.position.set(0, 0.88, 0.268);
    body.add(chestCore);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.11, 10), darkMaterial);
    neck.position.y = 1.16;
    neck.castShadow = true;
    body.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.285, 16, 12), suitMaterial);
    head.position.y = 1.38;
    head.scale.set(0.96, 1, 0.86);
    head.castShadow = true;
    head.receiveShadow = true;
    body.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.085), visorMaterial);
    visor.position.set(0, 1.39, 0.225);
    visor.rotation.x = -0.06;
    visor.castShadow = true;
    body.add(visor);
    const visorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.018, 0.014), new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending }));
    visorGlow.position.set(0, 1.4, 0.274);
    body.add(visorGlow);

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.45, 0.2), darkMaterial);
    backpack.position.set(0, 0.9, -0.27);
    backpack.castShadow = true;
    backpack.receiveShadow = true;
    body.add(backpack);
    const backpackLight = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.025), accentMaterial);
    backpackLight.position.set(0, 0.93, -0.386);
    body.add(backpackLight);

    const leftArm = this.createArm(-1, suitMaterial, accentMaterial, darkMaterial);
    const rightArm = this.createArm(1, suitMaterial, accentMaterial, darkMaterial);
    const leftLeg = this.createLeg(-1, suitMaterial, accentMaterial, darkMaterial);
    const rightLeg = this.createLeg(1, suitMaterial, accentMaterial, darkMaterial);
    body.add(leftArm, rightArm, leftLeg, rightLeg);

    const auraMaterial = new THREE.MeshBasicMaterial({
      color: accentColor,
      transparent: true,
      opacity: decorative ? 0.12 : 0.07,
      wireframe: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const aura = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 10), auraMaterial);
    aura.position.y = 0.85;
    aura.scale.set(0.78, 1.2, 0.78);
    root.add(aura);

    const chargeRingMaterial = new THREE.MeshBasicMaterial({
      color: accentColor,
      transparent: true,
      opacity: decorative ? 0.7 : 0.44,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const chargeRing = makeTorus(0.44, 0.018, chargeRingMaterial, 32, 6);
    chargeRing.position.y = 0.16;
    root.add(chargeRing);

    const localMarker = makeTorus(0.58, 0.018, new THREE.MeshBasicMaterial({
      color: 0xf4fdff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }), 32, 6);
    localMarker.position.y = 0.18;
    localMarker.visible = false;
    root.add(localMarker);

    let nameSprite: THREE.Sprite | undefined;
    const texture = makeLabelTexture(decorative ? "DEMO // ATTRACT" : name, accentHex);
    if (texture) {
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: decorative ? 0.68 : 0.82 });
      nameSprite = new THREE.Sprite(material);
      nameSprite.position.y = 2.13;
      nameSprite.scale.set(decorative ? 1.9 : 1.52, decorative ? 0.36 : 0.34, 1);
      root.add(nameSprite);
    }

    return {
      root,
      body,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      aura,
      chargeRing,
      localMarker,
      accentMaterial,
      auraMaterial,
      nameSprite,
      id,
      decorative,
      seed: hashString(id),
      deathStartedAt: null,
      wasAlive: true,
    };
  }

  private createArm(sign: number, suitMaterial: THREE.Material, accentMaterial: THREE.Material, darkMaterial: THREE.Material): THREE.Group {
    const arm = new THREE.Group();
    arm.position.set(sign * 0.38, 1.04, 0);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), accentMaterial);
    shoulder.castShadow = true;
    arm.add(shoulder);
    arm.add(makeLimbSegment(0.34, 0.078, suitMaterial));
    const forearm = new THREE.Group();
    forearm.position.y = -0.34;
    forearm.add(makeLimbSegment(0.3, 0.072, suitMaterial));
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), darkMaterial);
    glove.position.y = -0.31;
    glove.castShadow = true;
    forearm.add(glove);
    arm.add(forearm);
    return arm;
  }

  private createLeg(sign: number, suitMaterial: THREE.Material, accentMaterial: THREE.Material, darkMaterial: THREE.Material): THREE.Group {
    const leg = new THREE.Group();
    leg.position.set(sign * 0.16, 0.48, 0);
    leg.add(makeLimbSegment(0.36, 0.09, suitMaterial));
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), accentMaterial);
    knee.position.y = -0.37;
    knee.castShadow = true;
    leg.add(knee);
    const shin = new THREE.Group();
    shin.position.y = -0.4;
    shin.add(makeLimbSegment(0.32, 0.078, suitMaterial));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.31), darkMaterial);
    boot.position.set(0, -0.32, 0.045);
    boot.castShadow = true;
    shin.add(boot);
    leg.add(shin);
    return leg;
  }

  private getSuitMaterial(): THREE.MeshStandardMaterial {
    const key = "suit";
    const existing = this.materialCache.get(key);
    if (existing) return existing;
    const material = new THREE.MeshStandardMaterial({ color: 0x172433, metalness: 0.72, roughness: 0.3 });
    this.materialCache.set(key, material);
    return material;
  }

  private getDarkMaterial(): THREE.MeshStandardMaterial {
    const key = "dark";
    const existing = this.materialCache.get(key);
    if (existing) return existing;
    const material = new THREE.MeshStandardMaterial({ color: 0x050b13, metalness: 0.82, roughness: 0.24 });
    this.materialCache.set(key, material);
    return material;
  }

  private animate(now: number, delta: number): void {
    const elapsed = now * 0.001;
    this.starRoot.rotation.y = elapsed * 0.002;
    this.debrisRoot.rotation.y = elapsed * 0.055;
    this.blackHoleRoot.rotation.y = elapsed * 0.018;
    this.blackHoleRoot.rotation.x = Math.sin(elapsed * 0.16) * 0.008;

    this.animateArena(now, delta);
    this.animatePlayers(now);
    this.animateEffects(now);
  }

  private animateArena(now: number, delta: number): void {
    const targetRadius = clamp(this.latestState?.radius ?? DEFAULT_RADIUS, 0, DEFAULT_RADIUS);
    this.displayRadius = lerp(this.displayRadius, targetRadius, 1 - Math.pow(0.0001, delta));
    for (const band of this.bands) {
      const collapse = 1 - smoothstep(band.innerRadius, band.outerRadius, this.displayRadius);
      const lift = 0.95 + band.index * 0.19;
      band.group.position.y = band.baseY - collapse * lift;
      band.group.rotation.z = Math.sin(now * 0.00022 + band.index * 1.8) * collapse * 0.04;
      band.group.rotation.x = Math.cos(now * 0.00019 + band.index * 0.8) * collapse * 0.025;
      const scale = 1 - collapse * 0.035;
      band.group.scale.set(scale, scale, scale);
      band.group.visible = collapse < 0.995;
    }
    if (this.activeBoundary) {
      const boundaryRadius = Math.max(0.5, this.displayRadius - 0.08);
      this.activeBoundary.scale.setScalar(boundaryRadius / 8.95);
      this.activeBoundary.visible = targetRadius > 0.2;
      if (this.activeBoundaryMaterial) {
        this.activeBoundaryMaterial.opacity = 0.58 + Math.sin(now * 0.003) * 0.16;
        this.activeBoundaryMaterial.color.set(targetRadius <= 3 ? 0xa478ff : 0x69efff);
      }
    }
  }

  private animatePlayers(now: number): void {
    const state = this.latestState;
    this.attractRoot.visible = !state;
    if (!state) {
      for (const visual of this.attractVisuals) this.animateDecorativePlayer(visual, now);
      for (const visual of this.playerVisuals.values()) visual.root.visible = false;
      return;
    }

    const alpha = clamp((now - this.snapshotReceivedAt) / INTERPOLATION_MS, 0, 1);
    const presentIds = new Set<string>();
    for (const player of state.players) {
      presentIds.add(player.id);
      let visual = this.playerVisuals.get(player.id);
      if (!visual) {
        visual = this.createPlayerVisual(player.id, player.name, player.color, false);
        this.playerVisuals.set(player.id, visual);
        this.arenaRoot.add(visual.root);
      }
      visual.root.visible = true;
      const previous = findPlayer(this.previousState, player.id);
      const display: DisplayPlayer = {
        id: player.id,
        name: player.name,
        color: player.color,
        x: previous ? lerp(previous.x, player.x, alpha) : player.x,
        z: previous ? lerp(previous.z, player.z, alpha) : player.z,
        vx: previous ? lerp(previous.vx, player.vx, alpha) : player.vx,
        vz: previous ? lerp(previous.vz, player.vz, alpha) : player.vz,
        alive: player.alive,
        charge: clamp(previous ? lerp(previous.charge, player.charge, alpha) : player.charge, 0, 1),
      };
      this.animatePlayer(visual, display, now, player.id === this.latestLocalId);
    }
    for (const [id, visual] of this.playerVisuals) {
      if (!presentIds.has(id)) visual.root.visible = false;
    }
  }

  private animateDecorativePlayer(visual: PlayerVisual, now: number): void {
    const t = now * 0.00035 + visual.seed * 5;
    const baseX = visual.id.includes("violet") ? 3.5 : visual.id.includes("amber") ? 0.2 : -4.55;
    const baseZ = visual.id.includes("violet") ? 2.7 : visual.id.includes("amber") ? -3.7 : 2.2;
    visual.root.position.x = baseX + Math.sin(t * 1.4) * 0.25;
    visual.root.position.z = baseZ + Math.cos(t * 1.1) * 0.18;
    visual.root.position.y = 0.2 + Math.sin(t * 2.3) * 0.08;
    visual.root.rotation.y = t * 0.9 + visual.seed * 4;
    this.animateRobotLimbs(visual, Math.sin(t * 5) * 0.18, now);
    visual.aura.scale.set(0.84 + Math.sin(t * 2) * 0.04, 1.25 + Math.sin(t * 2) * 0.05, 0.84 + Math.sin(t * 2) * 0.04);
    visual.chargeRing.scale.setScalar(1.04 + Math.sin(t * 3) * 0.08);
  }

  private animatePlayer(visual: PlayerVisual, player: DisplayPlayer, now: number, isLocal: boolean): void {
    const speed = Math.hypot(player.vx, player.vz);
    const walking = clamp(speed / 3.8, 0, 1);
    const phase = now * (0.008 + walking * 0.024) + visual.seed * 13;
    if (visual.wasAlive && !player.alive) visual.deathStartedAt = now;
    visual.wasAlive = player.alive;

    let death = 0;
    if (!player.alive) death = smoothstep(0, 800, now - (visual.deathStartedAt ?? now));
    visual.root.position.x = player.x;
    visual.root.position.z = player.z;
    visual.root.position.y = 0.2 - death * 0.78;
    visual.root.rotation.y = speed > 0.12 ? Math.atan2(player.vx, player.vz) : visual.root.rotation.y;
    visual.root.rotation.z = death * (visual.seed > 0.5 ? 1.15 : -1.15);
    visual.root.scale.setScalar(1 - death * 0.14);
    visual.localMarker.visible = isLocal && player.alive;
    if (visual.localMarker.visible) visual.localMarker.rotation.z = now * 0.0014;

    this.animateRobotLimbs(visual, Math.sin(phase) * (0.11 + walking * 0.48) * (1 - death), now);
    const charge = clamp(player.charge, 0, 1);
    const auraScale = 0.76 + charge * 0.3 + Math.sin(phase * 0.6) * 0.025;
    visual.aura.scale.set(auraScale, 1.12 + charge * 0.42, auraScale);
    visual.auraMaterial.opacity = (0.045 + charge * 0.13) * (1 - death * 0.7);
    visual.chargeRing.scale.setScalar(0.9 + charge * 0.38 + Math.sin(phase) * 0.04);
    (visual.chargeRing.material as THREE.MeshBasicMaterial).opacity = (0.25 + charge * 0.58) * (1 - death * 0.75);
    visual.accentMaterial.emissiveIntensity = 1.05 + charge * 1.45;
    if (visual.nameSprite) visual.nameSprite.material.opacity = (0.52 + charge * 0.2) * (1 - death);
  }

  private animateRobotLimbs(visual: PlayerVisual, swing: number, now: number): void {
    visual.leftArm.rotation.z = -swing * 0.75;
    visual.rightArm.rotation.z = swing * 0.75;
    visual.leftArm.rotation.x = Math.sin(now * 0.004 + visual.seed) * 0.05;
    visual.rightArm.rotation.x = Math.sin(now * 0.004 + visual.seed + 1.2) * 0.05;
    visual.leftLeg.rotation.z = swing * 0.44;
    visual.rightLeg.rotation.z = -swing * 0.44;
    visual.leftLeg.rotation.x = -swing * 0.17;
    visual.rightLeg.rotation.x = swing * 0.17;
  }

  private animateEffects(now: number): void {
    const state = this.latestState;
    if (!state) {
      for (const effect of this.effects.values()) effect.group.visible = false;
      return;
    }
    const activeIds = new Set<string>();
    for (const event of state.events) {
      activeIds.add(event.id);
      let effect = this.effects.get(event.id);
      if (!effect) {
        effect = this.createEffect(event, now);
        this.effects.set(event.id, effect);
        this.effectRoot.add(effect.group);
      }
      const age = (now - effect.startedAt) / 1000;
      if (age > effect.duration + 0.08) {
        this.removeEffect(effect.id);
        continue;
      }
      effect.group.visible = true;
      this.updateEffect(effect, event, Math.max(0, age));
    }
    for (const [id, effect] of this.effects) {
      if (!activeIds.has(id)) {
        const age = (now - effect.startedAt) / 1000;
        if (age > effect.duration + 0.35) this.removeEffect(id);
      }
    }
  }

  private createEffect(event: GameEvent, now: number): EffectVisual {
    const group = new THREE.Group();
    group.position.set(event.x, 0.28, event.z);
    group.name = `effect-${event.type}-${event.id}`;
    const color = event.type === "dash" ? 0x62f2ff : event.type === "collapse" ? 0xa874ff : event.type === "elimination" ? 0xff7fe5 : 0x7ceeff;
    const secondaryColor = event.type === "elimination" ? 0xffcf81 : 0xb16cff;
    const primaryMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const secondaryMaterial = new THREE.MeshBasicMaterial({ color: secondaryColor, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    const angle = hashString(event.id) * TAU;
    let duration = event.type === "dash" ? 0.58 : event.type === "collapse" ? 1.7 : event.type === "elimination" ? 1.45 : 1.25;
    const effect: EffectVisual = { id: event.id, type: event.type, group, startedAt: now, duration, primaryMaterial, secondaryMaterial, angle };

    if (event.type === "wave") {
      const ring = makeTorus(1, 0.035, primaryMaterial, 48, 8);
      const secondaryRing = makeTorus(1, 0.013, secondaryMaterial, 48, 6);
      secondaryRing.position.y = 0.018;
      group.add(ring, secondaryRing);
      effect.ring = ring;
      effect.secondaryRing = secondaryRing;
    } else if (event.type === "dash") {
      const trail = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 2.15), primaryMaterial);
      trail.position.y = 0.08;
      trail.rotation.y = angle;
      trail.scale.x = 0.8;
      const ring = makeTorus(0.31, 0.024, secondaryMaterial, 32, 6);
      ring.position.y = 0.06;
      group.add(trail, ring);
      effect.ring = trail;
      effect.secondaryRing = ring;
    } else if (event.type === "collapse") {
      const radius = Math.max(1, event.radius ?? 5);
      const ring = makeTorus(radius, 0.055, primaryMaterial, 64, 8);
      const secondaryRing = makeTorus(radius * 0.82, 0.025, secondaryMaterial, 64, 8);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.16, 2.2, 8), primaryMaterial);
      beam.position.y = 1.06;
      group.add(ring, secondaryRing, beam);
      effect.ring = ring;
      effect.secondaryRing = secondaryRing;
      effect.beam = beam;
    } else {
      const ring = makeTorus(0.72, 0.05, primaryMaterial, 40, 8);
      ring.position.y = 0.05;
      group.add(ring);
      effect.ring = ring;
      const particles: THREE.Mesh[] = [];
      const random = seededRandom(Math.floor(hashString(event.id) * 0xffffffff));
      for (let index = 0; index < 9; index += 1) {
        const particle = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045 + random() * 0.035, 0), index % 2 === 0 ? primaryMaterial : secondaryMaterial);
        particle.userData = { angle: random() * TAU, speed: 0.8 + random() * 1.5, lift: 0.35 + random() * 0.9 };
        group.add(particle);
        particles.push(particle);
      }
      effect.particles = particles;
    }
    return effect;
  }

  private updateEffect(effect: EffectVisual, event: GameEvent, age: number): void {
    const progress = clamp(age / effect.duration, 0, 1);
    const eased = smoothstep(0, 1, progress);
    if (effect.type === "wave") {
      const maxRadius = Math.max(1.3, event.radius ?? 3.8);
      const radius = 0.25 + maxRadius * eased;
      effect.ring?.scale.setScalar(radius);
      effect.secondaryRing?.scale.setScalar(radius * 0.78);
      if (effect.primaryMaterial) effect.primaryMaterial.opacity = (1 - progress) * 0.86;
      if (effect.secondaryMaterial) effect.secondaryMaterial.opacity = (1 - progress) * 0.62;
      effect.group.position.y = 0.18 + Math.sin(progress * Math.PI) * 0.08;
    } else if (effect.type === "dash") {
      if (effect.ring) {
        effect.ring.scale.z = 0.5 + (1 - progress) * 1.25;
        effect.ring.scale.x = 0.7 + progress * 0.3;
      }
      effect.secondaryRing?.scale.setScalar(0.95 + progress * 0.65);
      effect.group.rotation.y = effect.angle + progress * 0.12;
      if (effect.primaryMaterial) effect.primaryMaterial.opacity = (1 - progress) * 0.85;
      if (effect.secondaryMaterial) effect.secondaryMaterial.opacity = (1 - progress) * 0.68;
    } else if (effect.type === "collapse") {
      effect.ring?.scale.setScalar(1 + progress * 0.14);
      effect.secondaryRing?.scale.setScalar(1 + progress * 0.3);
      if (effect.beam) {
        effect.beam.scale.y = 0.24 + (1 - progress) * 1.25;
        effect.beam.position.y = 0.95 + (1 - progress) * 0.3;
      }
      if (effect.primaryMaterial) effect.primaryMaterial.opacity = (1 - progress) * 0.9;
      if (effect.secondaryMaterial) effect.secondaryMaterial.opacity = (1 - progress) * 0.65;
    } else {
      effect.ring?.scale.setScalar(0.45 + eased * 1.5);
      if (effect.ring) effect.ring.rotation.z = progress * 1.5;
      if (effect.particles) {
        for (const particle of effect.particles) {
          const data = particle.userData as { angle: number; speed: number; lift: number };
          const distance = data.speed * eased * 1.15;
          particle.position.set(Math.cos(data.angle) * distance, data.lift * eased - eased * eased * 0.72, Math.sin(data.angle) * distance);
          particle.rotation.x += 0.08;
          particle.rotation.y += 0.11;
          particle.scale.setScalar(1 - progress * 0.4);
        }
      }
      if (effect.primaryMaterial) effect.primaryMaterial.opacity = (1 - progress) * 0.9;
      if (effect.secondaryMaterial) effect.secondaryMaterial.opacity = (1 - progress) * 0.78;
      effect.group.position.y = 0.25 + eased * 0.3;
    }
  }

  private removeEffect(id: string): void {
    const effect = this.effects.get(id);
    if (!effect) return;
    this.effectRoot.remove(effect.group);
    disposeObject(effect.group);
    this.effects.delete(id);
  }
}

export default ArenaRenderer;
