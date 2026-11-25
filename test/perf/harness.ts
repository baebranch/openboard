/**
 * Perf suite helpers: timing, budgets (PERF_STRICT), result recording to results/latest.json.
 * See test/perf/README.md for what each measurement proxies.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESULTS_FILE = join(dirname(fileURLToPath(import.meta.url)), 'results', 'latest.json');

/** PERF_STRICT=1 enforces exact budgets; otherwise budgets are multiplied by 3 (CI tolerance). */
export const STRICT = process.env['PERF_STRICT'] === '1';
export const CI_FACTOR = STRICT ? 1 : 3;

export const BUDGETS = {
  activationMs: 2000, // Req 1.7
  openMs5MB: 2000, // Req 2.1
  openMs5000Elements: 3000, // Req 17.1
  batch1000Ms: 5000, // Req 17.4
  frameMs: 1000 / 30, // Req 3.13, 17.3 (30 fps proxy)
} as const;

export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Runs `fn` `runs` times (after `warmup` unmeasured runs) and returns per-run wall times in ms. */
export async function time(runs: number, fn: () => unknown, warmup = 0): Promise<number[]> {
  for (let i = 0; i < warmup; i++) await fn();
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    out.push(performance.now() - t);
  }
  return out;
}

/** Like `time`, but returns each run's own result (e.g. a per-frame average) instead of wall time. */
export async function sample(runs: number, fn: () => number, warmup = 0): Promise<number[]> {
  for (let i = 0; i < warmup; i++) fn();
  return Array.from({ length: runs }, () => fn());
}

export interface Measurement {
  name: string;
  requirement: string;
  medianMs: number;
  runs: number[];
  budgetMs: number;
  limitMs: number;
  pass: boolean;
  note?: string;
}

/** Records, prints and returns a measurement; the caller asserts `pass`. */
export function report(name: string, requirement: string, runs: number[], budgetMs: number, note?: string): Measurement {
  const medianMs = median(runs);
  const limitMs = budgetMs * CI_FACTOR;
  const m: Measurement = { name, requirement, medianMs, runs, budgetMs, limitMs, pass: medianMs <= limitMs, ...(note ? { note } : {}) };
  // eslint-disable-next-line no-console
  console.log(
    `[perf] ${name.padEnd(46)} median ${medianMs.toFixed(2).padStart(9)} ms | budget ${budgetMs.toFixed(1).padStart(7)} ms | limit ${limitMs.toFixed(1).padStart(7)} ms (${STRICT ? 'strict' : '3x'}) | ${m.pass ? 'OK' : 'OVER'} | Req ${requirement}`,
  );
  record(m);
  return m;
}

export function record(value: Measurement | { name: string; [k: string]: unknown }): void {
  mkdirSync(dirname(RESULTS_FILE), { recursive: true });
  let data: { measurements: Array<{ name: string }> } & Record<string, unknown> = { measurements: [] };
  if (existsSync(RESULTS_FILE)) {
    try {
      data = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'));
    } catch {
      /* start fresh */
    }
  }
  data.measurements = [...data.measurements.filter((x) => x.name !== value.name), value];
  writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2) + '\n');
}
