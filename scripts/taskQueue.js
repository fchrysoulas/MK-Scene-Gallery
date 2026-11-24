// Keep the running task and the latest pending replaceable task. Ordinary tasks
// remain ordering barriers, so unrelated document edits are never discarded.
export class LatestTaskQueue {
  constructor() {
    this.queues = new Map();
  }

  has(key) {
    return this.queues.has(key);
  }

  enqueue(key, operation, { replacePending = false } = {}) {
    return new Promise((resolve, reject) => {
      const task = { operation, replacePending, resolve, reject };
      const queue = this.queues.get(key);
      if (!queue) {
        const pending = [];
        this.queues.set(key, pending);
        void this._run(key, pending, task);
        return;
      }

      const previous = queue.at(-1);
      if (replacePending && previous?.replacePending) {
        queue.pop();
        previous.resolve(null);
      }
      queue.push(task);
    });
  }

  async _run(key, queue, task) {
    try {
      task.resolve(await task.operation());
    } catch (error) {
      task.reject(error);
    } finally {
      const next = queue.shift();
      if (next) void this._run(key, queue, next);
      else this.queues.delete(key);
    }
  }
}
