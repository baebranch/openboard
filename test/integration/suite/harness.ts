/** A tiny sequential test runner for the extension host (keeps the suite independent of vitest/mocha). */

export interface TestCase {
  name: string;
  fn: () => Promise<void> | void;
  timeoutMs: number;
}

const cases: TestCase[] = [];

export function test(name: string, fn: TestCase['fn'], timeoutMs = 20_000): void {
  cases.push({ name, fn, timeoutMs });
}

/** Marks a scenario as not runnable in this environment; reported but not failed. */
export class Skip extends Error {}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Assertion failed: ${message}\n  expected: ${e}\n  actual:   ${a}`);
}

export async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs: number, what: string): Promise<number> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return Date.now() - start;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function withTimeout(p: Promise<void>, ms: number, name: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Test "${name}" timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Runs every registered case; rejects (non-zero exit) when any failed. */
export async function runAll(): Promise<void> {
  let passed = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const c of cases) {
    try {
      await withTimeout(Promise.resolve().then(c.fn), c.timeoutMs, c.name);
      passed++;
      console.log(`  ✓ ${c.name}`);
    } catch (e) {
      if (e instanceof Skip) {
        skipped++;
        console.log(`  - ${c.name} (skipped: ${e.message})`);
      } else {
        failures.push(c.name);
        console.error(`  × ${c.name}\n    ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      }
    }
  }
  console.log(`\n${passed} passed, ${failures.length} failed, ${skipped} skipped`);
  if (failures.length > 0) throw new Error(`${failures.length} integration test(s) failed: ${failures.join(', ')}`);
}
