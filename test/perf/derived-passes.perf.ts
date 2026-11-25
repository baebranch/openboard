/** Derived-pass benchmarks: Sync_Pass + Layout_Pass, no-op pass, layout children, layout resize (Req 18.8, 19.13, 22.9, 27.1). */
import { describe, expect, it } from 'vitest';
import { syncPass } from '../../src/core/components/sync';
import { runLayoutPass } from '../../src/core/layout/run-layout-pass';
import type { BoardDocument } from '../../src/core/model/types';
import { report, time } from './harness';
import { generateInstances, generateLayoutChildren, generateLayoutSubtree, generateTokenElements } from './fixtures';

const bothPasses = (doc: BoardDocument): BoardDocument => runLayoutPass(syncPass(doc).doc).doc;

describe('derived passes', () => {
  it('Sync_Pass + Layout_Pass on 100 instances x 20 children within 250 ms (median of 5)', async () => {
    const { doc } = generateInstances(100, 20);
    const runs = await time(5, () => bothPasses(doc), 1);
    expect(report('sync+layout 100 instances x 20', '18.8', runs, 250).pass).toBe(true);
  });

  it('no-op pass on 1,000 elements within 5 ms (median of 5)', async () => {
    const { doc } = generateTokenElements(1000);
    const runs = await time(5, () => runLayoutPass(doc), 1);
    expect(runLayoutPass(doc).doc).toBe(doc);
    expect(report('no-op layout pass 1000 elements', '19.13', runs, 5).pass).toBe(true);
  });

  it('layout of a frame with 200 children within 50 ms (median of 5)', async () => {
    const { doc } = generateLayoutChildren(200);
    const runs = await time(5, () => runLayoutPass(doc), 1);
    expect(runLayoutPass(doc).changedIds.length).toBeGreaterThan(0);
    expect(report('layout 200 children', '22.9', runs, 50).pass).toBe(true);
  });

  it('resize re-layout of a 500-element subtree within 100 ms (median of 5)', async () => {
    const { doc } = generateLayoutSubtree(500);
    const settled = runLayoutPass(doc).doc;
    const resized: BoardDocument = {
      ...settled,
      elements: settled.elements.map((e) => (e.id === 'ls0' ? { ...e, width: e.width + 120, height: e.height + 80 } : e)),
    };
    const runs = await time(5, () => runLayoutPass(resized), 1);
    expect(report('resize layout 500-element subtree', '27.1', runs, 100).pass).toBe(true);
  });
});
