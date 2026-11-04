import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  SkinnedMesh,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

export type PatientScene = {
  setSpeaking: (speaking: boolean) => void;
  dispose: () => void;
};

const MIN_FRAME_MS = 1000 / 30;
const MAX_PIXEL_RATIO = 1.5;
const MAX_BUFFER_WIDTH = 960;
const MAX_BUFFER_HEIGHT = 630;

function releaseModel(model: Group) {
  const textures = new Set<Texture>();
  const materials = new Set<import("three").Material>();
  const geometries = new Set<import("three").BufferGeometry>();
  const skeletons = new Set<import("three").Skeleton>();
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
  });
  const bitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    if (
      typeof ImageBitmap !== "undefined" &&
      texture.image instanceof ImageBitmap
    )
      bitmaps.add(texture.image);
    texture.dispose();
  }
  bitmaps.forEach((bitmap) => bitmap.close());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
}

export async function mountPatientScene(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  onContextLost: () => void,
): Promise<PatientScene> {
  signal.throwIfAborted();
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(31, 1, 0.03, 8);
  const key = new DirectionalLight(0xffe7d7, 2.0);
  key.position.set(-2, 4, 4);
  const rim = new DirectionalLight(0xd1b6ff, 1.15);
  rim.position.set(2, 3, -4);
  scene.add(new AmbientLight(0xf4edff, 1.15), key, rim);

  let model: Group | undefined;
  let disposed = false;
  let speaking = false;
  let visible = true;
  let frame = 0;
  let lastPaint = 0;
  let observer: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const morphs: Array<{
    weights: number[];
    jaw?: number;
    left?: number;
    right?: number;
  }> = [];
  const center = new Vector3();
  let faceHeight = 0;
  let head: import("three").Object3D | undefined;
  let headYaw = 0;
  const paint = (time: number) => {
    if (!model || disposed || !visible || document.hidden) return;
    const seconds = time / 1000;
    // This is a visual accompaniment to existing audio, not phoneme alignment.
    const jaw = speaking
      ? 0.06 + 0.19 * Math.abs(Math.sin(seconds * 11) * Math.cos(seconds * 3.7))
      : 0;
    const blink = speaking
      ? Math.max(0.08, 1 - Math.abs((seconds % 4.7) - 4.4) / 0.1)
      : 0.08;
    for (const target of morphs) {
      if (target.jaw !== undefined) target.weights[target.jaw] = jaw;
      if (target.left !== undefined) target.weights[target.left] = blink;
      if (target.right !== undefined) target.weights[target.right] = blink;
    }
    if (head)
      head.rotation.y =
        headYaw + 0.04 + (speaking ? Math.sin(seconds * 1.2) * 0.037 : 0);
    renderer.render(scene, camera);
    lastPaint = time;
  };
  const animate = (time: number) => {
    frame = 0;
    if (!speaking || disposed || !visible || document.hidden) return;
    if (time - lastPaint >= MIN_FRAME_MS) paint(time);
    frame = requestAnimationFrame(animate);
  };
  const sync = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    paint(performance.now());
    if (speaking && visible && !document.hidden && !disposed)
      frame = requestAnimationFrame(animate);
  };
  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!model || disposed || width < 1 || height < 1) return;
    camera.aspect = width / height;
    camera.position.set(
      center.x,
      center.y - faceHeight * 0.16,
      center.z +
        Math.max(faceHeight * 3.45, (faceHeight * 2.65) / camera.aspect),
    );
    camera.lookAt(center.x, center.y - faceHeight * 0.16, center.z);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(
      Math.min(
        devicePixelRatio,
        MAX_PIXEL_RATIO,
        MAX_BUFFER_WIDTH / width,
        MAX_BUFFER_HEIGHT / height,
      ),
    );
    renderer.setSize(width, height, false);
    paint(performance.now());
  };
  const lost = (event: Event) => {
    event.preventDefault();
    onContextLost();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    resizeObserver?.disconnect();
    signal.removeEventListener("abort", dispose);
    canvas.removeEventListener("webglcontextlost", lost);
    document.removeEventListener("visibilitychange", sync);
    if (model) releaseModel(model);
    renderer.dispose();
  };
  signal.addEventListener("abort", dispose, { once: true });
  canvas.addEventListener("webglcontextlost", lost);
  try {
    const response = await fetch("/avatars/patient-violet.glb", { signal });
    if (!response.ok) throw new Error("avatar_asset_unavailable");
    const data = await response.arrayBuffer();
    signal.throwIfAborted();
    const loaded = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(data, "");
    if (signal.aborted) {
      releaseModel(loaded.scene);
      signal.throwIfAborted();
    }
    model = loaded.scene;
    scene.add(model);
    model.updateMatrixWorld(true);
    head = model.getObjectByName("Head");
    if (!head) throw new Error("avatar_rig_missing");
    headYaw = head.rotation.y;
    head.getWorldPosition(center);
    // Framing is calibrated to this asset's MPFB head rig, in metres.
    faceHeight = 0.26;
    center.y += 0.09;
    model.traverse((node) => {
      if (
        !(node instanceof Mesh) ||
        !node.morphTargetInfluences ||
        !node.morphTargetDictionary
      )
        return;
      const {
        jawOpen: jaw,
        eyeBlinkLeft: left,
        eyeBlinkRight: right,
      } = node.morphTargetDictionary;
      morphs.push({ weights: node.morphTargetInfluences, jaw, left, right });
    });
    if (!morphs.some(({ jaw }) => jaw !== undefined))
      throw new Error("avatar_speech_rig_missing");
    observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      sync();
    });
    observer.observe(canvas);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    resize();
    return {
      setSpeaking: (active) => {
        if (active === speaking) return;
        speaking = active;
        sync();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
