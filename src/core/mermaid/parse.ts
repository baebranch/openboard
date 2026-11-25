import type { FlowNodePreset } from '../model/types';

export type MermaidDirection = 'TB' | 'BT' | 'LR' | 'RL';
export type MermaidLinkStyle = 'solid' | 'dotted' | 'thick';

export interface MermaidNode {
  id: string;
  label: string;
  preset: FlowNodePreset;
}

export interface MermaidLink {
  source: string;
  target: string;
  label?: string;
  style: MermaidLinkStyle;
  /** True when the link has an arrowhead at the target (`-->`), false for open links (`---`). */
  arrow: boolean;
}

export interface MermaidGraph {
  direction: MermaidDirection;
  nodes: MermaidNode[];
  links: MermaidLink[];
}

export interface MermaidError {
  /** 1-based line number of the first error. */
  line: number;
  message: string;
}

export type MermaidParseResult = MermaidGraph | { error: MermaidError };

export function isMermaidError(r: MermaidParseResult): r is { error: MermaidError } {
  return 'error' in r;
}

class ParseError extends Error {
  constructor(
    public line: number,
    message: string,
  ) {
    super(message);
  }
}

interface ShapeDef {
  open: string;
  close: string;
  preset: FlowNodePreset;
}

// Longer openers first so `([` wins over `(`.
const SHAPES: ShapeDef[] = [
  { open: '([', close: '])', preset: 'startEnd' },
  { open: '[(', close: ')]', preset: 'database' },
  { open: '[[', close: ']]', preset: 'document' },
  { open: '[/', close: '/]', preset: 'inputOutput' },
  { open: '[\\', close: '\\]', preset: 'inputOutput' },
  { open: '((', close: '))', preset: 'startEnd' },
  { open: '[', close: ']', preset: 'process' },
  { open: '(', close: ')', preset: 'startEnd' },
  { open: '{', close: '}', preset: 'decision' },
  { open: '>', close: ']', preset: 'annotation' },
];

const DIRECTIVE = /^(graph|flowchart)(?:\s+(TD|TB|BT|LR|RL))?\s*;?$/;
const IGNORED = /^(style|classDef|class|linkStyle|click)\b/;
const ID = /^[\p{L}\p{N}_]+/u;

const LINK_PLAIN = /^(-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,})\s*(?:\|([^|]*)\|)?/;
const LINK_LABELED: Array<[RegExp, MermaidLinkStyle]> = [
  [/^--\s+(.+?)\s+(-{2,}>|-{3,})/, 'solid'],
  [/^-\.\s+(.+?)\s+(\.+->|\.+-)/, 'dotted'],
  [/^==\s+(.+?)\s+(={2,}>|={3,})/, 'thick'],
];

export function decodeLabel(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#quot;/g, '"')
    .replace(/#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)));
}

function classify(op: string): { style: MermaidLinkStyle; arrow: boolean } {
  const arrow = op.endsWith('>');
  const style: MermaidLinkStyle = op.startsWith('=') ? 'thick' : op.startsWith('-.') ? 'dotted' : 'solid';
  return { style, arrow };
}

function cleanLabel(raw: string): string {
  let t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return decodeLabel(t);
}

class LineParser {
  pos = 0;
  constructor(
    private s: string,
    private line: number,
    private graph: MermaidGraph,
    private byId: Map<string, MermaidNode>,
  ) {}

  private fail(msg: string): never {
    throw new ParseError(this.line, msg);
  }

  private ws(): void {
    while (this.pos < this.s.length && /\s/.test(this.s[this.pos]!)) this.pos++;
  }

  run(): void {
    this.ws();
    while (this.pos < this.s.length) {
      if (this.s[this.pos] === ';') {
        this.pos++;
        this.ws();
        continue;
      }
      this.statement();
      this.ws();
      if (this.pos < this.s.length && this.s[this.pos] !== ';') {
        this.fail(`Unexpected text "${this.s.slice(this.pos, this.pos + 12)}"`);
      }
    }
  }

  private statement(): void {
    if (IGNORED.test(this.s.slice(this.pos))) {
      const semi = this.s.indexOf(';', this.pos);
      this.pos = semi < 0 ? this.s.length : semi;
      return;
    }
    let prev = this.node();
    for (;;) {
      this.ws();
      const rest = this.s.slice(this.pos);
      if (rest === '' || rest[0] === ';') return;
      let style: MermaidLinkStyle;
      let arrow: boolean;
      let label: string | undefined;
      let consumed: number;
      const labeled = LINK_LABELED.map(([re, st]) => ({ m: re.exec(rest), st })).find((x) => x.m);
      if (labeled && labeled.m) {
        const { arrow: a } = classify(labeled.m[2]!);
        style = labeled.st;
        arrow = a;
        label = cleanLabel(labeled.m[1]!);
        consumed = labeled.m[0].length;
      } else {
        const m = LINK_PLAIN.exec(rest);
        if (!m) this.fail(`Unexpected text "${rest.slice(0, 12)}", expected a link`);
        ({ style, arrow } = classify(m[1]!));
        label = m[2] !== undefined ? cleanLabel(m[2]) : undefined;
        consumed = m[0].length;
      }
      this.pos += consumed;
      this.ws();
      if (this.pos >= this.s.length || this.s[this.pos] === ';') this.fail('Link is missing a target node');
      const next = this.node();
      const link: MermaidLink = { source: prev, target: next, style, arrow };
      if (label !== undefined) link.label = label;
      this.graph.links.push(link);
      prev = next;
    }
  }

  private node(): string {
    const m = ID.exec(this.s.slice(this.pos));
    if (!m) this.fail(`Expected a node id at "${this.s.slice(this.pos, this.pos + 12)}"`);
    const id = m[0];
    this.pos += id.length;
    const rest = this.s.slice(this.pos);
    const shape = SHAPES.find((sh) => rest.startsWith(sh.open));
    let def = this.byId.get(id);
    if (!shape) {
      if (!def) {
        def = { id, label: id, preset: 'process' };
        this.byId.set(id, def);
        this.graph.nodes.push(def);
      }
      return id;
    }
    let i = shape.open.length;
    let label: string;
    if (rest[i] === '"') {
      const end = rest.indexOf('"', i + 1);
      if (end < 0) this.fail(`Unterminated quoted label for node "${id}"`);
      label = cleanLabel(rest.slice(i, end + 1));
      i = end + 1;
      while (rest[i] === ' ') i++;
      if (!rest.startsWith(shape.close, i)) this.fail(`Expected "${shape.close}" to close node "${id}"`);
    } else {
      const end = rest.indexOf(shape.close, i);
      if (end < 0) this.fail(`Missing "${shape.close}" to close node "${id}"`);
      label = cleanLabel(rest.slice(i, end));
      i = end;
    }
    this.pos += i + shape.close.length;
    if (def) {
      def.label = label;
      def.preset = shape.preset;
    } else {
      def = { id, label, preset: shape.preset };
      this.byId.set(id, def);
      this.graph.nodes.push(def);
    }
    return id;
  }
}

/** Parses Mermaid flowchart text. Pure: returns a graph or the first error (1-based line). */
export function parseMermaid(text: string): MermaidParseResult {
  const lines = text.split(/\r\n|\r|\n/);
  const graph: MermaidGraph = { direction: 'TB', nodes: [], links: [] };
  const byId = new Map<string, MermaidNode>();
  let sawDirective = false;
  try {
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const trimmed = lines[i]!.replace(/%%.*$/, '').trim();
      if (trimmed === '') continue;
      if (!sawDirective) {
        const m = DIRECTIVE.exec(trimmed);
        if (!m) throw new ParseError(lineNo, 'Expected "graph" or "flowchart" followed by a direction');
        const d = m[2] ?? 'TB';
        graph.direction = d === 'TD' ? 'TB' : (d as MermaidDirection);
        sawDirective = true;
        continue;
      }
      new LineParser(trimmed, lineNo, graph, byId).run();
    }
    if (!sawDirective) throw new ParseError(1, 'Missing "graph" or "flowchart" directive');
  } catch (e) {
    if (e instanceof ParseError) return { error: { line: e.line, message: e.message } };
    throw e;
  }
  return graph;
}
