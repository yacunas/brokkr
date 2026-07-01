/**
 * Bounded concurrency — run many async tasks with at most `concurrency` in
 * flight at once. The improved sibling of a simple in-flight `Set`: tasks are
 * queued (backpressure), results and errors propagate to the caller, and you can
 * await the pool going idle.
 */

/** A bounded worker pool. Create with {@link pool}. */
export interface Pool {
  /** Schedule a task; resolves/rejects with the task's own result once it runs. */
  run<R>(task: () => Promise<R>): Promise<R>;
  /** Tasks currently executing. */
  readonly active: number;
  /** Tasks waiting for a slot. */
  readonly queued: number;
  /** Resolves when there are no active or queued tasks. */
  onIdle(): Promise<void>;
}

/**
 * Create a pool that runs at most `concurrency` tasks simultaneously.
 *
 * @example
 * const p = pool(4);
 * const results = await Promise.all(urls.map((u) => p.run(() => fetch(u))));
 */
export function pool(concurrency: number): Pool {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  }

  let active = 0;
  const queue: Array<() => void> = [];
  const idleWaiters: Array<() => void> = [];

  const pump = (): void => {
    while (active < concurrency && queue.length > 0) {
      const start = queue.shift()!;
      active++;
      start();
    }
    if (active === 0 && queue.length === 0) {
      while (idleWaiters.length > 0) idleWaiters.shift()!();
    }
  };

  return {
    run<R>(task: () => Promise<R>): Promise<R> {
      return new Promise<R>((resolve, reject) => {
        queue.push(() => {
          // Defensive: a throwing (non-async) task shouldn't break the pool.
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              active--;
              pump();
            });
        });
        pump();
      });
    },
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
    onIdle(): Promise<void> {
      if (active === 0 && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}

/**
 * Map over items with bounded concurrency, preserving input order in the output.
 * Like `Promise.all(items.map(fn))` but never more than `concurrency` at once.
 * Rejects on the first task that throws (in-flight tasks still settle).
 */
export function mapLimit<T, R>(
  items: Iterable<T>,
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const p = pool(concurrency);
  const tasks = [...items].map((item, index) => p.run(() => fn(item, index)));
  return Promise.all(tasks);
}

/**
 * Like {@link mapLimit} but never rejects — returns a settled result per item,
 * in input order.
 */
export function settleLimit<T, R>(
  items: Iterable<T>,
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const p = pool(concurrency);
  const tasks = [...items].map((item, index) =>
    p
      .run(() => fn(item, index))
      .then(
        (value): PromiseSettledResult<R> => ({ status: "fulfilled", value }),
        (reason): PromiseSettledResult<R> => ({ status: "rejected", reason }),
      ),
  );
  return Promise.all(tasks);
}
