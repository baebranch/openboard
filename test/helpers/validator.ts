/**
 * Test helper: compiles the board validator in-process with Ajv from `buildBoardSchema()`
 * (no dist/validators.js, no child processes, so concurrent test files cannot race).
 * Idempotent: the validator is compiled once per module instance.
 */
import Ajv from 'ajv';
import { setBoardValidator, type BoardValidator } from '../../src/core/format/parser';
import { buildBoardSchema } from '../../src/core/schema';

let cached: BoardValidator | undefined;

/** Returns the compiled board validator (compiling it on first use). */
export function getBoardValidator(): BoardValidator {
  if (!cached) {
    const ajv = new Ajv({ allErrors: false, strict: true, discriminator: true });
    cached = ajv.compile(buildBoardSchema() as object) as unknown as BoardValidator;
  }
  return cached;
}

/** Compiles (if needed) and registers the validator with the parser. */
export function installBoardValidator(): BoardValidator {
  const v = getBoardValidator();
  setBoardValidator(v);
  return v;
}
