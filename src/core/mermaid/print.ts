import type { FlowNodePreset } from '../model/types';
import type { MermaidGraph, MermaidLink } from './parse';

const SHAPE: Record<FlowNodePreset, [string, string]> = {
  startEnd: ['([', '])'],
  process: ['[', ']'],
  decision: ['{', '}'],
  inputOutput: ['[/', '/]'],
  database: ['[(', ')]'],
  document: ['[[', ']]'],
  annotation: ['>', ']'],
};

const OPS: Record<MermaidLink['style'], [string, string]> = {
  solid: ['-->', '---'],
  dotted: ['-.->', '-.-'],
  thick: ['==>', '==='],
};

export function encodeLabel(s: string): string {
  return s
    .replace(/#/g, '#35;')
    .replace(/%/g, '#37;')
    .replace(/"/g, '#34;')
    .replace(/\|/g, '#124;')
    .replace(/</g, '#60;')
    .replace(/\r\n|\r|\n/g, '<br/>');
}

/** Prints a graph as Mermaid text such that parseMermaid(printMermaid(g)) equals g. */
export function printMermaid(graph: MermaidGraph): string {
  const out = [`flowchart ${graph.direction}`];
  for (const n of graph.nodes) {
    const [o, c] = SHAPE[n.preset];
    out.push(`  ${n.id}${o}"${encodeLabel(n.label)}"${c}`);
  }
  for (const l of graph.links) {
    const op = OPS[l.style][l.arrow ? 0 : 1];
    const lab = l.label !== undefined ? `|"${encodeLabel(l.label)}"|` : '';
    out.push(`  ${l.source} ${op}${lab} ${l.target}`);
  }
  return out.join('\n') + '\n';
}
