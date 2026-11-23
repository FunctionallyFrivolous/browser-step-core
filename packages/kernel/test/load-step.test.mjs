import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LibcascadeKernel } from "../src/index.ts";

test("loads a STEP solid and reports body and face counts", async () => {
  const data = await readFile(new URL("./fixtures/sample.step", import.meta.url));
  const kernel = new LibcascadeKernel();

  assert.throws(() => kernel.getTessellation(), /No STEP geometry has been loaded/);

  await kernel.loadStep(data);

  assert.equal(kernel.getBodyCount(), 1);
  assert.equal(kernel.getFaceCount(), 6);

  const meshes = kernel.getTessellation();
  assert.ok(meshes.length > 0);
  assert.ok(meshes.every((mesh) => mesh.bodyIndex === 0));
  assert.ok(meshes.every((mesh) => mesh.positions.length > 0 && mesh.indices.length > 0));
  assert.ok(
    meshes.every((mesh) => [...mesh.indices].every((index) => index < mesh.positions.length / 3)),
  );
  const edgeFaces = new Map();
  for (const mesh of meshes) {
    for (const edge of mesh.edges) {
      const faces = edgeFaces.get(edge.edgeIndex) ?? [];
      faces.push(mesh.faceIndex);
      edgeFaces.set(edge.edgeIndex, faces);
      assert.ok(edge.positions.length >= 6);
      assert.equal(edge.positions.length % 3, 0);
    }
  }
  assert.equal(edgeFaces.size, 12);
  assert.ok([...edgeFaces.values()].every((faces) => faces.length === 2));

  await assert.rejects(kernel.loadStep(new Uint8Array([0, 1, 2])));
  assert.equal(kernel.getBodyCount(), 1);
  assert.equal(kernel.getFaceCount(), 6);
});

test("assigns each face to its containing solid", async () => {
  const data = await readFile(
    new URL("../../samples/src/models/multibodyTest.step", import.meta.url),
  );
  const kernel = new LibcascadeKernel();
  await kernel.loadStep(data);

  const meshes = kernel.getTessellation();
  const bodyIndices = new Set(meshes.map((mesh) => mesh.bodyIndex));
  const edgeFaces = new Map();
  for (const mesh of meshes) {
    for (const edge of mesh.edges) {
      const faces = edgeFaces.get(edge.edgeIndex) ?? [];
      faces.push(mesh.faceIndex);
      edgeFaces.set(edge.edgeIndex, faces);
    }
  }

  assert.equal(kernel.getBodyCount(), 3);
  assert.deepEqual([...bodyIndices].sort(), [0, 1, 2]);
  assert.ok(edgeFaces.size > 0);
  assert.ok([...edgeFaces.values()].every((faces) => faces.length === 2));
});
