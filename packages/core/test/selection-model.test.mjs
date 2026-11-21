import assert from "node:assert/strict";
import { test } from "node:test";
import { SelectionModel } from "../src/index.ts";

test("tracks multiple faces, toggles, deselects and clears selection", () => {
  const selection = new SelectionModel();
  const events = [];
  selection.subscribe((faces) => events.push(faces));

  selection.select(0);
  selection.select(5);
  selection.select(5);
  selection.toggle(0);
  selection.toggle(7);
  selection.deselect(5);
  selection.deselect(5);
  assert.deepEqual(selection.selectedFaces, [7]);
  selection.clear();
  selection.clear();

  assert.deepEqual(selection.selectedFaces, []);
  assert.deepEqual(events, [[0], [0, 5], [5], [5, 7], [7], []]);
});

test("returns independent snapshots and allows listeners to unsubscribe", () => {
  const selection = new SelectionModel();
  const events = [];
  selection.subscribe((faces) => faces.push(99));
  const unsubscribe = selection.subscribe((faces) => events.push(faces));

  selection.select(2);
  selection.selectedFaces.push(42);
  unsubscribe();
  selection.select(3);

  assert.deepEqual(events, [[2]]);
  assert.deepEqual(selection.selectedFaces, [2, 3]);
});

test("toggles a group of faces as one selection change", () => {
  const selection = new SelectionModel();
  const events = [];
  selection.subscribe((faces) => events.push(faces));

  selection.toggleAll([2, 3, 4]);
  selection.toggleAll([2, 3, 4]);

  assert.deepEqual(selection.selectedFaces, []);
  assert.deepEqual(events, [[2, 3, 4], []]);
});
