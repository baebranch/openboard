import { describe, expect, it } from 'vitest';
import { DefaultToolRegistry } from './registry';
import { registerIconTools } from './icon-tools';

// Requirements 23.10, 25.3
describe('openboard.icon.search', () => {
  const reg = new DefaultToolRegistry();
  registerIconTools(reg);
  const run = (input: unknown) => reg.invoke('openboard.icon.search', input) as Promise<any>;

  it('finds icons by name or keyword without a board', async () => {
    expect((await run({ keyword: 'Hamburger' })).names).toEqual(['menu']);
  });

  it('returns at most 50 alphabetical names', async () => {
    const { names } = await run({ keyword: 'e' });
    expect(names).toHaveLength(50);
    expect(names).toEqual([...names].sort());
  });

  it('rejects empty and over-long keywords', async () => {
    expect((await run({ keyword: '' })).error).toBeDefined();
    expect((await run({ keyword: 'x'.repeat(65) })).error).toBeDefined();
  });
});
