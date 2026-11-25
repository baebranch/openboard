/**
 * Promise-chain mutex. Tasks run one at a time in arrival order; each sees the
 * effects of the previous one. A rejected task does not block later tasks.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  /** Number of tasks queued or running. */
  get size(): number {
    return this.pending;
  }

  run<T>(task: () => T | Promise<T>): Promise<T> {
    this.pending++;
    const result = this.tail.then(() => task());
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.pending--;
    });
  }
}
