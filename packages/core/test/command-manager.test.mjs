import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandManager } from "../src/index.ts";

test("executes commands and supports undo and redo", async () => {
  const manager = new CommandManager();
  const history = [];
  const command = {
    execute() {
      history.push("execute");
    },
    undo() {
      history.push("undo");
    },
  };

  await manager.execute(command);
  assert.equal(await manager.undo(), true);
  assert.equal(await manager.redo(), true);
  assert.deepEqual(history, ["execute", "undo", "execute"]);
});

test("empty undo and redo are no-ops", async () => {
  const manager = new CommandManager();

  assert.equal(await manager.undo(), false);
  assert.equal(await manager.redo(), false);
});

test("failed operations preserve history and successful new commands clear redo", async () => {
  const manager = new CommandManager();
  const history = [];
  const command = {
    execute() {
      history.push("execute");
    },
    undo() {
      history.push("undo");
    },
  };

  await manager.execute(command);
  await manager.undo();
  await assert.rejects(
    manager.execute({
      execute() {
        throw new Error("Execution failed");
      },
      undo() {},
    }),
    /Execution failed/,
  );
  assert.equal(await manager.redo(), true);
  await manager.undo();

  await manager.execute(command);
  assert.equal(await manager.redo(), false);
  assert.deepEqual(history, ["execute", "undo", "execute", "undo", "execute"]);
});
