import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
  faceIndex: number;
}

export type CameraProjection = "orthographic" | "perspective";
export type ShadingMode = "flat" | "original";

export class PointerGestureTracker {
  private readonly pointerStarts = new Map<
    number,
    { x: number; y: number }
  >();
  private dragged = false;

  start(pointerId: number, x: number, y: number): void {
    if (this.pointerStarts.size === 0) this.dragged = false;
    this.pointerStarts.set(pointerId, { x, y });
  }

  move(pointerId: number, x: number, y: number): void {
    const start = this.pointerStarts.get(pointerId);
    if (!start) return;

    const deltaX = x - start.x;
    const deltaY = y - start.y;
    if (deltaX * deltaX + deltaY * deltaY > 5 ** 2) {
      this.dragged = true;
    }
  }

  end(pointerId: number, x: number, y: number): void {
    this.move(pointerId, x, y);
    this.pointerStarts.delete(pointerId);
  }

  consumeDrag(): boolean {
    const dragged = this.dragged;
    this.dragged = false;
    return dragged;
  }
}

const FACE_COLOR = 0x9caec2;
const SELECTED_FACE_COLOR = 0xffc7c7;
const EDGE_COLOR = 0x000000;

export function fitCameraToBounds(
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
  target: THREE.Vector3,
): void {
  if (bounds.isEmpty()) return;

  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 0.01);
  const direction = camera.position.clone().sub(target);
  if (direction.lengthSq() === 0) direction.set(1.8, 1.8, 2.4);
  direction.normalize();
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const halfFov = Math.min(verticalFov, horizontalFov) / 2;
  const distance = (radius * 1.15) / Math.sin(halfFov);

  target.copy(center);
  camera.position.copy(center).add(direction.multiplyScalar(distance));
  camera.near = Math.max(radius / 1000, 0.001);
  camera.far = radius * 100;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

export function fitOrthographicCameraToBounds(
  camera: THREE.OrthographicCamera,
  bounds: THREE.Box3,
  target: THREE.Vector3,
  aspect: number,
): void {
  if (bounds.isEmpty()) return;

  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 0.01);
  const direction = camera.position.clone().sub(target);
  if (direction.lengthSq() === 0) direction.set(1.8, 1.8, 2.4);
  direction.normalize();

  const verticalSpan = (radius * 2.3) / Math.min(aspect, 1);
  camera.left = -(verticalSpan * aspect) / 2;
  camera.right = (verticalSpan * aspect) / 2;
  camera.top = verticalSpan / 2;
  camera.bottom = -verticalSpan / 2;
  target.copy(center);
  camera.position.copy(center).add(direction.multiplyScalar(radius * 3));
  camera.near = Math.max(radius / 1000, 0.001);
  camera.far = radius * 100;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

export function createFaceGeometry(mesh: TriangleMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createFaceBoundaryGeometry(mesh: TriangleMesh): THREE.BufferGeometry {
  const edges = new Map<string, { start: number; end: number; count: number }>();

  const addEdge = (start: number, end: number) => {
    const key = `${Math.min(start, end)}:${Math.max(start, end)}`;
    const edge = edges.get(key);
    if (edge) {
      edge.count += 1;
    } else {
      edges.set(key, { start, end, count: 1 });
    }
  };

  for (let index = 0; index < mesh.indices.length; index += 3) {
    const first = mesh.indices[index];
    const second = mesh.indices[index + 1];
    const third = mesh.indices[index + 2];
    addEdge(first, second);
    addEdge(second, third);
    addEdge(third, first);
  }

  const positions: number[] = [];
  for (const edge of edges.values()) {
    if (edge.count !== 1) continue;

    for (const vertex of [edge.start, edge.end]) {
      const offset = vertex * 3;
      positions.push(
        mesh.positions[offset],
        mesh.positions[offset + 1],
        mesh.positions[offset + 2],
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeBoundingSphere();
  return geometry;
}

export function createGeometryGroup(
  meshes: TriangleMesh[],
  shadingMode: ShadingMode = "flat",
): THREE.Group {
  const group = new THREE.Group();

  for (const mesh of meshes) {
    const material = createFaceMaterial(shadingMode, FACE_COLOR);
    const object = new THREE.Mesh(createFaceGeometry(mesh), material);
    object.userData.faceIndex = mesh.faceIndex;
    group.add(object);

    const boundary = new THREE.LineSegments(
      createFaceBoundaryGeometry(mesh),
      new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true }),
    );
    boundary.visible = true;
    boundary.renderOrder = 1;
    boundary.userData.faceIndex = mesh.faceIndex;
    group.add(boundary);
  }

  return group;
}

function createFaceMaterial(
  shadingMode: ShadingMode,
  color: number,
): THREE.MeshBasicMaterial | THREE.MeshStandardMaterial {
  if (shadingMode === "flat") {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 });
  }
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.1,
    roughness: 0.65,
    transparent: true,
    opacity: 0.5,
  });
}

export function setGeometryGroupShading(
  group: THREE.Group,
  shadingMode: ShadingMode,
  selectedFaceIndices: Set<number> = new Set(),
): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const previousMaterial = object.material;
    if (
      !(previousMaterial instanceof THREE.MeshBasicMaterial) &&
      !(previousMaterial instanceof THREE.MeshStandardMaterial)
    ) {
      return;
    }

    const color = selectedFaceIndices.has(object.userData.faceIndex)
      ? SELECTED_FACE_COLOR
      : FACE_COLOR;
    object.material = createFaceMaterial(shadingMode, color);
    previousMaterial.dispose();
  });
}

export function updateFaceSelection(
  group: THREE.Group,
  selectedFaceIndices: Set<number>,
  faceIndex?: number,
): Set<number> {
  const nextSelection = new Set(selectedFaceIndices);
  if (faceIndex === undefined) {
    nextSelection.clear();
  } else if (nextSelection.has(faceIndex)) {
    nextSelection.delete(faceIndex);
  } else {
    nextSelection.add(faceIndex);
  }

  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    if (!("color" in object.material)) return;

    const material = object.material as
      | THREE.MeshBasicMaterial
      | THREE.MeshStandardMaterial;
    material.color.set(
      nextSelection.has(object.userData.faceIndex)
        ? SELECTED_FACE_COLOR
        : FACE_COLOR,
    );
  });

  return nextSelection;
}

function disposeGeometryGroup(group: THREE.Group): void {
  const materials = new Set<THREE.Material>();

  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const meshMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      meshMaterials.forEach((material) => materials.add(material));
    }
  });

  materials.forEach((material) => material.dispose());
}

export function createStepRenderer(
  container: HTMLElement,
  onSelectionChange: (selectedFaceIndices: number[]) => void = () => {},
): {
  renderMeshes(meshes: TriangleMesh[]): void;
  fitToView(): void;
  setProjection(projection: CameraProjection): void;
  setShadingMode(shadingMode: ShadingMode): void;
  getSelectedFaces(): number[];
  dispose(): void;
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f3f5);

  let aspect = 1;
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
    new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
  camera.position.set(1.8, 1.8, 2.4);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x596575, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 3);
  scene.add(light);

  let controls: OrbitControls<THREE.Camera> = new OrbitControls(
    camera,
    renderer.domElement,
  );
  controls.enableDamping = true;
  let geometryGroup: THREE.Group | undefined;
  let selectedFaceIndices = new Set<number>();
  let shadingMode: ShadingMode = "flat";
  let animationFrame = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointerGestures = new PointerGestureTracker();

  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    aspect = width / height;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect;
    } else if (camera instanceof THREE.OrthographicCamera) {
      const verticalSpan = Math.max(
        camera.top - camera.bottom,
        (camera.right - camera.left) / aspect,
      );
      const horizontalSpan = verticalSpan * aspect;
      camera.top = verticalSpan / 2;
      camera.bottom = -verticalSpan / 2;
      camera.left = -horizontalSpan / 2;
      camera.right = horizontalSpan / 2;
    }
    camera.updateProjectionMatrix();
  };

  const draw = () => {
    controls.update();
    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(draw);
  };

  const fitToView = () => {
    if (!geometryGroup) return;

    const bounds = new THREE.Box3().setFromObject(geometryGroup);
    if (camera instanceof THREE.PerspectiveCamera) {
      fitCameraToBounds(camera, bounds, controls.target);
    } else if (camera instanceof THREE.OrthographicCamera) {
      fitOrthographicCameraToBounds(camera, bounds, controls.target, aspect);
    }
    controls.update();
  };

  const setProjection = (projection: CameraProjection) => {
    const wantsPerspective = projection === "perspective";
    if (
      (wantsPerspective && camera instanceof THREE.PerspectiveCamera) ||
      (!wantsPerspective && camera instanceof THREE.OrthographicCamera)
    ) {
      return;
    }

    const target = controls.target.clone();
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() === 0) direction.set(1.8, 1.8, 2.4);
    direction.normalize();
    const distance = Math.max(camera.position.distanceTo(target), 0.01);
    const verticalSpan =
      camera instanceof THREE.OrthographicCamera
        ? camera.top - camera.bottom
        : 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

    controls.dispose();
    if (wantsPerspective) {
      const perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 0.01, 100000);
      const perspectiveDistance =
        verticalSpan / (2 * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2));
      perspectiveCamera.position.copy(target).add(direction.multiplyScalar(perspectiveDistance));
      camera = perspectiveCamera;
    } else {
      const orthographicCamera = new THREE.OrthographicCamera(
        -(verticalSpan * aspect) / 2,
        (verticalSpan * aspect) / 2,
        verticalSpan / 2,
        -verticalSpan / 2,
        0.01,
        100000,
      );
      orthographicCamera.position.copy(camera.position);
      camera = orthographicCamera;
    }

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.copy(target);
    controls.update();
  };

  const setShadingMode = (nextShadingMode: ShadingMode) => {
    if (shadingMode === nextShadingMode) return;
    shadingMode = nextShadingMode;
    if (geometryGroup) {
      setGeometryGroupShading(geometryGroup, shadingMode, selectedFaceIndices);
    }
  };

  const selectFace = (faceIndex?: number) => {
    selectedFaceIndices = geometryGroup
      ? updateFaceSelection(geometryGroup, selectedFaceIndices, faceIndex)
      : new Set<number>();
    onSelectionChange([...selectedFaceIndices]);
  };

  const handleCanvasClick = (event: MouseEvent) => {
    if (pointerGestures.consumeDrag()) return;
    if (!geometryGroup) return;

    const bounds = renderer.domElement.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const intersection = raycaster
      .intersectObject(geometryGroup, true)
      .find((hit) => typeof hit.object.userData.faceIndex === "number");
    selectFace(intersection?.object.userData.faceIndex);
  };

  const handlePointerDown = (event: PointerEvent) => {
    pointerGestures.start(event.pointerId, event.clientX, event.clientY);
  };

  const handlePointerMove = (event: PointerEvent) => {
    pointerGestures.move(event.pointerId, event.clientX, event.clientY);
  };

  const handlePointerEnd = (event: PointerEvent) => {
    pointerGestures.end(event.pointerId, event.clientX, event.clientY);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") selectFace();
  };

  const renderMeshes = (meshes: TriangleMesh[]) => {
    if (geometryGroup) {
      scene.remove(geometryGroup);
      disposeGeometryGroup(geometryGroup);
    }

    geometryGroup = createGeometryGroup(meshes, shadingMode);
    scene.add(geometryGroup);
    selectFace();
    fitToView();
  };

  resize();
  window.addEventListener("resize", resize);
  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerEnd);
  window.addEventListener("pointercancel", handlePointerEnd);
  renderer.domElement.addEventListener("click", handleCanvasClick);
  window.addEventListener("keydown", handleKeyDown);
  draw();

  return {
    renderMeshes,
    fitToView,
    setProjection,
    setShadingMode,
    getSelectedFaces: () => [...selectedFaceIndices],
    dispose() {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      renderer.domElement.removeEventListener("click", handleCanvasClick);
      window.removeEventListener("keydown", handleKeyDown);
      controls.dispose();
      if (geometryGroup) disposeGeometryGroup(geometryGroup);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
