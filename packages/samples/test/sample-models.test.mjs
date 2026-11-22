import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { test } from "node:test";
import { defaultSample, sampleModels } from "../src/index.ts";

test("uses multibodyTest as the default sample", () => {
  assert.equal(defaultSample?.name, "multibodyTest.step");
});

test("exports every shared STEP sample with an accessible asset URL", async () => {
  assert.deepEqual(
    sampleModels.map(({ name }) => name),
    ["GDT_Hole_Str.step", "multibodyTest.step", "tester.step"],
  );

  await Promise.all(
    sampleModels.map(({ url }) => access(new URL(url))),
  );
});
