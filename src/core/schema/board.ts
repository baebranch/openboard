import { s, type JsonSchema } from './builder';
import { assetSchema, buildElementSchemas, libraryComponentSchema, viewportSchema } from './elements';
import { ELEMENT_TYPES } from '../model/types';

export const BOARD_SCHEMA_ID = 'https://openboard.dev/schemas/board.schema.json';

/** Builds the complete Board_File JSON Schema (draft-07) with per-element definitions. */
export function buildBoardSchema(): JsonSchema {
  const elementSchemas = buildElementSchemas();
  const defs: Record<string, JsonSchema> = {
    Element: s.union(
      'type',
      ELEMENT_TYPES.map((t) => s.ref(`Element_${t}`)),
    ),
    Asset: assetSchema(),
    LibraryComponent: libraryComponentSchema(),
    Viewport: viewportSchema(),
  };
  for (const [type, schema] of Object.entries(elementSchemas)) defs[`Element_${type}`] = schema;

  const root = s.object({
    schemaVersion: s.integer({ min: 1 }),
    meta: s.object({
      id: s.string({ minLength: 1 }),
      title: s.opt(s.string()),
      createdAt: s.opt(s.string()),
      modifiedAt: s.opt(s.string()),
      generator: s.opt(s.string()),
    }),
    viewport: s.ref('Viewport'),
    elements: s.array(s.ref('Element')),
    assets: s.array(s.ref('Asset')),
    library: s.array(s.ref('LibraryComponent')),
    settings: s.opt(
      s.object({
        grid: s.opt(s.object({ enabled: s.boolean(), spacing: s.number({ min: 1 }) })),
        minimap: s.opt(s.boolean()),
      }),
    ),
  });

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: BOARD_SCHEMA_ID,
    title: 'OpenBoard Board_File',
    ...root,
    $defs: defs,
  };
}
