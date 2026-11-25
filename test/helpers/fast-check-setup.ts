import fc from 'fast-check';

/**
 * Global fast-check configuration, loaded as a vitest setup file.
 *
 * - `OPENBOARD_FC_NUM_RUNS` overrides the number of runs for properties without an explicit `numRuns`.
 * - `OPENBOARD_FC_SEED` replays a run deterministically (use the seed printed by a failure).
 * - Failures always include seed, path and the shrunk counterexample (fast-check's default report),
 *   and `verbose` adds the shrinking trail so the failure is reportable from CI logs.
 */
export function readFcEnv(env: NodeJS.ProcessEnv): fc.GlobalParameters {
  const params: fc.GlobalParameters = { verbose: fc.VerbosityLevel.Verbose };
  const runs = Number.parseInt(env.OPENBOARD_FC_NUM_RUNS ?? '', 10);
  if (Number.isInteger(runs) && runs > 0) params.numRuns = runs;
  const seed = Number.parseInt(env.OPENBOARD_FC_SEED ?? '', 10);
  if (Number.isInteger(seed)) params.seed = seed;
  return params;
}

fc.configureGlobal(readFcEnv(process.env));
