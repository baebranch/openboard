/** `openboard.schema` (Req 13.8): JSON Schema of every element type and every tool's input/output. */
import { buildElementSchemas } from '../schema/elements';
import { s, type JsonSchema } from '../schema/builder';
import type { ToolDefinition, ToolRegistry } from './registry';
import { ToolFailure } from './tool-failure';

export interface SchemaOutput {
  elements: Record<string, JsonSchema>;
  tools: Record<string, { description: string; inputSchema: JsonSchema; outputSchema: JsonSchema }>;
}

export function createSchemaTool(registry: Pick<ToolRegistry, 'list' | 'describe'>): ToolDefinition<{ tool?: string }, SchemaOutput> {
  return {
    name: 'openboard.schema',
    description:
      'Return the JSON Schema of every element type and the description, input schema and output schema of every OpenBoard tool. Pass `tool` to restrict the tool list to one tool. Read-only.',
    inputSchema: s.object({ tool: s.opt(s.string({ minLength: 1 })) }),
    outputSchema: s.object({ elements: s.object({}), tools: s.object({}) }),
    readOnly: true,
    boardResolution: 'none',
    handler(_ctx, input) {
      const names = registry.list();
      if (input.tool !== undefined && !names.includes(input.tool)) {
        throw new ToolFailure('unknown_tool', `Unknown tool: ${input.tool}`);
      }
      const tools: SchemaOutput['tools'] = {};
      for (const name of input.tool !== undefined ? [input.tool] : names) {
        const d = registry.describe(name);
        tools[name] = { description: d.description, inputSchema: d.inputSchema, outputSchema: d.outputSchema };
      }
      return { elements: buildElementSchemas(), tools };
    },
  };
}
