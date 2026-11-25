/**
 * `openboard.icon.search` (Req 23.10, 25.3): case-insensitive keyword search over the embedded
 * Icon_Set, returning at most 50 icon names in alphabetical order. Needs no board.
 */
import { searchIcons } from '../icons';
import { s } from '../schema/builder';
import type { DefaultToolRegistry, ToolDefinition } from './registry';

interface SearchInput {
  keyword: string;
}

const searchTool: ToolDefinition<SearchInput, { names: string[] }> = {
  name: 'openboard.icon.search',
  description:
    'Search the built-in icon set by keyword (matches icon names and keywords, case-insensitive). Returns up to 50 icon names, alphabetical. Read-only.',
  inputSchema: s.object({ keyword: s.string({ minLength: 1, maxLength: 64 }) }),
  outputSchema: s.object({ names: s.array(s.string()) }),
  readOnly: true,
  boardResolution: 'none',
  async: true,
  handler(_ctx, input) {
    return { names: searchIcons(input.keyword) };
  },
};

export function registerIconTools(registry: Pick<DefaultToolRegistry, 'register'>): void {
  registry.register(searchTool);
}
