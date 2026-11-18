import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

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
const SELECTED_EDGE_COLOR = 0xff0000;
const DEFAULT_FACE_OPACITY = 0.5;

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

interface BoundaryEdge {
  start: number;
  end: number;
  faceIndex: number;
  normal: THREE.Vector3;
}

function createFaceBoundaryEdges(mesh: TriangleMesh): BoundaryEdge[] {
  const edges = new Map<string, { start: number; end: number; count: number }>();
  const normals = new Map<string, THREE.Vector3>();

  const addEdge = (start: number, end: number, normal: THREE.Vector3) => {
    const key = `${Math.min(start, end)}:${Math.max(start, end)}`;
    const edge = edges.get(key);
    if (edge) {
      edge.count += 1;
    } else {
      edges.set(key, { start, end, count: 1 });
      normals.set(key, normal);
    }
  };

  for (let index = 0; index < mesh.indices.length; index += 3) {
    const first = mesh.indices[index];
    const second = mesh.indices[index + 1];
    const third = mesh.indices[index + 2];
    const firstOffset = first * 3;
    const secondOffset = second * 3;
    const thirdOffset = third * 3;
    const normal = new THREE.Vector3(
      mesh.positions[secondOffset] - mesh.positions[firstOffset],
      mesh.positions[secondOffset + 1] - mesh.positions[firstOffset + 1],
      mesh.positions[secondOffset + 2] - mesh.positions[firstOffset + 2],
    ).cross(
      new THREE.Vector3(
        mesh.positions[thirdOffset] - mesh.positions[firstOffset],
        mesh.positions[thirdOffset + 1] - mesh.positions[firstOffset + 1],
        mesh.positions[thirdOffset + 2] - mesh.positions[firstOffset + 2],
      ),
    ).normalize();
    addEdge(first, second, normal);
    addEdge(second, third, normal);
    addEdge(third, first, normal);
  }

  return [...edges.entries()]
    .filter(([, edge]) => edge.count === 1)
    .map(([key, edge]) => ({
      ...edge,
      faceIndex: mesh.faceIndex,
      normal: normals.get(key)!,
    }));
}

function getBoundaryEdgeKey(
  mesh: TriangleMesh,
  edge: BoundaryEdge,
): string {
  const coordinates = [edge.start, edge.end].map((vertex) => {
    const offset = vertex * 3;
    return [
      mesh.positions[offset],
      mesh.positions[offset + 1],
      mesh.positions[offset + 2],
    ]
      .map((coordinate) => Math.round(coordinate * 100_000))
      .join(",");
  });
  coordinates.sort();
  return coordinates.join(":");
}

function findSmoothBoundaryEdges(meshes: TriangleMesh[]): Set<string> {
  const edgesByKey = new Map<string, BoundaryEdge[]>();
  meshes.forEach((mesh) => {
    for (const edge of createFaceBoundaryEdges(mesh)) {
      const key = getBoundaryEdgeKey(mesh, edge);
      const edges = edgesByKey.get(key) ?? [];
      edges.push(edge);
      edgesByKey.set(key, edges);
    }
  });

  const smoothEdges = new Set<string>();
  const tangentThreshold = Math.cos(THREE.MathUtils.degToRad(30));
  for (const [key, edges] of edgesByKey) {
    if (
      edges.some((edge, index) =>
        edges.slice(index + 1).some(
          (other) =>
            edge.faceIndex !== other.faceIndex &&
            Math.abs(edge.normal.dot(other.normal)) >= tangentThreshold,
        ),
      )
    ) {
      smoothEdges.add(key);
    }
  }

  return smoothEdges;
}

function createFaceBoundaryGeometries(
  mesh: TriangleMesh,
  smoothEdges: Set<string>,
): Map<boolean, LineSegmentsGeometry> {
  const positionsBySmoothness = new Map<boolean, number[]>([
    [false, []],
    [true, []],
  ]);
  for (const edge of createFaceBoundaryEdges(mesh)) {
    const isSmooth = smoothEdges.has(getBoundaryEdgeKey(mesh, edge));
    const positions = positionsBySmoothness.get(isSmooth)!;
    for (const vertex of [edge.start, edge.end]) {
      const offset = vertex * 3;
      positions.push(
        mesh.positions[offset],
        mesh.positions[offset + 1],
        mesh.positions[offset + 2],
      );
    }
  }

  const geometries = new Map<boolean, LineSegmentsGeometry>();
  for (const [isSmooth, positions] of positionsBySmoothness) {
    if (positions.length === 0) continue;
    geometries.set(
      isSmooth,
      new LineSegmentsGeometry().setPositions(positions),
    );
  }
  return geometries;
}

function updateEdgeVisibility(
  object: THREE.Object3D,
  edgeThickness: number,
  showSmoothEdges: boolean,
): void {
  const isSelectedHighlight = object.userData.isSelectionHighlight === true;
  object.visible =
    edgeThickness > 0 &&
    (!object.userData.isSmoothEdge || showSmoothEdges) &&
    (!isSelectedHighlight || object.userData.isSelected === true);
}

export function createGeometryGroup(
  meshes: TriangleMesh[],
  shadingMode: ShadingMode = "flat",
  opacity = DEFAULT_FACE_OPACITY,
  edgeThickness = 1,
  showSmoothEdges = true,
): THREE.Group {
  const group = new THREE.Group();
  const clampedEdgeThickness = Math.max(
    Number.isFinite(edgeThickness) ? edgeThickness : 0,
    0,
  );
  const smoothEdges = findSmoothBoundaryEdges(meshes);

  for (const mesh of meshes) {
    const material = createFaceMaterial(shadingMode, FACE_COLOR, opacity);
    const object = new THREE.Mesh(createFaceGeometry(mesh), material);
    object.userData.faceIndex = mesh.faceIndex;
    group.add(object);

    for (const [isSmooth, geometry] of createFaceBoundaryGeometries(
      mesh,
      smoothEdges,
    )) {
      const boundary = new LineSegments2(
        geometry,
        new LineMaterial({
          color: EDGE_COLOR,
          linewidth: clampedEdgeThickness,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      boundary.userData.isEdgeLine = true;
      boundary.userData.faceIndex = mesh.faceIndex;
      boundary.userData.isSmoothEdge = isSmooth;
      boundary.renderOrder = 1;
      updateEdgeVisibility(boundary, clampedEdgeThickness, showSmoothEdges);
      group.add(boundary);

      const highlight = new LineSegments2(
        geometry,
        new LineMaterial({
          color: SELECTED_EDGE_COLOR,
          linewidth: clampedEdgeThickness,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      highlight.userData.isEdgeLine = true;
      highlight.userData.faceIndex = mesh.faceIndex;
      highlight.userData.isSmoothEdge = isSmooth;
      highlight.userData.isSelectionHighlight = true;
      highlight.userData.isSelected = false;
      highlight.renderOrder = 2;
      updateEdgeVisibility(highlight, clampedEdgeThickness, showSmoothEdges);
      group.add(highlight);
    }
  }

  group.userData.edgeThickness = clampedEdgeThickness;
  group.userData.showSmoothEdges = showSmoothEdges;
  return group;
}

function createFaceMaterial(
  shadingMode: ShadingMode,
  color: number,
  opacity: number,
): THREE.MeshBasicMaterial | THREE.MeshStandardMaterial {
  if (shadingMode === "flat") {
    return new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity,
      depthWrite: false,
    });
  }
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.1,
    roughness: 0.65,
    side: THREE.DoubleSide,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

export function setGeometryGroupShading(
  group: THREE.Group,
  shadingMode: ShadingMode,
  opacity = DEFAULT_FACE_OPACITY,
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

    const color = previousMaterial.color.getHex();
    object.material = createFaceMaterial(shadingMode, color, opacity);
    previousMaterial.dispose();
  });
}

export function setGeometryGroupOpacity(group: THREE.Group, opacity: number): void {
  const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (
        material instanceof THREE.MeshBasicMaterial ||
        material instanceof THREE.MeshStandardMaterial
      ) {
        material.opacity = clampedOpacity;
      }
    }
  });
}

export function setGeometryGroupEdgeThickness(
  group: THREE.Group,
  edgeThickness: number,
): void {
  const clampedThickness = Math.max(
    Number.isFinite(edgeThickness) ? edgeThickness : 0,
    0,
  );
  group.userData.edgeThickness = clampedThickness;
  const showSmoothEdges = group.userData.showSmoothEdges !== false;
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.isEdgeLine) return;
    const material = object.material as LineMaterial;
    material.linewidth = clampedThickness;
    updateEdgeVisibility(object, clampedThickness, showSmoothEdges);
  });
}

export function setGeometryGroupSmoothEdgesVisible(
  group: THREE.Group,
  showSmoothEdges: boolean,
): void {
  group.userData.showSmoothEdges = showSmoothEdges;
  const edgeThickness = group.userData.edgeThickness ?? 1;
  group.traverse((object) => {
    if (!object.userData.isEdgeLine) return;
    updateEdgeVisibility(object, edgeThickness, showSmoothEdges);
  });
}

export function setGeometryGroupSelection(
  group: THREE.Group,
  selectedFaceIndices: ReadonlySet<number>,
): void {
  group.traverse((object) => {
    if (object.userData.isEdgeLine) {
      if (object.userData.isSelectionHighlight) {
        object.userData.isSelected = selectedFaceIndices.has(object.userData.faceIndex);
      }
      updateEdgeVisibility(
        object,
        group.userData.edgeThickness ?? 1,
        group.userData.showSmoothEdges !== false,
      );
      return;
    }

    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    if (!("color" in object.material)) return;

    const material = object.material as
      | THREE.MeshBasicMaterial
      | THREE.MeshStandardMaterial;
    material.color.set(
      selectedFaceIndices.has(object.userData.faceIndex)
        ? SELECTED_FACE_COLOR
        : FACE_COLOR,
    );
  });
}

export function raycastFaceIndex(
  raycaster: THREE.Raycaster,
  group: THREE.Group,
): number | undefined {
  const faceMeshes: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !object.userData.isEdgeLine &&
      typeof object.userData.faceIndex === "number"
    ) {
      faceMeshes.push(object);
    }
  });

  return raycaster.intersectObjects(faceMeshes)[0]?.object.userData.faceIndex;
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
  onPick: (faceIndex: number | undefined) => void = () => {},
): {
  renderMeshes(meshes: TriangleMesh[]): void;
  setSelectedFaces(faceIndices: readonly number[]): void;
  fitToView(): void;
  setProjection(projection: CameraProjection): void;
  setShadingMode(shadingMode: ShadingMode): void;
  setOpacity(opacity: number): void;
  setEdgeThickness(edgeThickness: number): void;
  setShowSmoothEdges(showSmoothEdges: boolean): void;
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
  let shadingMode: ShadingMode = "flat";
  let faceOpacity = DEFAULT_FACE_OPACITY;
  let edgeThickness = 1;
  let showSmoothEdges = true;
  let animationFrame = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointerGestures = new PointerGestureTracker();

  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    aspect = width / height;
    geometryGroup?.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.isEdgeLine) {
        (object.material as LineMaterial).resolution.set(width, height);
      }
    });
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
      setGeometryGroupShading(
        geometryGroup,
        shadingMode,
        faceOpacity,
      );
    }
  };

  const setOpacity = (opacity: number) => {
    faceOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    if (geometryGroup) setGeometryGroupOpacity(geometryGroup, faceOpacity);
  };

  const setEdgeThickness = (nextEdgeThickness: number) => {
    edgeThickness = Math.max(
      Number.isFinite(nextEdgeThickness) ? nextEdgeThickness : 0,
      0,
    );
    if (geometryGroup) {
      setGeometryGroupEdgeThickness(geometryGroup, edgeThickness);
    }
  };

  const setShowSmoothEdges = (nextShowSmoothEdges: boolean) => {
    showSmoothEdges = nextShowSmoothEdges;
    if (geometryGroup) {
      setGeometryGroupSmoothEdgesVisible(geometryGroup, showSmoothEdges);
    }
  };

  const setSelectedFaces = (faceIndices: readonly number[]) => {
    if (geometryGroup) {
      setGeometryGroupSelection(geometryGroup, new Set(faceIndices));
    }
  };

  const handleCanvasClick = (event: MouseEvent) => {
    if (pointerGestures.consumeDrag()) return;
    if (!geometryGroup) return;

    const bounds = renderer.domElement.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    onPick(raycastFaceIndex(raycaster, geometryGroup));
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
    if (event.key === "Escape") onPick(undefined);
  };

  const renderMeshes = (meshes: TriangleMesh[]) => {
    if (geometryGroup) {
      scene.remove(geometryGroup);
      disposeGeometryGroup(geometryGroup);
    }

    geometryGroup = createGeometryGroup(
      meshes,
      shadingMode,
      faceOpacity,
      edgeThickness,
      showSmoothEdges,
    );
    scene.add(geometryGroup);
    geometryGroup.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.isEdgeLine) {
        (object.material as LineMaterial).resolution.set(
          Math.max(container.clientWidth, 1),
          Math.max(container.clientHeight, 1),
        );
      }
    });
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
    setSelectedFaces,
    fitToView,
    setProjection,
    setShadingMode,
    setOpacity,
    setEdgeThickness,
    setShowSmoothEdges,
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
