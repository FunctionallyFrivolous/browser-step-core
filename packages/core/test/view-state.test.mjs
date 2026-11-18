import assert from "node:assert/strict";
import { test } from "node:test";
import { ViewStateModel } from "../src/index.ts";

test("tracks independent view snapshots and notifies subscribers of changes", () => {
  const view = new ViewStateModel();
  const initial = view.state;
  const events = [];
  view.subscribe((state) => { state.position[0] = 999; });
  const unsubscribe = view.subscribe((state) => events.push(state));
  const next = {
    ...initial,
    projection: "perspective",
    position: [10, 20, 30],
    target: [1, 2, 3],
  };

  view.setState(next);
  next.position[0] = -1;
  view.state.target[0] = -1;
  view.setState(view.state);
  unsubscribe();
  view.setState(initial);

  assert.equal(events.length, 1);
  assert.deepEqual(events[0].position, [10, 20, 30]);
  assert.deepEqual(events[0].target, [1, 2, 3]);
  assert.deepEqual(view.state, initial);
});

test("saves, overwrites, restores, and deletes independent bookmarks", () => {
  const view = new ViewStateModel();
  const initial = view.state;
  view.saveBookmark("front");
  const changed = { ...initial, position: [4, 5, 6], verticalSpan: 9 };
  view.setState(changed);
  view.saveBookmark("side");
  view.saveBookmark("front");
  view.setState(initial);

  assert.deepEqual(view.bookmarks, ["front", "side"]);
  view.bookmarks.pop();
  assert.equal(view.restoreBookmark("front"), true);
  assert.deepEqual(view.state, changed);
  assert.equal(view.deleteBookmark("front"), true);
  assert.equal(view.restoreBookmark("front"), false);
  assert.equal(view.deleteBookmark("front"), false);
  assert.deepEqual(view.bookmarks, ["side"]);
});

test("rejects invalid camera state without changing the current view", () => {
  const view = new ViewStateModel();
  const initial = view.state;
  for (const invalid of [
    { ...initial, position: [NaN, 0, 0] },
    { ...initial, target: [0, 0] },
    { ...initial, projection: "invalid" },
    { ...initial, verticalSpan: 0 },
    { ...initial, near: -1 },
    { ...initial, far: initial.near },
    { ...initial, position: [...initial.target] },
  ]) {
    assert.throws(() => view.setState(invalid), /Invalid camera view state/);
    assert.deepEqual(view.state, initial);
  }
});
