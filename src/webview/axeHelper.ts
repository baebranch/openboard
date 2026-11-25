/** Test helper: serious/critical axe violations only. Not imported by production code. */
import axe from 'axe-core';

/** color-contrast needs real layout/styles (unavailable in jsdom); the landmark `region` rule is irrelevant for fragments. */
export async function seriousViolations(node: Element): Promise<string[]> {
  const res = await axe.run(node, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`);
}
