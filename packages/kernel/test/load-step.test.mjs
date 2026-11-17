import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { LibcascadeKernel } from "../src/index.ts";

test("loads a STEP solid and reports body and face counts", async () => {
  const data = await readFile(new URL("./fixtures/sample.step", import.meta.url));
  const kernel = new LibcascadeKernel();

  await kernel.loadStep(data);

  assert.equal(kernel.getBodyCount(), 1);
  assert.equal(kernel.getFaceCount(), 6);

  await assert.rejects(kernel.loadStep(new Uint8Array([0, 1, 2])));
  assert.equal(kernel.getBodyCount(), 1);
  assert.equal(kernel.getFaceCount(), 6);
});
