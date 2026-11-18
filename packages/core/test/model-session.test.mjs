import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelSession } from "../src/index.ts";

test("loads through the kernel and exposes model data and revision", async () => {
  const mesh = {
    positions: new Float32Array([0, 0, 0]),
    indices: new Uint32Array([0]),
    faceIndex: 0,
  };
  let loaded = false;
  const kernel = {
    async loadStep(data) {
      if (data[0] === 0) {
        throw new Error("Invalid STEP data");
      }
      loaded = true;
    },
    getBodyCount: () => (loaded ? 1 : 0),
    getFaceCount: () => (loaded ? 1 : 0),
    getTessellation: () => {
      if (!loaded) throw new Error("No STEP geometry has been loaded.");
      return [mesh];
    },
  };
  const session = new ModelSession(kernel);

  assert.equal(session.revisionId, 0);
  await session.load(new Uint8Array([1]));

  assert.equal(session.bodyCount, 1);
  assert.equal(session.faceCount, 1);
  assert.deepEqual(session.tessellation, [mesh]);
  assert.equal(session.revisionId, 1);

  await assert.rejects(session.load(new Uint8Array([0])), /Invalid STEP data/);
  assert.equal(session.revisionId, 1);
  assert.equal(session.bodyCount, 1);
});
