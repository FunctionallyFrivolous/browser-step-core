import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import {
  createGeometryGroup,
  createCameraFromViewState,
  fitCameraToBounds,
  fitOrthographicCameraToBounds,
  getCameraViewState,
  PointerGestureTracker,
  raycastFace,
  raycastFaceIndex,
  renderSceneWithDepthPrepass,
  setGeometryGroupEdgeThickness,
  setGeometryGroupOpacity,
  setGeometryGroupShading,
  setGeometryGroupStyle,
  setGeometryGroupSmoothEdgesVisible,
  setGeometryGroupSelection,
  switchCameraProjection,
  updateGeometryGroupSilhouettes,
} from "../src/index.ts";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { ViewStateModel } from "../../core/src/index.ts";

test("restores shared camera views including orthographic zoom and clipping", () => {
  const camera = new THREE.OrthographicCamera(-4, 4, 2, -2, 0.1, 200);
  camera.position.set(6, 8, 12);
  camera.zoom = 2;
  const target = new THREE.Vector3(1, 2, 3);
  const view = new ViewStateModel(getCameraViewState(camera, target));
  view.saveBookmark("detail");
  view.setState({
    ...view.state,
    projection: "perspective",
    position: [10, 10, 10],
  });
  assert.equal(view.restoreBookmark("detail"), true);

  const restored = createCameraFromViewState(view.state, 3);
  assert.ok(restored instanceof THREE.OrthographicCamera);
  assert.equal(restored.right - restored.left, 6);
  assert.equal(restored.top - restored.bottom, 2);
  assert.deepEqual(getCameraViewState(restored, target), view.state);
});

test("restores a perspective view with its position, target, scale, and clipping", () => {
  const camera = new THREE.PerspectiveCamera(20, 2, 0.2, 500);
  camera.position.set(6, 8, 12);
  const target = new THREE.Vector3(1, 2, 3);
  const state = getCameraViewState(camera, target);
  const restored = createCameraFromViewState(state, 1.5);

  assert.ok(restored instanceof THREE.PerspectiveCamera);
  assert.equal(restored.aspect, 1.5);
  const restoredState = getCameraViewState(restored, target);
  assert.ok(Math.abs(restoredState.verticalSpan - state.verticalSpan) < 1e-10);
  assert.deepEqual({ ...restoredState, verticalSpan: state.verticalSpan }, state);
});

test("switches projection without clipping a zoomed-out fitted view", () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
  camera.position.set(6, 8, 12);
  const target = new THREE.Vector3();
  const bounds = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  fitOrthographicCameraToBounds(camera, bounds, target, 1);
  camera.zoom = 0.02;
  const span = getCameraViewState(camera, target).verticalSpan;
  const perspective = switchCameraProjection(camera, target, "perspective", 1);
  const distance = perspective.position.distanceTo(target);
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;

  assert.ok(perspective instanceof THREE.PerspectiveCamera);
  assert.ok(perspective.far > distance + radius);
  assert.ok(perspective.near < distance - radius);
  assert.ok(Math.abs(getCameraViewState(perspective, target).verticalSpan - span) < 1e-10);
  const orthographic = switchCameraProjection(perspective, target, "orthographic", 1);
  assert.ok(orthographic instanceof THREE.OrthographicCamera);
  assert.ok(Math.abs(getCameraViewState(orthographic, target).verticalSpan - span) < 1e-10);
});

function disposeGroup(group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      object.material.dispose();
    }
  });
}

function getBoundaryLines(group) {
  return group.children.filter(
    (child) =>
      child.userData.isEdgeLine &&
      !child.userData.isSelectionHighlight,
  );
}

function getSelectionHighlights(group) {
  return group.children.filter(
    (child) =>
      child.userData.isEdgeLine &&
      child.userData.isSelectionHighlight &&
      !child.userData.isObjectSilhouette,
  );
}

function getObjectSilhouettes(group) {
  return group.children.filter((child) => child.userData.isObjectSilhouette);
}

function getEdgeVertexCount(edge) {
  return edge.geometry.attributes.instanceStart.count * 2;
}

test("distinguishes pointer clicks from camera drags", () => {
  const gestures = new PointerGestureTracker();

  gestures.start(1, 10, 10);
  gestures.move(1, 13, 14);
  gestures.end(1, 13, 14);
  assert.equal(gestures.consumeDrag(), false);

  gestures.start(1, 10, 10);
  gestures.move(1, 14, 14);
  gestures.end(1, 14, 14);
  assert.equal(gestures.consumeDrag(), true);
  assert.equal(gestures.consumeDrag(), false);
});

test("tracks camera gestures across multiple pointers", () => {
  const gestures = new PointerGestureTracker();

  gestures.start(1, 10, 10);
  gestures.start(2, 20, 20);
  gestures.move(2, 30, 20);
  gestures.end(2, 30, 20);
  gestures.end(1, 10, 10);

  assert.equal(gestures.consumeDrag(), true);
});

test("creates a Three.js mesh for each tessellated face", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const mesh = group.children.find((child) => child instanceof THREE.Mesh);
  const boundary = group.children.find(
    (child) =>
      child.userData.isEdgeLine &&
      !child.userData.isSelectionHighlight,
  );
  const highlight = getSelectionHighlights(group)[0];

  assert.equal(
    group.children.filter(
      (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
    ).length,
    1,
  );
  assert.equal(mesh.userData.faceIndex, 4);
  assert.equal(mesh.geometry.getAttribute("position").count, 3);
  assert.deepEqual(mesh.geometry.index?.array, new Uint32Array([0, 1, 2]));
  assert.equal(mesh.geometry.getAttribute("normal").count, 3);
  assert.ok(mesh.material instanceof THREE.MeshBasicMaterial);
  assert.equal(mesh.material.color.getHex(), 0x9caec2);
  assert.equal(mesh.material.side, THREE.DoubleSide);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.opacity, 0.5);
  assert.equal(mesh.material.depthTest, true);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.polygonOffset, true);
  assert.equal(mesh.material.polygonOffsetFactor, 1);
  assert.equal(mesh.material.polygonOffsetUnits, 1);
  assert.equal(getEdgeVertexCount(boundary), 6);
  assert.equal(boundary.visible, true);
  assert.equal(boundary.material.color.getHex(), 0x000000);
  assert.ok(boundary.material instanceof LineMaterial);
  assert.equal(boundary.material.transparent, true);
  assert.equal(boundary.material.linewidth, 1);
  assert.equal(boundary.material.depthTest, true);
  assert.equal(boundary.material.depthWrite, true);
  assert.equal(highlight.visible, false);
  assert.equal(highlight.material.color.getHex(), 0xff0000);
  assert.equal(highlight.material.linewidth, 1);
  assert.equal(highlight.material.depthTest, true);
  assert.equal(highlight.material.depthWrite, true);
  assert.equal(boundary.renderOrder, 0);
  assert.equal(mesh.renderOrder, 1);
  assert.equal(highlight.renderOrder, 2);

  disposeGroup(group);
});

test("ignores nearby boundary lines when picking faces", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.9, 0.9, 2),
    new THREE.Vector3(0, 0, -1),
  );

  assert.ok(getBoundaryLines(group).length > 0);
  assert.equal(raycastFaceIndex(raycaster, group), undefined);

  raycaster.set(
    new THREE.Vector3(0.2, 0.2, 2),
    new THREE.Vector3(0, 0, -1),
  );
  assert.equal(raycastFaceIndex(raycaster, group), 4);
  group.visible = false;
  assert.equal(raycastFaceIndex(raycaster, group), undefined);

  disposeGroup(group);
});

test("switches between flat and original shading while preserving selection", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const mesh = group.children.find((child) => child instanceof THREE.Mesh);
  const selectedFaceIndices = new Set([4]);
  setGeometryGroupSelection(group, selectedFaceIndices);

  setGeometryGroupShading(group, "original");
  assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
  assert.equal(mesh.material.color.getHex(), 0xffc7c7);
  assert.equal(mesh.material.side, THREE.DoubleSide);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.opacity, 0.5);
  assert.equal(mesh.material.depthTest, true);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.metalness, 0.1);
  assert.equal(mesh.material.roughness, 0.65);

  setGeometryGroupShading(group, "flat");
  assert.ok(mesh.material instanceof THREE.MeshBasicMaterial);
  assert.equal(mesh.material.color.getHex(), 0xffc7c7);
  assert.equal(mesh.material.side, THREE.DoubleSide);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.opacity, 0.5);
  assert.equal(mesh.material.depthTest, true);
  assert.equal(mesh.material.depthWrite, false);

  disposeGroup(group);
});

test("sets opacity on all face meshes without changing boundary overlays", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
    {
      faceIndex: 5,
      positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const meshes = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const boundaries = getBoundaryLines(group);
  const highlights = getSelectionHighlights(group);

  setGeometryGroupOpacity(group, 0.25);

  assert.ok(meshes.every((mesh) => mesh.material.opacity === 0.25));
  assert.ok(boundaries.every((boundary) => boundary.material.opacity === 1));
  assert.ok(highlights.every((highlight) => highlight.material.opacity === 1));

  disposeGroup(group);
});

test("applies shared face color, opacity, and visibility while preserving selection", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
    {
      faceIndex: 5,
      positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const faces = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const boundaries = getBoundaryLines(group);
  setGeometryGroupSelection(group, new Set([4]));

  setGeometryGroupStyle(group, {
    faceColor: 0x123456,
    opacity: 0.25,
    visible: false,
  });

  assert.equal(group.visible, false);
  assert.equal(faces[0].material.color.getHex(), 0xffc7c7);
  assert.equal(faces[0].material.opacity, 0.25);
  assert.equal(faces[1].material.color.getHex(), 0x123456);
  assert.equal(faces[1].material.opacity, 0.25);
  assert.ok(boundaries.every((boundary) => boundary.material.opacity === 1));

  disposeGroup(group);
});

test("clamps face opacity and preserves it when switching shading", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const mesh = group.children.find((child) => child instanceof THREE.Mesh);

  setGeometryGroupOpacity(group, 1.5);
  assert.equal(mesh.material.opacity, 1);

  setGeometryGroupShading(group, "original", 0.25);
  assert.equal(mesh.material.opacity, 0.25);

  setGeometryGroupShading(group, "flat", 0.25);
  assert.equal(mesh.material.opacity, 0.25);

  setGeometryGroupOpacity(group, 0.3);
  setGeometryGroupShading(group, "original");
  assert.equal(mesh.material.opacity, 0.3);

  disposeGroup(group);
});

test("switches opaque faces to depth-writing while keeping boundaries occludable", () => {
  const group = createGeometryGroup(
    [
      {
        faceIndex: 4,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
    "flat",
    1,
  );
  const mesh = group.children.find((child) => child instanceof THREE.Mesh);
  const boundary = getBoundaryLines(group)[0];
  const highlight = getSelectionHighlights(group)[0];

  assert.equal(mesh.material.transparent, false);
  assert.equal(mesh.material.depthWrite, true);
  assert.equal(boundary.material.depthTest, true);
  assert.equal(boundary.material.depthWrite, true);
  assert.equal(highlight.material.depthTest, true);
  assert.equal(highlight.material.depthWrite, true);

  setGeometryGroupOpacity(group, 0.5);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.depthWrite, false);

  setGeometryGroupOpacity(group, 1);
  assert.equal(mesh.material.transparent, false);
  assert.equal(mesh.material.depthWrite, true);

  disposeGroup(group);
});

test("boundary overlays omit internal triangulation edges", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    },
  ]);
  const boundary = group.children.find(
    (child) => child.userData.isEdgeLine,
  );

  assert.equal(getEdgeVertexCount(boundary), 8);
  assert.equal(boundary.material.color.getHex(), 0x000000);
  assert.equal(boundary.material.transparent, true);
  assert.equal(boundary.visible, true);

  disposeGroup(group);
});

test("renders a depth-only face prepass before depth-tested edges", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  setGeometryGroupSelection(group, new Set([4]));
  const face = group.children.find(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const boundary = getBoundaryLines(group)[0];
  const highlight = getSelectionHighlights(group)[0];
  const scene = new THREE.Scene();
  scene.add(group);
  const camera = new THREE.PerspectiveCamera();
  const passes = [];
  const renderer = {
    clear: (...args) => passes.push({ type: "clear", args }),
    render: () => passes.push({
      type: "render",
      colorWrite: face.material.colorWrite,
      depthWrite: face.material.depthWrite,
      transparent: face.material.transparent,
      boundaryVisible: boundary.visible,
      highlightVisible: highlight.visible,
    }),
  };

  renderSceneWithDepthPrepass(renderer, scene, camera, group);

  assert.deepEqual(passes, [
    { type: "clear", args: [true, true, true] },
    {
      type: "render",
      colorWrite: false,
      depthWrite: true,
      transparent: false,
      boundaryVisible: false,
      highlightVisible: false,
    },
    {
      type: "render",
      colorWrite: true,
      depthWrite: false,
      transparent: true,
      boundaryVisible: true,
      highlightVisible: true,
    },
  ]);
  assert.equal(boundary.material.depthTest, true);
  assert.equal(highlight.material.depthTest, true);
  assert.equal(highlight.material.depthWrite, true);

  disposeGroup(group);
});

test("classifies tangent shared boundaries as smooth and controls edge visibility", () => {
  const group = createGeometryGroup(
    [
      {
        faceIndex: 4,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
      {
        faceIndex: 5,
        positions: new Float32Array([1, 0, 0, 0, 0, 0, 1, -1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
    "flat",
    0.5,
    1,
    false,
  );
  const boundaries = getBoundaryLines(group);
  const smoothBoundaries = boundaries.filter(
    (boundary) => boundary.userData.isSmoothEdge,
  );
  const sharpBoundaries = boundaries.filter(
    (boundary) => !boundary.userData.isSmoothEdge,
  );

  assert.equal(smoothBoundaries.length, 2);
  assert.ok(smoothBoundaries.every((boundary) => !boundary.visible));
  assert.ok(sharpBoundaries.every((boundary) => boundary.visible));

  setGeometryGroupSmoothEdgesVisible(group, true);
  assert.ok(smoothBoundaries.every((boundary) => boundary.visible));

  setGeometryGroupEdgeThickness(group, 2.5);
  assert.ok(
    [...boundaries, ...getSelectionHighlights(group)].every(
      (edge) => edge.material.linewidth === 2.5,
    ),
  );

  setGeometryGroupEdgeThickness(group, 0);
  assert.ok(
    [...boundaries, ...getSelectionHighlights(group)].every(
      (edge) => !edge.visible,
    ),
  );

  disposeGroup(group);

  const sharpGroup = createGeometryGroup(
    [
      {
        faceIndex: 6,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      },
      {
        faceIndex: 7,
        positions: new Float32Array([1, 0, 0, 0, 0, 0, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
      },
    ],
    "flat",
    0.5,
    1,
    false,
  );
  const creaseBoundaries = getBoundaryLines(sharpGroup);
  assert.ok(creaseBoundaries.every((edge) => !edge.userData.isSmoothEdge));
  assert.ok(creaseBoundaries.every((edge) => edge.visible));
  disposeGroup(sharpGroup);
});

test("highlights all faces in the supplied selection", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
    {
      faceIndex: 5,
      positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const meshes = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const boundaries = getBoundaryLines(group);
  const highlights = getSelectionHighlights(group);
  const selected = new Set([4, 5]);
  setGeometryGroupSelection(group, selected);

  assert.deepEqual([...selected], [4, 5]);
  assert.ok(meshes.every((mesh) => mesh.material.color.getHex() === 0xffc7c7));
  assert.notEqual(meshes[0].material, meshes[1].material);
  assert.ok(boundaries.every((boundary) => boundary.visible));
  assert.ok(
    boundaries.every((boundary) => boundary.material.color.getHex() === 0x000000),
  );
  assert.ok(highlights.every((highlight) => highlight.visible));

  disposeGroup(group);
});

test("object scope highlights every face and draws a camera-dependent silhouette", () => {
  const vertices = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const faces = [
    [1, 2, 3],
    [0, 3, 2],
    [0, 1, 3],
    [0, 2, 1],
  ];
  const meshes = faces.map((indices, faceIndex) => ({
    faceIndex,
    bodyIndex: 7,
    positions: new Float32Array(vertices.flat()),
    indices: new Uint32Array(indices),
  }));
  const group = createGeometryGroup(meshes);
  setGeometryGroupSelection(group, new Set([0, 1, 2, 3]), "object");

  const faceMeshes = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const highlights = getSelectionHighlights(group);
  const [silhouette] = getObjectSilhouettes(group);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(3, 3, 3);
  camera.lookAt(0.25, 0.25, 0.25);
  updateGeometryGroupSilhouettes(group, camera);
  const firstView = [
    ...silhouette.geometry.attributes.instanceStart.array,
    ...silhouette.geometry.attributes.instanceEnd.array,
  ];

  camera.position.set(3, -3, 3);
  camera.lookAt(0.25, 0.25, 0.25);
  updateGeometryGroupSilhouettes(group, camera);
  const secondView = [
    ...silhouette.geometry.attributes.instanceStart.array,
    ...silhouette.geometry.attributes.instanceEnd.array,
  ];

  assert.ok(faceMeshes.every((mesh) => mesh.material.color.getHex() === 0xffc7c7));
  assert.ok(highlights.every((highlight) => !highlight.visible));
  assert.equal(silhouette.visible, true);
  assert.equal(silhouette.material.depthTest, false);
  assert.equal(silhouette.material.depthWrite, false);
  assert.equal(silhouette.renderOrder, 2);
  assert.ok(firstView.length > 0);
  assert.notDeepEqual(firstView, secondView);

  disposeGroup(group);
});

test("updates highlights when a face is removed from the supplied selection", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
    {
      faceIndex: 5,
      positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const meshes = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const boundaries = getBoundaryLines(group);
  const highlights = getSelectionHighlights(group);
  setGeometryGroupSelection(group, new Set([4, 5]));
  const deselected = new Set([5]);
  setGeometryGroupSelection(group, deselected);

  assert.deepEqual([...deselected], [5]);
  assert.equal(meshes[0].material.color.getHex(), 0x9caec2);
  assert.equal(meshes[1].material.color.getHex(), 0xffc7c7);
  assert.equal(boundaries[0].visible, true);
  assert.equal(boundaries[1].visible, true);
  assert.equal(highlights[0].visible, false);
  assert.equal(highlights[1].visible, true);

  disposeGroup(group);
});

test("clears highlights and restores base color for an empty selection", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  setGeometryGroupSelection(group, new Set([4]));
  setGeometryGroupSelection(group, new Set());
  const mesh = group.children.find(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const boundary = group.children.find(
    (child) =>
      child.userData.isEdgeLine &&
      !child.userData.isSelectionHighlight,
  );
  const highlight = getSelectionHighlights(group)[0];

  assert.equal(mesh.material.color.getHex(), 0x9caec2);
  assert.equal(boundary.visible, true);
  assert.equal(highlight.visible, false);

  disposeGroup(group);
});

test("fits the camera around the bounds center with viewport padding", () => {
  const camera = new THREE.PerspectiveCamera(45, 2, 0.01, 100000);
  camera.position.set(6, 8, 12);
  const bounds = new THREE.Box3(
    new THREE.Vector3(8, 18, 28),
    new THREE.Vector3(12, 22, 32),
  );
  const target = new THREE.Vector3(1, 2, 3);
  const direction = camera.position.clone().sub(target).normalize();

  fitCameraToBounds(camera, bounds, target);

  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const expectedDistance =
    (radius * 1.15) / Math.sin(Math.min(verticalFov, horizontalFov) / 2);

  assert.deepEqual(target.toArray(), center.toArray());
  assert.ok(
    camera.position.clone().sub(center).normalize().distanceTo(direction) < 1e-10,
  );
  assert.ok(Math.abs(camera.position.distanceTo(center) - expectedDistance) < 1e-10);
  assert.equal(camera.near, radius / 1000);
  assert.equal(camera.far, radius * 100);
});

test("uses the default view direction when the camera and target coincide", () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
  const bounds = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  const target = new THREE.Vector3();

  fitCameraToBounds(camera, bounds, target);

  const center = bounds.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(1.8, 1.8, 2.4).normalize();
  assert.ok(
    camera.position.clone().sub(center).normalize().distanceTo(direction) < 1e-10,
  );
});

test("fits an orthographic camera to bounds while preserving its view direction", () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
  camera.zoom = 3;
  camera.position.set(6, 8, 12);
  const bounds = new THREE.Box3(
    new THREE.Vector3(8, 18, 28),
    new THREE.Vector3(12, 22, 32),
  );
  const target = new THREE.Vector3(1, 2, 3);
  const direction = camera.position.clone().sub(target).normalize();
  const aspect = 2;

  fitOrthographicCameraToBounds(camera, bounds, target, aspect);

  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const verticalSpan = radius * 2.3;

  assert.deepEqual(target.toArray(), center.toArray());
  assert.ok(
    camera.position.clone().sub(center).normalize().distanceTo(direction) < 1e-10,
  );
  assert.ok(Math.abs(camera.top - verticalSpan / 2) < 1e-10);
  assert.ok(Math.abs(camera.right - (verticalSpan * aspect) / 2) < 1e-10);
  assert.equal(camera.near, radius / 1000);
  assert.equal(camera.far, radius * 100);
  assert.equal(camera.zoom, 1);
});

test("widens the orthographic vertical span for a portrait viewport", () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
  const bounds = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  const target = new THREE.Vector3();
  const aspect = 0.5;

  fitOrthographicCameraToBounds(camera, bounds, target, aspect);

  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  assert.ok(Math.abs(camera.right - camera.left - radius * 2.3) < 1e-10);
  assert.ok(Math.abs(camera.top - camera.bottom - radius * 4.6) < 1e-10);
});
