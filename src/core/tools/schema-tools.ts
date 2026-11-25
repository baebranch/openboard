/** `openboard.schema` (Req 13.8): JSON Schema of every element type and every tool's input/output. */
import { buildElementSchemas } from '../schema/elements';
import { DOCUMENT_FIELD_SPECS, MOCKUP_FIELD_SPECS } from '../model/mockup-fields';
import type { ElementType } from '../model/types';
import { s, type JsonSchema } from '../schema/builder';
import type { ToolDefinition, ToolRegistry } from './registry';
import { ToolFailure } from './tool-failure';

export interface MockupFieldInfo {
  name: string;
  /** Where the field lives: on the element itself ('base'), in `style`, or in the type-specific bag ('type'). */
  location: string;
  valueType: string;
  description: string;
}

export interface SchemaOutput {
  elements: Record<string, JsonSchema>;
  /** Every Mockup_Field per element type, from the Field Registry. */
  mockupFields: Record<string, MockupFieldInfo[]>;
  /** Document-level Mockup_Fields (e.g. tokens). */
  documentFields: Array<{ name: string; valueType: string; description: string }>;
  tools: Record<string, { description: string; inputSchema: JsonSchema; outputSchema: JsonSchema }>;
}

export function createSchemaTool(registry: Pick<ToolRegistry, 'list' | 'describe'>): ToolDefinition<{ tool?: string }, SchemaOutput> {
  return {
    name: 'openboard.schema',
    description:
      'Return the JSON Schema of every element type and the description, input schema and output schema of every OpenBoard tool. Pass `tool` to restrict the tool list to one tool. Read-only.',
    inputSchema: s.object({ tool: s.opt(s.string({ minLength: 1 })) }),
    outputSchema: s.object({ elements: s.object({}), mockupFields: s.object({}), documentFields: s.array(s.object({})), tools: s.object({}) }),
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
      const elements = buildElementSchemas();
      const mockupFields: SchemaOutput['mockupFields'] = {};
      for (const type of Object.keys(elements) as ElementType[]) {
        mockupFields[type] = MOCKUP_FIELD_SPECS.filter((f) => f.appliesTo === undefined || f.appliesTo.includes(type)).map((f) => ({
          name: f.name,
          location: f.location,
          valueType: f.valueType,
          description: f.description,
        }));
      }
      const documentFields = DOCUMENT_FIELD_SPECS.map((f) => ({ name: f.name, valueType: f.valueType, description: f.description }));
      return { elements, mockupFields, documentFields, tools };
    },
  };
}
