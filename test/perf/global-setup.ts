import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname } from 'node:path';
import { CI_FACTOR, RESULTS_FILE, STRICT, type Measurement } from './harness';

/** Resets results/latest.json with machine info before each perf run; prints a summary table after. */
export default function setup(): () => void {
  mkdirSync(dirname(RESULTS_FILE), { recursive: true });
  const c = cpus();
  writeFileSync(
    RESULTS_FILE,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        strict: STRICT,
        ciFactor: CI_FACTOR,
        node: process.version,
        machine: { os: `${platform()} ${release()}`, cpu: c[0]?.model ?? 'unknown', cores: c.length, memGB: Math.round(totalmem() / 2 ** 30) },
        measurements: [],
      },
      null,
      2,
    ) + '\n',
  );
  return () => {
    const data = JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as { measurements: Array<Partial<Measurement> & { name: string }> };
    const rows = data.measurements
      .filter((m) => typeof m.medianMs === 'number')
      .map((m) => ({
        measurement: m.name,
        req: m.requirement,
        'median ms': Number(m.medianMs!.toFixed(2)),
        'budget ms': Number(m.budgetMs!.toFixed(1)),
        'limit ms': Number(m.limitMs!.toFixed(1)),
        result: m.pass ? 'OK' : 'OVER',
      }));
    // eslint-disable-next-line no-console
    console.log(`\nOpenBoard perf (${STRICT ? 'PERF_STRICT=1, exact budgets' : `budgets x${CI_FACTOR}`}) -> ${RESULTS_FILE}`);
    // eslint-disable-next-line no-console
    console.table(rows);
  };
}
