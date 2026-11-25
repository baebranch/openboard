import { buildMessageSchemas } from './messages';
import type { JsonSchema } from './builder';

export * from './builder';
export * from './elements';
export * from './board';
export * from './messages';

/** Extra standalone validators compiled by scripts/build-schemas.mjs (name -> schema). */
export function buildExtraSchemas(): Record<string, JsonSchema> {
  return { ...buildMessageSchemas() };
}
