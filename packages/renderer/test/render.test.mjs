import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import {
  createGeometryGroup,
  fitCameraToBounds,
  fitOrthographicCameraToBounds,
  PointerGestureTracker,
  setGeometryGroupShading,
  updateFaceSelection,
} from "../src/index.ts";

function disposeGroup(group) {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      object.material.dispose();
    }
  });
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
    (child) => child instanceof THREE.LineSegments,
  );

  assert.equal(group.children.filter((child) => child instanceof THREE.Mesh).length, 1);
  assert.equal(mesh.userData.faceIndex, 4);
  assert.equal(mesh.geometry.getAttribute("position").count, 3);
  assert.deepEqual(mesh.geometry.index?.array, new Uint32Array([0, 1, 2]));
  assert.equal(mesh.geometry.getAttribute("normal").count, 3);
  assert.ok(mesh.material instanceof THREE.MeshBasicMaterial);
  assert.equal(mesh.material.color.getHex(), 0x9caec2);
  assert.equal(mesh.material.side, THREE.DoubleSide);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.opacity, 0.5);
  assert.equal(boundary.geometry.getAttribute("position").count, 6);
  assert.equal(boundary.visible, true);
  assert.equal(boundary.material.color.getHex(), 0x000000);

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

  setGeometryGroupShading(group, "original", selectedFaceIndices);
  assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
  assert.equal(mesh.material.color.getHex(), 0xffc7c7);
  assert.equal(mesh.material.side, THREE.DoubleSide);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.opacity, 0.5);
  assert.equal(mesh.material.metalness, 0.1);
  assert.equal(mesh.material.roughness, 0.65);

  setGeometryGroupShading(group, "flat", selectedFaceIndices);
  assert.ok(mesh.material instanceof THREE.MeshBasicMaterial);
  assert.equal(mesh.material.color.getHex(), 0xffc7c7);
  assert.equal(mesh.material.side, THREE.DoubleSide);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.opacity, 0.5);

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
    (child) => child instanceof THREE.LineSegments,
  );

  assert.equal(boundary.geometry.getAttribute("position").count, 8);
  assert.equal(boundary.material.color.getHex(), 0x000000);
  assert.equal(boundary.material.transparent, true);
  assert.equal(boundary.visible, true);

  disposeGroup(group);
});

test("adds and highlights selected faces without replacing prior selections", () => {
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
  const meshes = group.children.filter((child) => child instanceof THREE.Mesh);
  const boundaries = group.children.filter(
    (child) => child instanceof THREE.LineSegments,
  );
  const firstSelection = updateFaceSelection(group, new Set(), 4);
  const selected = updateFaceSelection(group, firstSelection, 5);

  assert.deepEqual([...selected], [4, 5]);
  assert.ok(meshes.every((mesh) => mesh.material.color.getHex() === 0xffc7c7));
  assert.notEqual(meshes[0].material, meshes[1].material);
  assert.ok(boundaries.every((boundary) => boundary.visible));
  assert.ok(
    boundaries.every((boundary) => boundary.material.color.getHex() === 0x000000),
  );

  disposeGroup(group);
});

test("deselects a clicked face without clearing other selected faces", () => {
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
  const meshes = group.children.filter((child) => child instanceof THREE.Mesh);
  const boundaries = group.children.filter(
    (child) => child instanceof THREE.LineSegments,
  );
  const selection = updateFaceSelection(
    group,
    updateFaceSelection(group, new Set(), 4),
    5,
  );
  const deselected = updateFaceSelection(group, selection, 4);

  assert.deepEqual([...deselected], [5]);
  assert.equal(meshes[0].material.color.getHex(), 0x9caec2);
  assert.equal(meshes[1].material.color.getHex(), 0xffc7c7);
  assert.equal(boundaries[0].visible, true);
  assert.equal(boundaries[1].visible, true);

  disposeGroup(group);
});

test("clears selected faces and restores their base color when no face is hit", () => {
  const group = createGeometryGroup([
    {
      faceIndex: 4,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  ]);
  const selection = updateFaceSelection(group, new Set(), 4);
  const cleared = updateFaceSelection(group, selection);
  const mesh = group.children.find((child) => child instanceof THREE.Mesh);
  const boundary = group.children.find(
    (child) => child instanceof THREE.LineSegments,
  );

  assert.equal(cleared.size, 0);
  assert.equal(mesh.material.color.getHex(), 0x9caec2);
  assert.equal(boundary.visible, true);

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
