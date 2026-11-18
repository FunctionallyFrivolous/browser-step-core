import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import {
  createGeometryGroup,
  fitCameraToBounds,
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
  assert.equal(boundary.geometry.getAttribute("position").count, 6);
  assert.equal(boundary.visible, false);

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
  assert.equal(boundary.material.color.getHex(), 0x8b0000);

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
  assert.equal(boundary.visible, false);

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
