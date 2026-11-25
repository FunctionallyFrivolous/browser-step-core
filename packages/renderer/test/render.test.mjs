import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import {
  alignViewToNormal,
  createGeometryGroup,
  createCameraControls,
  createCameraFromViewState,
  getEdgeIndicesForFaces,
  fitCameraToBounds,
  fitOrthographicCameraToBounds,
  getCameraViewState,
  PointerGestureTracker,
  raycastFace,
  raycastFaceIndex,
  raycastEdge,
  renderSceneWithDepthPrepass,
  setGeometryGroupEdgeColor,
  setGeometryGroupEdgeThickness,
  setGeometryGroupEdgeSelection,
  setGeometryGroupFaceColor,
  setGeometryGroupHiddenBodies,
  setGeometryGroupOpacity,
  setGeometryGroupShading,
  setGeometryGroupStyle,
  setGeometryGroupSmoothEdgesVisible,
  setGeometryGroupSelection,
  switchCameraProjection,
} from "../src/index.ts";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { BodySilhouettePass } from "../src/body-silhouette.ts";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { SelectionModel, ViewStateModel } from "../../core/src/index.ts";

test("aligns a view to either side of a plane without changing its framing", () => {
  for (const projection of ["orthographic", "perspective"]) {
    for (const normal of [[0, 1, 0], [0, -1, 0], [2, 0, 0], [1, 2, 3]]) {
      const state = {
        projection, position: [4, 5, 6], target: [1, 2, 3], up: [0, 1, 0],
        verticalSpan: 8, near: 0.1, far: 100,
      };
      const aligned = alignViewToNormal(state, normal);
      const offset = new THREE.Vector3().fromArray(aligned.position)
        .sub(new THREE.Vector3().fromArray(aligned.target));
      const direction = new THREE.Vector3().fromArray(normal).normalize();
      const up = new THREE.Vector3().fromArray(aligned.up);
      assert.ok(Math.abs(Math.abs(offset.clone().normalize().dot(direction)) - 1) < 1e-10);
      assert.ok(offset.dot(new THREE.Vector3(3, 3, 3)) >= -1e-10);
      assert.ok(Math.abs(offset.length() - Math.sqrt(27)) < 1e-10);
      assert.ok(Math.abs(up.length() - 1) < 1e-10);
      assert.ok(Math.abs(up.dot(direction)) < 1e-10);
      assert.deepEqual(
        { ...aligned, position: state.position, up: state.up },
        state,
      );
      const camera = createCameraFromViewState(aligned, 1);
      for (const mode of ["constrained", "free"]) {
        const controls = createCameraControls(camera, null, mode);
        controls.target.fromArray(aligned.target);
        controls.update();
        assert.ok(camera.position.distanceTo(new THREE.Vector3().fromArray(aligned.position)) < 1e-8);
      }
    }
  }
  assert.throws(() => alignViewToNormal(new ViewStateModel().state, [0, 0, 0]), /Invalid plane normal/);
});

test("creates constrained and free orbit camera controls", () => {
  const camera = new THREE.PerspectiveCamera();
  const constrained = createCameraControls(camera, null, "constrained");
  assert.ok(constrained instanceof OrbitControls);
  assert.equal(constrained.enableDamping, true);

  const free = createCameraControls(camera, null, "free");
  assert.ok(free instanceof TrackballControls);
  assert.equal(free.staticMoving, false);
});

test("free orbit preserves the view and rotates in both directions after constrained orbit", () => {
  for (const offset of [
    new THREE.Vector3(0, 10, 0),
    new THREE.Vector3(0, -10, 0),
    new THREE.Vector3(4, 6, 8),
  ]) {
    for (const [x, y] of [[100, 0], [0, 100]]) {
      const target = new THREE.Vector3(2, 3, 4);
      const camera = new THREE.PerspectiveCamera();
      camera.position.copy(target).add(offset);
      const constrained = createCameraControls(camera, null, "constrained");
      constrained.target.copy(target);
      camera.position.copy(target).add(offset);
      constrained.update();
      const position = camera.position.clone();
      const orientation = camera.quaternion.clone();

      const free = createCameraControls(camera, null, "free");
      free.target.copy(target);
      free.update();
      assert.ok(camera.position.distanceTo(position) < 1e-10);
      assert.ok(camera.quaternion.angleTo(orientation) < 1e-7);
      assert.ok(Math.abs(camera.up.dot(camera.position.clone().sub(target).normalize())) < 1e-10);

      Object.assign(free.screen, { left: 0, top: 0, width: 500, height: 500 });
      free._onMouseDown({ button: 0, pageX: 250, pageY: 250 });
      free._onMouseMove({ pageX: 250 + x, pageY: 250 + y });
      free.update();
      assert.ok(camera.position.distanceTo(position) > 3);
      assert.ok(Math.abs(camera.position.distanceTo(target) - position.distanceTo(target)) < 1e-10);
    }
  }
});

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

test("saves the initial camera view after fitting the first model", () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
  camera.position.set(1.8, 1.8, 2.4);
  const target = new THREE.Vector3();
  const view = new ViewStateModel(getCameraViewState(camera, target));
  const bounds = new THREE.Box3(
    new THREE.Vector3(-10, -5, -2),
    new THREE.Vector3(10, 5, 2),
  );
  fitOrthographicCameraToBounds(camera, bounds, target, 1);
  view.setState(getCameraViewState(camera, target));
  view.saveBookmark("initial");
  const fitted = view.state;

  view.setState({
    ...fitted,
    position: [1.8, 1.8, 2.4],
    verticalSpan: 2,
  });
  assert.equal(view.restoreBookmark("initial"), true);
  assert.deepEqual(view.state, fitted);
  assert.ok(view.state.verticalSpan > 2);
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

test("restores free-orbit camera roll and preserves it when switching projection", () => {
  const camera = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.up.set(1, 0, 0);
  const target = new THREE.Vector3();
  camera.lookAt(target);
  const state = getCameraViewState(camera, target);
  const restored = createCameraFromViewState(state, 2);
  assert.deepEqual(restored.up.toArray(), [1, 0, 0]);
  assert.ok(restored.quaternion.angleTo(camera.quaternion) < 1e-10);
  const perspective = switchCameraProjection(restored, target, "perspective", 2);
  assert.deepEqual(perspective.up.toArray(), [1, 0, 0]);
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

test("picks and highlights BREP edges and edits selected-edge thickness", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      bodyIndex: 0,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      edges: [
        { edgeIndex: 9, positions: new Float32Array([0, 0, 0, 1, 0, 0]) },
        { edgeIndex: 10, positions: new Float32Array([0, 0, 0, 0, 1, 0]) },
      ],
    },
  ]);
  const faceRay = new THREE.Raycaster(
    new THREE.Vector3(0.25, 0.1, 2),
    new THREE.Vector3(0, 0, -1),
  );
  const pickedEdge = raycastEdge(
    faceRay,
    group,
    4,
    new THREE.Vector3(0.25, 0.1, 0),
  );
  assert.equal(pickedEdge.edgeIndex, 9);
  assert.equal(pickedEdge.faceIndex, 4);

  const edgeRay = new THREE.Raycaster(
    new THREE.Vector3(0.5, 0.05, 2),
    new THREE.Vector3(0, 0, -1),
  );
  assert.equal(raycastEdge(edgeRay, group).edgeIndex, 9);

  setGeometryGroupEdgeSelection(group, [9]);
  let edgeHighlight = group.children.find(
    (child) => child.userData.isEdgeSelectionHighlight && child.userData.edgeIndex === 9,
  );
  assert.equal(edgeHighlight.visible, true);
  for (const [thickness, expectedHighlight] of [[0, 1], [0.5, 1], [1, 1.5], [1.5, 2.25], [4, 3], [5, 3]]) {
    setGeometryGroupEdgeThickness(group, thickness, [9]);
    edgeHighlight = group.children.find(
      (child) => child.userData.isEdgeSelectionHighlight && child.userData.edgeIndex === 9,
    );
    const edgeLine = group.children.find(
      (child) => child.userData.isTopologicalEdgeLine && child.userData.edgeIndex === 9,
    );
    assert.equal(edgeLine.material.linewidth, thickness);
    assert.equal(edgeHighlight.material.linewidth, expectedHighlight);
    assert.equal(edgeHighlight.visible, true);
  }

  setGeometryGroupEdgeSelection(group, []);
  edgeHighlight = group.children.find(
    (child) => child.userData.isEdgeSelectionHighlight && child.userData.edgeIndex === 9,
  );
  assert.equal(edgeHighlight, undefined);
  setGeometryGroupEdgeSelection(group, [9, 10]);
  const edgeHighlights = group.children.filter((child) => child.userData.isEdgeSelectionHighlight);
  assert.equal(edgeHighlights.length, 2);
  assert.equal(edgeHighlights.find((child) => child.userData.edgeIndex === 9).material.linewidth, 3);
  assert.equal(edgeHighlights.find((child) => child.userData.edgeIndex === 10).material.linewidth, 1.5);
  setGeometryGroupEdgeThickness(group, 0.5);
  const globalHighlight = group.children.find((child) => child.userData.isEdgeSelectionHighlight);
  assert.equal(globalHighlight.material.linewidth, 1);
  setGeometryGroupEdgeSelection(group, [9, 10]);
  const reselectedHighlights = group.children.filter((child) => child.userData.isEdgeSelectionHighlight);
  assert.equal(reselectedHighlights.length, 1);
  assert.deepEqual(reselectedHighlights[0].userData.edgeIndices, [9, 10]);
  assert.equal(reselectedHighlights[0].material.linewidth, 1);
  setGeometryGroupHiddenBodies(group, new Set([0]));
  assert.equal(raycastEdge(edgeRay, group), undefined);

  disposeGroup(group);
});

test("applies thickness only to requested BREP edges and globally when unscoped", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      bodyIndex: 0,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      edges: [
        { edgeIndex: 9, positions: new Float32Array([0, 0, 0, 1, 0, 0]) },
        { edgeIndex: 10, positions: new Float32Array([0, 0, 0, 0, 1, 0]) },
      ],
    },
    {
      faceIndex: 5,
      bodyIndex: 0,
      positions: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      edges: [
        { edgeIndex: 9, positions: new Float32Array([0, 0, 0, 1, 0, 0]) },
        { edgeIndex: 11, positions: new Float32Array([0, 0, 0, 0, 0, 1]) },
      ],
    },
  ]);
  const edgeLine = (edgeIndex) => group.children.find(
    (child) =>
      child.userData.isTopologicalEdgeLine &&
      child.userData.edgeIndex === edgeIndex,
  );

  assert.equal(edgeLine(9).material.linewidth, 1);
  assert.equal(edgeLine(10).material.linewidth, 1);
  assert.equal(edgeLine(11).material.linewidth, 1);
  assert.deepEqual(getEdgeIndicesForFaces(group, [4]), [9, 10]);
  assert.deepEqual(getEdgeIndicesForFaces(group, [4, 5]), [9, 10, 11]);

  setGeometryGroupEdgeThickness(group, 4, [9, 10]);
  assert.equal(edgeLine(9).material.linewidth, 4);
  assert.equal(edgeLine(10).material.linewidth, 4);
  assert.equal(edgeLine(11).material.linewidth, 1);

  setGeometryGroupEdgeThickness(group, 2);
  assert.equal(edgeLine(9).material.linewidth, 2);
  assert.equal(edgeLine(10).material.linewidth, 2);
  assert.equal(edgeLine(11).material.linewidth, 2);

  disposeGroup(group);
});

test("hides bodies without affecting other bodies or edge visibility settings", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      bodyIndex: 1,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
    {
      faceIndex: 5,
      bodyIndex: 2,
      positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const hiddenFace = group.children.find((child) => child.userData.faceIndex === 4);
  const visibleFace = group.children.find((child) => child.userData.faceIndex === 5);
  const hiddenEdges = group.children.filter(
    (child) => child.userData.bodyIndex === 1 && child.userData.isEdgeLine,
  );
  const visibleEdges = group.children.filter(
    (child) => child.userData.bodyIndex === 2 && child.userData.isEdgeLine,
  );
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.2, 0.2, 2),
    new THREE.Vector3(0, 0, -1),
  );

  setGeometryGroupHiddenBodies(group, new Set([1]));
  assert.equal(hiddenFace.visible, false);
  assert.equal(visibleFace.visible, true);
  assert.ok(hiddenEdges.every((edge) => !edge.visible));
  assert.ok(visibleEdges.some((edge) => edge.visible));
  assert.equal(raycastFace(raycaster, group), undefined);
  raycaster.set(
    new THREE.Vector3(2.2, 0.2, 2),
    new THREE.Vector3(0, 0, -1),
  );
  assert.equal(raycastFace(raycaster, group).faceIndex, 5);

  setGeometryGroupEdgeThickness(group, 0);
  setGeometryGroupHiddenBodies(group, new Set());
  assert.equal(hiddenFace.visible, true);
  assert.ok(hiddenEdges.every((edge) => !edge.visible));
  setGeometryGroupEdgeThickness(group, 1);
  assert.ok(hiddenEdges.some((edge) => edge.visible));

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

test("applies opacity to selected faces or bodies and preserves overrides across style changes", () => {
  const group = createGeometryGroup(
    [4, 5, 6, 7].map((faceIndex) => ({
      faceIndex,
      bodyIndex: faceIndex < 6 ? 1 : 2,
      positions: new Float32Array([0, 0, faceIndex, 1, 0, faceIndex, 0, 1, faceIndex]),
      indices: new Uint32Array([0, 1, 2]),
    })),
  );
  const faces = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const opacities = () => faces.map((face) => face.material.opacity);
  const selection = new SelectionModel();

  selection.toggleAll([4, 5]);
  setGeometryGroupOpacity(group, 1, new Set(selection.selectedFaces));
  assert.deepEqual(opacities(), [1, 1, 0.5, 0.5]);
  assert.equal(faces[0].material.transparent, false);
  assert.equal(faces[0].material.depthWrite, true);

  selection.clear();
  selection.toggle(6);
  setGeometryGroupOpacity(group, 0, new Set(selection.selectedFaces));
  assert.deepEqual(opacities(), [1, 1, 0, 0.5]);
  assert.equal(faces[2].material.transparent, true);
  assert.equal(faces[2].material.depthWrite, false);

  setGeometryGroupStyle(group, {
    faceColor: 0x123456,
    opacity: 0.5,
    visible: true,
  });
  setGeometryGroupShading(group, "original");
  assert.deepEqual(opacities(), [1, 1, 0, 0.5]);
  assert.ok(getBoundaryLines(group).every((line) => line.material.opacity === 1));
  assert.ok(getSelectionHighlights(group).every((line) => line.material.opacity === 1));

  selection.clear();
  setGeometryGroupOpacity(group, 0.5, new Set(selection.selectedFaces));
  setGeometryGroupStyle(group, { faceColor: 0xabcdef, opacity: 0.5, visible: true });
  assert.deepEqual(opacities(), [0.5, 0.5, 0.5, 0.5]);

  disposeGroup(group);
});

test("shows true face colors for selected opacity changes until selection changes", () => {
  const group = createGeometryGroup(
    [4, 5, 6].map((faceIndex) => ({
      faceIndex,
      bodyIndex: faceIndex < 6 ? 1 : 2,
      positions: new Float32Array([0, 0, faceIndex, 1, 0, faceIndex, 0, 1, faceIndex]),
      indices: new Uint32Array([0, 1, 2]),
    })),
  );
  const faces = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const highlights = getSelectionHighlights(group);
  const colors = () => faces.map((face) => face.material.color.getHex());
  const selection = new SelectionModel();

  setGeometryGroupStyle(group, { faceColor: 0x123456, opacity: 0.5, visible: true });
  selection.toggleAll([4, 5]);
  setGeometryGroupSelection(group, new Set(selection.selectedFaces), "object");
  assert.deepEqual(colors(), [0xffc7c7, 0xffc7c7, 0x123456]);

  setGeometryGroupOpacity(group, 0.25, new Set(selection.selectedFaces));
  assert.deepEqual(colors(), [0x123456, 0x123456, 0x123456]);
  assert.deepEqual(faces.map((face) => face.material.opacity), [0.25, 0.25, 0.5]);

  setGeometryGroupSelection(group, new Set(selection.selectedFaces), "face");
  assert.deepEqual(colors(), [0xffc7c7, 0xffc7c7, 0x123456]);
  assert.ok(
    highlights.every((highlight) => highlight.material.color.getHex() === 0xff0000),
  );
  assert.ok(
    highlights
      .filter((highlight) => [4, 5].includes(highlight.userData.faceIndex))
      .every((highlight) => highlight.visible),
  );

  selection.toggle(6);
  setGeometryGroupSelection(group, new Set(selection.selectedFaces), "face");
  assert.deepEqual(colors(), [0xffc7c7, 0xffc7c7, 0xffc7c7]);

  selection.toggle(4);
  setGeometryGroupSelection(group, new Set(selection.selectedFaces), "face");
  assert.deepEqual(colors(), [0x123456, 0xffc7c7, 0xffc7c7]);
  assert.ok(
    highlights
      .filter((highlight) => highlight.userData.faceIndex === 4)
      .every((highlight) => !highlight.visible),
  );
  assert.ok(
    highlights
      .filter((highlight) => [5, 6].includes(highlight.userData.faceIndex))
      .every((highlight) => highlight.visible),
  );

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

test("colors selected faces or bodies and colors every face when selection is empty", () => {
  const group = createGeometryGroup([4, 5, 6, 7].map((faceIndex) => ({
    faceIndex,
    bodyIndex: faceIndex < 6 ? 0 : 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })));
  const faces = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const selection = new SelectionModel();
  selection.subscribe((indices) => setGeometryGroupSelection(group, new Set(indices)));
  const colors = () => faces.map((face) => face.material.color.getHex());

  selection.select(4);
  selection.select(6);
  setGeometryGroupFaceColor(group, 0x123456, new Set(selection.selectedFaces));
  assert.deepEqual(colors(), [0x123456, 0x9caec2, 0x123456, 0x9caec2]);
  assert.ok(
    getSelectionHighlights(group)
      .filter((highlight) => [4, 6].includes(highlight.userData.faceIndex))
      .every((highlight) => highlight.visible),
  );
  setGeometryGroupStyle(group, { faceColor: 0x9caec2, opacity: 0.25, visible: true });
  assert.deepEqual(colors(), [0x123456, 0x9caec2, 0x123456, 0x9caec2]);
  selection.toggle(4);
  assert.deepEqual(colors(), [0x123456, 0x9caec2, 0xffc7c7, 0x9caec2]);
  selection.clear();
  assert.deepEqual(colors(), [0x123456, 0x9caec2, 0x123456, 0x9caec2]);

  selection.toggleAll([4, 5]);
  selection.toggleAll([6, 7]);
  setGeometryGroupFaceColor(group, 0xabcdef, new Set(selection.selectedFaces));
  selection.clear();
  assert.deepEqual(colors(), [0xabcdef, 0xabcdef, 0xabcdef, 0xabcdef]);

  selection.toggleAll([4, 5]);
  setGeometryGroupFaceColor(group, 0x654321, new Set(selection.selectedFaces));
  setGeometryGroupStyle(group, { faceColor: 0x9caec2, opacity: 0.25, visible: true });
  setGeometryGroupShading(group, "original");
  selection.clear();
  assert.deepEqual(colors(), [0x654321, 0x654321, 0xabcdef, 0xabcdef]);
  assert.ok(faces.every((face) => face.material.opacity === 0.25));

  setGeometryGroupHiddenBodies(group, new Set([1]));
  setGeometryGroupFaceColor(group, 0x9caec2, new Set());
  setGeometryGroupHiddenBodies(group, new Set());
  assert.deepEqual(colors(), [0x9caec2, 0x9caec2, 0x9caec2, 0x9caec2]);
  disposeGroup(group);
});

test("colors selected edges, faces and bodies, or edges on visible bodies", () => {
  const edge = (edgeIndex, z) => ({
    edgeIndex,
    positions: new Float32Array([0, 0, z, 1, 0, z]),
  });
  const group = createGeometryGroup([
    { faceIndex: 0, bodyIndex: 0, edges: [edge(0, 0), edge(1, 1)] },
    { faceIndex: 1, bodyIndex: 0, edges: [edge(1, 1), edge(2, 2)] },
    { faceIndex: 2, bodyIndex: 1, edges: [edge(3, 3)] },
  ].map((mesh) => ({
    ...mesh,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })));
  const lines = group.children.filter((child) => child.userData.isTopologicalEdgeLine);
  const colors = () => lines.map((line) => line.material.color.getHex());

  setGeometryGroupEdgeSelection(group, [0]);
  setGeometryGroupEdgeColor(group, 0x123456, [], [0]);
  assert.deepEqual(colors(), [0x123456, 0, 0, 0]);
  assert.ok(group.children.filter((child) => child.userData.isSelectionHighlight)
    .every((highlight) => highlight.material.color.getHex() === 0xff0000));
  setGeometryGroupEdgeSelection(group, []);
  setGeometryGroupEdgeColor(group, 0xabcdef, [1]);
  assert.deepEqual(colors(), [0x123456, 0xabcdef, 0xabcdef, 0]);
  setGeometryGroupEdgeColor(group, 0x654321, [0, 1]);
  assert.deepEqual(colors(), [0x654321, 0x654321, 0x654321, 0]);
  setGeometryGroupEdgeColor(group, 0x445566, [0], [3]);
  assert.deepEqual(colors(), [0x445566, 0x445566, 0x654321, 0x445566]);
  setGeometryGroupEdgeColor(group, 0xffffff, [99]);
  assert.deepEqual(colors(), [0x445566, 0x445566, 0x654321, 0x445566]);

  setGeometryGroupHiddenBodies(group, new Set([1]));
  setGeometryGroupEdgeThickness(group, 0);
  setGeometryGroupEdgeColor(group, 0x112233);
  setGeometryGroupHiddenBodies(group, new Set());
  setGeometryGroupEdgeThickness(group, 1);
  setGeometryGroupShading(group, "original");
  assert.deepEqual(colors(), [0x112233, 0x112233, 0x112233, 0x445566]);
  disposeGroup(group);
});

test("colors fallback face boundaries without changing selection highlights", () => {
  const group = createGeometryGroup([0, 1].map((faceIndex) => ({
    faceIndex,
    bodyIndex: faceIndex,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })));
  const boundaries = getBoundaryLines(group);
  setGeometryGroupEdgeColor(group, 0x123456, [0]);
  assert.ok(boundaries.filter((line) => line.userData.faceIndex === 0)
    .every((line) => line.material.color.getHex() === 0x123456));
  assert.ok(boundaries.filter((line) => line.userData.faceIndex === 1)
    .every((line) => line.material.color.getHex() === 0));
  setGeometryGroupHiddenBodies(group, new Set([0]));
  setGeometryGroupEdgeColor(group, 0xabcdef);
  assert.ok(boundaries.every((line) => line.material.color.getHex() ===
    (line.userData.faceIndex === 0 ? 0x123456 : 0xabcdef)));
  assert.ok(getSelectionHighlights(group)
    .every((highlight) => highlight.material.color.getHex() === 0xff0000));
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

test("object scope selects complete bodies for the silhouette pass", () => {
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
  assert.ok(faceMeshes.every((mesh) => mesh.material.color.getHex() === 0xffc7c7));
  assert.ok(highlights.every((highlight) => !highlight.visible));
  assert.deepEqual([...group.userData.selectedBodies], [7]);
  setGeometryGroupSelection(group, new Set([0, 1, 2]), "object");
  assert.equal(group.userData.selectedBodies.size, 0);
  setGeometryGroupSelection(group, new Set([0, 1, 2, 3]), "face");
  assert.equal(group.userData.selectedBodies.size, 0);

  disposeGroup(group);
});

test("preserves selection highlights across body, face, and edge scopes", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      bodyIndex: 0,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      edges: [{ edgeIndex: 9, positions: new Float32Array([0, 0, 0, 1, 0, 0]) }],
    },
    {
      faceIndex: 5,
      bodyIndex: 0,
      positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const selection = new SelectionModel();
  let scope = "object";
  selection.subscribe((faces) => setGeometryGroupSelection(group, new Set(faces), scope));
  const meshes = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  const highlights = getSelectionHighlights(group);

  selection.toggleAll([4, 5]);
  assert.deepEqual([...group.userData.selectedBodies], [0]);
  scope = "face";
  setGeometryGroupSelection(group, new Set(selection.selectedFaces), scope);
  assert.ok(meshes.every((mesh) => mesh.material.color.getHex() === 0xffc7c7));
  assert.ok(highlights.every((highlight) => highlight.visible));
  selection.toggle(4);
  assert.deepEqual(selection.selectedFaces, [5]);
  assert.notEqual(meshes[0].material.color.getHex(), 0xffc7c7);
  assert.equal(meshes[1].material.color.getHex(), 0xffc7c7);
  assert.equal(highlights[0].visible, false);
  assert.equal(highlights[1].visible, true);

  scope = "edge";
  setGeometryGroupSelection(group, new Set(selection.selectedFaces), scope);
  setGeometryGroupEdgeSelection(group, [9]);
  scope = "object";
  setGeometryGroupSelection(group, new Set(selection.selectedFaces), scope);
  assert.equal(meshes[1].material.color.getHex(), 0xffc7c7);
  assert.ok(group.children.some((child) => child.userData.isEdgeSelectionHighlight && child.visible));
  assert.equal(group.userData.selectedBodies.size, 0);
  selection.toggleAll([4, 5]);
  assert.deepEqual([...group.userData.selectedBodies], [0]);
  selection.toggleAll([4, 5]);
  assert.deepEqual(selection.selectedFaces, []);
  assert.ok(group.children.some((child) => child.userData.isEdgeSelectionHighlight && child.visible));

  disposeGroup(group);
});

test("face edges can be highlighted and independently deselected in edge scope", () => {
  const sharedEdge = { edgeIndex: 10, positions: new Float32Array([0, 0, 0, 1, 0, 0]) };
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      bodyIndex: 0,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      edges: [
        sharedEdge,
        { edgeIndex: 11, positions: new Float32Array([0, 0, 0, 0, 1, 0]) },
      ],
    },
    {
      faceIndex: 5,
      bodyIndex: 0,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, -1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      edges: [
        sharedEdge,
        { edgeIndex: 12, positions: new Float32Array([1, 0, 0, 1, -1, 0]) },
      ],
    },
  ]);
  const selection = new SelectionModel();
  selection.toggleAll([4, 5]);
  const selectedEdges = new Set([12]);
  for (const edgeIndex of getEdgeIndicesForFaces(group, selection.selectedFaces)) {
    selectedEdges.add(edgeIndex);
  }
  setGeometryGroupSelection(group, new Set(selection.selectedFaces), "edge");
  setGeometryGroupEdgeSelection(group, [...selectedEdges]);
  assert.deepEqual([...selectedEdges].sort(), [10, 11, 12]);
  assert.deepEqual(
    group.children.filter((child) => child.userData.isEdgeSelectionHighlight)
      .flatMap((child) => child.userData.edgeIndices).sort(),
    [10, 11, 12],
  );

  const ray = new THREE.Raycaster(new THREE.Vector3(0.5, 0.05, 2), new THREE.Vector3(0, 0, -1));
  const pickedEdge = raycastEdge(ray, group, 4, new THREE.Vector3(0.5, 0.05, 0));
  assert.equal(pickedEdge.edgeIndex, 10);
  selectedEdges.delete(pickedEdge.edgeIndex);
  setGeometryGroupEdgeSelection(group, [...selectedEdges]);
  assert.deepEqual([...group.userData.selectedEdgeIndices].sort(), [11, 12]);
  assert.deepEqual(
    group.children.filter((child) => child.userData.isEdgeSelectionHighlight)
      .flatMap((child) => child.userData.edgeIndices).sort(),
    [11, 12],
  );
  assert.deepEqual(selection.selectedFaces, [4, 5]);
  disposeGroup(group);
});

test("renders a separate projected mask for each selected body on every camera change", () => {
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
  const selectedMeshes = faces.map((indices, faceIndex) => ({
    faceIndex,
    bodyIndex: 7,
    positions: new Float32Array(vertices.flat()),
    indices: new Uint32Array(indices),
  }));
  const overlappingBody = faces.map((indices, faceIndex) => ({
    faceIndex: faceIndex + faces.length,
    bodyIndex: 8,
    positions: new Float32Array(vertices.flatMap(([x, y, z]) => [x + 0.1, y + 0.1, z + 0.1])),
    indices: new Uint32Array(indices),
  }));
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(3, 3, 3);
  camera.lookAt(0.25, 0.25, 0.25);

  const group = createGeometryGroup([
    ...selectedMeshes,
    ...overlappingBody,
  ]);
  const pass = new BodySilhouettePass();
  pass.setSize(300, 200);
  pass.setGroup(group);
  let target = null;
  const color = new THREE.Color(0x123456);
  let alpha = 0.5;
  const renders = [];
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: (value) => { target = value; },
    getClearColor: (value) => value.copy(color),
    getClearAlpha: () => alpha,
    setClearColor: (value, a) => { color.set(value); alpha = a; },
    clear: () => {},
    render: (scene, view) => {
      renders.push({
        target,
        view,
        geometries: scene.children.map((child) => child.geometry),
        transforms: scene.children.map((child) => child.matrix.clone()),
      });
    },
  };
  const faceMeshes = group.children.filter(
    (child) => child instanceof THREE.Mesh && !child.userData.isEdgeLine,
  );
  group.position.set(2, 0, 0);
  setGeometryGroupSelection(group, new Set([0, 1, 2, 3]), "object");
  pass.render(renderer, camera, 1);
  camera.position.set(3, -3, 3);
  camera.lookAt(0.25, 0.25, 0.25);
  pass.render(renderer, camera, 1);
  assert.equal(renders.length, 4);
  assert.equal(renders[0].view, camera);
  assert.equal(renders[2].view, camera);
  assert.deepEqual(renders[0].geometries, faceMeshes.slice(0, 4).map((mesh) => mesh.geometry));
  assert.equal(renders[0].transforms[0].elements[12], 2);
  assert.deepEqual(renders[2].geometries, renders[0].geometries);
  assert.ok(renders[0].target);
  assert.equal(renders[1].target, null);
  assert.equal(color.getHex(), 0x123456);
  assert.equal(alpha, 0.5);

  renders.length = 0;
  setGeometryGroupHiddenBodies(group, new Set([7]));
  pass.render(renderer, camera, 1);
  assert.equal(renders.length, 0);
  setGeometryGroupHiddenBodies(group, new Set());

  setGeometryGroupSelection(group, new Set([0, 1, 2, 3, 4, 5, 6, 7]), "object");
  pass.render(renderer, camera, 1);
  assert.equal(renders.length, 4);
  assert.deepEqual(renders[2].geometries, faceMeshes.slice(4).map((mesh) => mesh.geometry));
  group.visible = false;
  pass.render(renderer, camera, 1);
  assert.equal(renders.length, 4);
  group.visible = true;
  renderer.render = () => { throw new Error("render failed"); };
  assert.throws(() => pass.render(renderer, camera, 1), /render failed/);
  assert.equal(target, null);
  assert.equal(color.getHex(), 0x123456);
  assert.equal(alpha, 0.5);
  pass.dispose();
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
