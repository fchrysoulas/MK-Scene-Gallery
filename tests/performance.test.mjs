import assert from "node:assert/strict";
import test from "node:test";
import { LatestTaskQueue } from "../scripts/taskQueue.js";
import { getGalleryWindow } from "../scripts/galleryVirtualization.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("large galleries keep a bounded window covering the viewport and exact scroll height", () => {
  for (const count of [0, 1, 29, 30, 100003]) {
    for (const columns of [1, 4, 7, 12]) {
      for (const height of [200, 500, 1000]) {
        const rowHeight = 208.4;
        const gap = 12;
        const stride = rowHeight + gap;
        const rows = Math.ceil(count / columns);
        const fullHeight = Math.max(0, rows * stride - gap);
        for (const ratio of [0, 0.1, 0.5, 0.9, 1]) {
          const scrollTop = Math.max(0, fullHeight - height) * ratio;
          const window = getGalleryWindow({ count, columns, height, scrollTop, rowHeight, gap });
          assert.ok(window.end - window.start <= (Math.ceil(height / stride) + 5) * columns);
          assert.ok(window.start <= Math.floor(scrollTop / stride) * columns);
          assert.ok(window.end >= Math.min(count, Math.ceil((scrollTop + height) / stride) * columns));
          const renderedRows = Math.ceil((window.end - window.start) / columns);
          const actualHeight = window.top + Math.max(0, renderedRows * stride - gap) + window.bottom;
          assert.ok(Math.abs(actualHeight - fullHeight) < 0.001);
        }
      }
    }
  }
});

test("bursts keep the running task and only the latest pending selection", async () => {
  const queue = new LatestTaskQueue();
  const gate = deferred();
  const visited = [];
  const first = queue.enqueue("scene", async () => { visited.push("first"); await gate.promise; return "first"; });
  const pending = Array.from({ length: 100 }, (_, i) => queue.enqueue("scene", async () => {
    visited.push(i);
    return i;
  }, { replacePending: true }));
  gate.resolve();
  assert.equal(await first, "first");
  const results = await Promise.all(pending);
  assert.deepEqual(visited, ["first", 99]);
  assert.ok(results.slice(0, -1).every((result) => result === null));
  assert.equal(results.at(-1), 99);
  assert.equal(queue.has("scene"), false);
});

test("ordinary edits remain ordering barriers between replaceable selections", async () => {
  const queue = new LatestTaskQueue();
  const gate = deferred();
  const visited = [];
  const first = queue.enqueue("scene", () => gate.promise);
  const add = (name, replacePending) => queue.enqueue("scene", () => { visited.push(name); }, { replacePending });
  const pending = [add("old", true), add("before edit", true), add("edit", false), add("stale", true), add("latest", true)];
  gate.resolve();
  await Promise.all([first, ...pending]);
  assert.deepEqual(visited, ["before edit", "edit", "latest"]);
  assert.equal(queue.has("scene"), false);
});

test("failure releases the queue and allows the latest pending selection to run", async () => {
  const queue = new LatestTaskQueue();
  const gate = deferred();
  const failed = queue.enqueue("scene", async () => { await gate.promise; throw new Error("failed update"); });
  const failure = assert.rejects(failed, /failed update/);
  const next = queue.enqueue("scene", () => "recovered", { replacePending: true });
  assert.equal(await queue.enqueue("other scene", () => "independent"), "independent");
  gate.resolve();
  await failure;
  assert.equal(await next, "recovered");
  assert.equal(queue.has("scene"), false);
  assert.equal(queue.has("other scene"), false);
});
