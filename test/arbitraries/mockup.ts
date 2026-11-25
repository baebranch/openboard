/**
 * Shared fast-check arbitraries for the mockup design features (Req 28.1, 28.3).
 *
 * Everything here is re-exported from `./index`. Generators fall in four groups:
 *
 * - Building blocks: `arbTokenCollection`, `arbLayoutSpec`, `arbSizing`, `arbOverride`,
 *   `arbIconName`, `arbMockupElement` (one element carrying Mockup_Fields).
 * - Structures (arrays of elements with unique ids under a caller-chosen prefix):
 *   `arbNestedFrames` (Frame depth >= 3), `arbComponentNesting` (component depth >= 3 with
 *   overrides), `arbComponentCycle`, `arbLayoutTree` (Layout_Frames with mixed sizing).
 * - Documents: `arbMockupBoardDocument` (every Mockup_Field present at least once),
 *   `arbSchemaV1Document` (no Schema_V2_Feature), `arbSchemaV2Document` (at least one),
 *   and one wrapper document per structure.
 *
 * Every document except `arbComponentCycleDocument` is acyclic: the Sync_Pass, Layout_Pass and
 * Derived_Geometry_Pass accept it. The cycle document satisfies the structural invariants but the
 * Sync_Pass rejects it with a ComponentCycleError. All documents round-trip through the
 * serializer and the JSON schema validator.
 */
import fc from 'fast-check';
import { effectiveSchemaVersion } from '../../src/core/format/schema-version';
import { MOCKUP_FIELD_SPECS } from '../../src/core/model/mockup-fields';
import type { BoardDocument, Color, Element, ElementType } from '../../src/core/model/types';
import type { Override } from '../../src/core/components/types';
import type { LayoutSpec, Sizing, Spacing } from '../../src/core/layout/types';
import { CROSS_AXIS_ALIGNS, MAIN_AXIS_ALIGNS, SIZING_MODES, STACK_DIRECTIONS } from '../../src/core/layout/types';
import type { TokenCollection } from '../../src/core/tokens/types';
import { arbBoardDocument, arbElement } from './index';

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Names of the Tokens a generated document defines, used to build valid Token_References. */
export interface TokenNames {
  colors: string[];
  fonts: string[];
  numbers: string[];
}

export const NO_TOKENS: TokenNames = { colors: [], fonts: [], numbers: [] };

const arbHex: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0')}`);

const arbTokenName: fc.Arbitrary<string> = fc.stringMatching(/^[a-z][a-z0-9._-]{0,15}$/).map((s) => `tk-${s}`);

function tokenMap<T>(value: fc.Arbitrary<T>): fc.Arbitrary<Record<string, T>> {
  return fc
    .array(fc.tuple(arbTokenName, value), { minLength: 1, maxLength: 4 })
    .map((entries) => Object.fromEntries(entries) as Record<string, T>);
}

const arbColorTokenValue = fc.oneof(
  arbHex,
  fc.constant('theme:default'),
  fc.record({ light: arbHex, dark: arbHex }),
);

/**
 * Token collection with at least one color Token (fonts and numbers optional), or with every
 * category populated when `all` is true. Values are always literals.
 */
export function arbTokenCollection(all = false): fc.Arbitrary<TokenCollection> {
  return fc.record(
    {
      colors: tokenMap(arbColorTokenValue),
      fonts: tokenMap(fc.constantFrom('sans-serif', 'serif', 'monospace', 'Georgia, serif')),
      numbers: tokenMap(fc.integer({ min: 0, max: 64 })),
    },
    { requiredKeys: all ? ['colors', 'fonts', 'numbers'] : ['colors'] },
  );
}

export function tokenNamesOf(tokens: TokenCollection | undefined): TokenNames {
  return {
    colors: Object.keys(tokens?.colors ?? {}),
    fonts: Object.keys(tokens?.fonts ?? {}),
    numbers: Object.keys(tokens?.numbers ?? {}),
  };
}

/** A literal color, or (when `names` has color Tokens) possibly a Token_Reference to one. */
export function arbColorOrRef(names: readonly string[] = []): fc.Arbitrary<Color> {
  const literal = fc.oneof(arbHex as fc.Arbitrary<Color>, fc.constant<Color>('theme:default'));
  if (names.length === 0) return literal;
  return fc.oneof(literal, fc.constantFrom(...names).map((n): Color => `token:${n}`));
}

// ---------------------------------------------------------------------------
// Layout and sizing
// ---------------------------------------------------------------------------

/** Gap or padding side: a number in 0..1000, or a reference to a number Token when one exists. */
export function arbSpacing(numberNames: readonly string[] = []): fc.Arbitrary<Spacing> {
  const n = fc.integer({ min: 0, max: 200 });
  if (numberNames.length === 0) return n;
  return fc.oneof(n, fc.constantFrom(...numberNames).map((t) => `token:${t}`));
}

export function arbLayoutSpec(numberNames: readonly string[] = []): fc.Arbitrary<LayoutSpec> {
  const sp = arbSpacing(numberNames);
  return fc.record({
    direction: fc.constantFrom(...STACK_DIRECTIONS),
    gap: sp,
    padding: fc.record({ top: sp, right: sp, bottom: sp, left: sp }),
    mainAlign: fc.constantFrom(...MAIN_AXIS_ALIGNS),
    crossAlign: fc.constantFrom(...CROSS_AXIS_ALIGNS),
  });
}

export const arbSizing: fc.Arbitrary<Sizing> = fc.record({
  width: fc.constantFrom(...SIZING_MODES),
  height: fc.constantFrom(...SIZING_MODES),
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const ICON_NAMES = ['home', 'search', 'user', 'settings', 'heart', 'not-in-the-icon-set'];
/** Icon name: usually a plausible built-in name, sometimes any 1..64 character string. */
export const arbIconName: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...ICON_NAMES),
  fc.string({ minLength: 1, maxLength: 64 }),
);

const arbWeight = fc.integer({ min: 1, max: 9 }).map((n) => n * 100);
const arbFit = fc.constantFrom('cover' as const, 'contain' as const, 'stretch' as const);
const arbOpacity = fc.integer({ min: 0, max: 100 });
const arbDim = fc.integer({ min: 1, max: 2000 });

/**
 * Per-element Override. Every Overridable_Property may appear; the keys listed in `required`
 * always do. `root` adds `width` and `height` (only meaningful under the key `''`).
 */
export function arbOverride(opts: { root?: boolean; required?: (keyof Override)[]; names?: TokenNames } = {}): fc.Arbitrary<Override> {
  const names = opts.names ?? NO_TOKENS;
  const model: Record<keyof Override, fc.Arbitrary<unknown>> = {
    text: fc.string({ maxLength: 20 }),
    fill: arbColorOrRef(names.colors),
    stroke: arbColorOrRef(names.colors),
    textColor: arbColorOrRef(names.colors),
    fontWeight: arbWeight,
    imageFill: fc.record({ assetId: fc.constant('asset-missing'), fit: arbFit }),
    icon: arbIconName,
    opacity: arbOpacity,
    visible: fc.boolean(),
    width: arbDim,
    height: arbDim,
  };
  const keys = (Object.keys(model) as (keyof Override)[]).filter((k) =>
    opts.root === true ? k !== 'visible' : k !== 'width' && k !== 'height',
  );
  const rec = Object.fromEntries(keys.map((k) => [k, model[k]]));
  return fc.record(rec, { requiredKeys: (opts.required ?? []).filter((k) => keys.includes(k)) }) as fc.Arbitrary<Override>;
}

// ---------------------------------------------------------------------------
// Mockup_Fields on a single element
// ---------------------------------------------------------------------------

function appliesTo(field: string, type: ElementType): boolean {
  const spec = MOCKUP_FIELD_SPECS.find((s) => s.name === field);
  return spec !== undefined && (spec.appliesTo === undefined || spec.appliesTo.includes(type));
}

export interface MockupElementOptions {
  /** Include Schema_V2 fields (sizing, ignoreLayout, layout, Token_References). Default true. */
  v2?: boolean;
  /** Always set every applicable field instead of a random subset. Default false. */
  force?: boolean;
  id?: string;
}

/**
 * One element of `type` carrying Mockup_Fields: cornerRadii, imageFill, fontWeight, textColor,
 * textWrap, clipContent (Phase 1) and layout, sizing, ignoreLayout plus Token_References (v2).
 * Component fields are produced by the component generators instead. Only fields that apply to
 * `type` are set, matching the Field Registry.
 */
export function arbMockupElement(
  type: ElementType,
  names: TokenNames = NO_TOKENS,
  opts: MockupElementOptions = {},
): fc.Arbitrary<Element> {
  const v2 = opts.v2 ?? true;
  const force = opts.force ?? false;
  return arbElement(type, opts.id).chain((el) => {
    const maxRadius = Math.min(el.width, el.height) / 2;
    const radius = fc.integer({ min: 0, max: 100 }).map((p) => Math.floor(maxRadius * p) / 100);
    const colors = names.colors;
    const table: Record<string, { style: boolean; arb: fc.Arbitrary<unknown> }> = {
      cornerRadii: { style: true, arb: fc.tuple(radius, radius, radius, radius) },
      imageFill: { style: true, arb: fc.record({ assetId: fc.constant('asset-missing'), fit: arbFit }) },
      fontWeight: { style: false, arb: arbWeight },
      textColor: { style: false, arb: arbColorOrRef(v2 ? colors : []) },
      textWrap: { style: false, arb: fc.constantFrom('none', 'wrap') },
      clipContent: { style: false, arb: fc.boolean() },
      layout: { style: false, arb: arbLayoutSpec(names.numbers) },
      sizing: { style: false, arb: arbSizing },
      ignoreLayout: { style: false, arb: fc.boolean() },
    };
    const active = Object.keys(table).filter(
      (f) => appliesTo(f, type) && (v2 || !MOCKUP_FIELD_SPECS.find((s) => s.name === f)!.schemaV2),
    );
    const rec = Object.fromEntries(active.map((f) => [f, table[f]!.arb]));
    const tokenFill = v2 && colors.length > 0 ? fc.option(arbColorOrRef(colors), { nil: undefined }) : fc.constant(undefined);
    const tokenFont =
      v2 && names.fonts.length > 0 && 'fontSize' in el
        ? fc.option(fc.constantFrom(...names.fonts).map((n) => `token:${n}`), { nil: undefined })
        : fc.constant(undefined);
    return fc
      .tuple(fc.record(rec, { requiredKeys: force ? active : [] }), tokenFill, tokenFont)
      .map(([vals, fill, font]) => {
        const out: Record<string, unknown> = { ...el, style: { ...el.style } };
        for (const [k, v] of Object.entries(vals)) {
          if (table[k]!.style) (out.style as Record<string, unknown>)[k] = v;
          else out[k] = v;
        }
        if (fill !== undefined) (out.style as Record<string, unknown>).fill = fill;
        if (font !== undefined) out.fontFamily = font;
        return out as unknown as Element;
      });
  });
}

// ---------------------------------------------------------------------------
// Element trees
// ---------------------------------------------------------------------------

interface Node {
  el: Element;
  kids: Node[];
}

/** Flattens a forest to elements with ids `${prefix}${n}` and parentId set from the tree. */
function flattenForest(nodes: Node[], prefix: string, parentId?: string, counter = { n: 0 }): Element[] {
  const out: Element[] = [];
  for (const node of nodes) {
    const id = `${prefix}${counter.n++}`;
    const el = { ...node.el, id } as Element;
    if (parentId !== undefined) el.parentId = parentId;
    else delete el.parentId;
    out.push(el, ...flattenForest(node.kids, prefix, id, counter));
  }
  return out;
}

/**
 * Chain of Frames nested `depth` levels deep (`minDepth..maxDepth`, default 3..5), each holding a
 * leaf shape; ids are `${prefix}0`, `${prefix}1`, ... Frames randomly set clipContent.
 */
export function arbNestedFrames(opts: { minDepth?: number; maxDepth?: number; prefix?: string } = {}): fc.Arbitrary<Element[]> {
  const { minDepth = 3, maxDepth = 5, prefix = 'nf-' } = opts;
  const frame = arbMockupElement('frame', NO_TOKENS, { v2: false });
  const leaf = arbElement('rectangle');
  return fc
    .tuple(fc.integer({ min: minDepth, max: maxDepth }), fc.array(frame, { minLength: maxDepth, maxLength: maxDepth }), fc.array(leaf, { minLength: maxDepth, maxLength: maxDepth }))
    .map(([depth, frames, leaves]) => {
      let tree: Node | undefined;
      for (let i = depth - 1; i >= 0; i--) {
        tree = { el: frames[i]!, kids: tree ? [{ el: leaves[i]!, kids: [] }, tree] : [{ el: leaves[i]!, kids: [] }] };
      }
      return flattenForest([tree!], prefix);
    });
}

const arbLeafType = fc.constantFrom<ElementType>('rectangle', 'ellipse', 'text', 'sticky', 'flowNode');

function arbLayoutNode(depth: number, names: TokenNames): fc.Arbitrary<Node> {
  const leaf: fc.Arbitrary<Node> = arbLeafType
    .chain((t) => arbMockupElement(t, names, { force: false }))
    .chain((el) => fc.tuple(arbSizing, fc.boolean()).map(([sizing, ignore]) => ({ ...el, sizing, ...(ignore ? { ignoreLayout: true } : {}) }) as Element))
    .map((el) => ({ el, kids: [] }));
  const frame = arbElement('frame').chain((f) =>
    fc.tuple(arbLayoutSpec(names.numbers), arbSizing, fc.boolean()).map(([layout, sizing, ignore]): Element => ({
      ...f,
      layout,
      sizing,
      ...(ignore ? { ignoreLayout: true } : {}),
    }) as Element),
  );
  const child = depth > 0 ? fc.oneof({ weight: 3, arbitrary: leaf }, { weight: 1, arbitrary: arbLayoutNode(depth - 1, names) }) : leaf;
  return fc.tuple(frame, fc.array(child, { minLength: 1, maxLength: 4 })).map(([el, kids]) => ({ el, kids }));
}

/**
 * Layout_Frame tree (root plus nested Layout_Frames up to `depth` levels, default 2) whose
 * children mix fixed/hug/fill sizing, `ignoreLayout`, and Token_References for gap and padding.
 */
export function arbLayoutTree(opts: { depth?: number; prefix?: string; names?: TokenNames } = {}): fc.Arbitrary<Element[]> {
  const { depth = 2, prefix = 'lt-', names = NO_TOKENS } = opts;
  return arbLayoutNode(depth, names).map((root) => flattenForest([root], prefix));
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Master `${p}M0` (text, icon and rectangle children), masters `${p}M1..M{depth-1}` each holding an
 * instance of the previous master, and a top-level instance `${p}I` of the last master. Component
 * nesting depth is `minDepth..maxDepth` masters (default 3..5). Instances carry Overrides,
 * including the root size override under `''`.
 */
export function arbComponentNesting(
  opts: { minDepth?: number; maxDepth?: number; prefix?: string; names?: TokenNames } = {},
): fc.Arbitrary<Element[]> {
  const { minDepth = 3, maxDepth = 5, prefix = 'cn-', names = NO_TOKENS } = opts;
  const frames = fc.array(arbElement('frame'), { minLength: 2 * maxDepth + 2, maxLength: 2 * maxDepth + 2 });
  const kids = fc.tuple(arbElement('text'), arbElement('icon'), arbElement('rectangle'));
  const ov = (extra: Parameters<typeof arbOverride>[0] = {}): fc.Arbitrary<Override> => arbOverride({ names, ...extra });
  return fc
    .tuple(
      fc.integer({ min: minDepth, max: maxDepth }),
      frames,
      kids,
      fc.record({
        text: ov(),
        icon: ov(),
        rect: ov(),
        root: ov({ root: true, required: ['width', 'height'] }),
        inner: ov(),
      }),
    )
    .map(([depth, fs, [text, icon, rect], o]) => {
      const p = prefix;
      const out: Element[] = [];
      const master = (i: number): Element =>
        ({ ...fs[i]!, id: `${p}M${i}`, component: `${p}Comp${i}`, type: 'frame' }) as Element;
      for (let i = 0; i < depth; i++) {
        const m = master(i);
        delete (m as { parentId?: string }).parentId;
        out.push(m);
        if (i === 0) {
          out.push(
            { ...text, id: `${p}M0-t`, parentId: m.id } as Element,
            { ...icon, id: `${p}M0-i`, parentId: m.id } as Element,
            { ...rect, id: `${p}M0-r`, parentId: m.id } as Element,
          );
        } else {
          const overrides: Record<string, Override> =
            i === 1
              ? { [`${p}M0-t`]: o.text, [`${p}M0-i`]: o.icon, [`${p}M0-r`]: o.rect }
              : { [`${p}N${i - 1}`]: { opacity: o.inner.opacity ?? 50 } };
          const inst = {
            ...fs[depth + i]!,
            id: `${p}N${i}`,
            instanceOf: `${p}M${i - 1}`,
            parentId: m.id,
            overrides,
          } as Element;
          delete (inst as { component?: string }).component;
          out.push(inst);
        }
      }
      const top = {
        ...fs[2 * maxDepth]!,
        id: `${p}I`,
        instanceOf: `${p}M${depth - 1}`,
        overrides: { '': o.root },
      } as Element;
      delete (top as { component?: string }).component;
      delete (top as { parentId?: string }).parentId;
      out.push(top);
      return out;
    });
}

/**
 * A cycle of `length` (1..3, default random) masters where each holds an instance of the next, and
 * the last of the first. Length 1 is a master containing an instance of itself. Structurally valid;
 * the Sync_Pass rejects it with a ComponentCycleError.
 */
export function arbComponentCycle(opts: { length?: number; prefix?: string } = {}): fc.Arbitrary<Element[]> {
  const prefix = opts.prefix ?? 'cy-';
  const len = opts.length !== undefined ? fc.constant(opts.length) : fc.integer({ min: 1, max: 3 });
  return fc.tuple(len, fc.array(arbElement('frame'), { minLength: 6, maxLength: 6 })).map(([n, fs]) => {
    const out: Element[] = [];
    for (let i = 0; i < n; i++) {
      const m = { ...fs[i]!, id: `${prefix}M${i}`, component: `${prefix}Comp${i}` } as Element;
      delete (m as { parentId?: string }).parentId;
      const inst = { ...fs[3 + i]!, id: `${prefix}N${i}`, instanceOf: `${prefix}M${(i + 1) % n}`, parentId: m.id } as Element;
      delete (inst as { component?: string }).component;
      out.push(m, inst);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** `base` with extra elements appended and tokens set; `schemaVersion` is the lowest representable. */
function withElements(base: BoardDocument, extra: Element[], tokens?: TokenCollection): BoardDocument {
  const doc: BoardDocument = { ...base, elements: [...base.elements, ...extra] };
  if (tokens !== undefined) doc.tokens = tokens;
  return { ...doc, schemaVersion: effectiveSchemaVersion(doc) };
}

/** Types that take Mockup_Fields in the showcase (one forced element each). */
const SHOWCASE_TYPES: ElementType[] = ['rectangle', 'ellipse', 'diamond', 'frame', 'sticky', 'flowNode', 'text'];

/** Replaces Icon elements with rectangles of the same id, so a document stays Schema_Version 1. */
function stripV2(base: BoardDocument): BoardDocument {
  return {
    ...base,
    elements: base.elements.map((e) => {
      if (e.type !== 'icon') return e;
      const { name: _name, ...rest } = e;
      return { ...rest, type: 'rectangle' } as Element;
    }),
  };
}

/**
 * Board_Document with every Mockup_Field set at least once (including Tokens, components,
 * instances, overrides, layout, sizing, ignoreLayout and icons), mixed with ordinary random
 * elements. `maxBase` bounds the ordinary elements (default 20). Acyclic and valid.
 */
export function arbMockupBoardDocument(maxBase = 20): fc.Arbitrary<BoardDocument> {
  return fc
    .tuple(arbBoardDocument(maxBase), arbTokenCollection(true))
    .chain(([base, tokens]) => {
      const names = tokenNamesOf(tokens);
      const showcase = fc.tuple(...SHOWCASE_TYPES.map((t, i) => arbMockupElement(t, names, { force: true, id: `mk-${i}` })));
      const sizingOnIcon = arbMockupElement('icon', names, { force: true, id: 'mk-icon' });
      const wrap = fc.constantFrom<'light' | 'dark' | 'auto'>('light', 'dark', 'auto');
      return fc
        .tuple(
          showcase,
          sizingOnIcon,
          arbNestedFrames({ prefix: 'mk-nf-' }),
          arbComponentNesting({ prefix: 'mk-cn-', names }),
          arbLayoutTree({ prefix: 'mk-lt-', names }),
          fc.option(wrap, { nil: undefined }),
        )
        .map(([shown, icon, frames, comps, layout, mode]) => {
          const doc = withElements(base, [...shown, icon, ...frames, ...comps, ...layout], tokens);
          return mode === undefined ? doc : { ...doc, settings: { ...doc.settings, activeMode: mode }, schemaVersion: 2 };
        });
    });
}

/**
 * Document that uses no Schema_V2_Feature: Schema_Version 1 is its lowest representable version.
 * Phase 1 Mockup_Fields (cornerRadii, imageFill, fontWeight, textColor, textWrap, clipContent) occur.
 */
export function arbSchemaV1Document(maxBase = 15): fc.Arbitrary<BoardDocument> {
  return fc
    .tuple(arbBoardDocument(maxBase), fc.tuple(...SHOWCASE_TYPES.map((t, i) => arbMockupElement(t, NO_TOKENS, { v2: false, force: true, id: `p1-${i}` }))))
    .map(([base, shown]) => {
      const stripped = stripV2(base);
      return { ...stripped, elements: [...stripped.elements, ...shown], schemaVersion: 1 };
    });
}

/** Document that uses at least one Schema_V2_Feature, so Schema_Version 2 is the lowest representable. */
export function arbSchemaV2Document(maxBase = 15): fc.Arbitrary<BoardDocument> {
  const feature = fc.oneof(
    arbTokenCollection().map((tokens) => ({ tokens, extra: [] as Element[] })),
    arbElement('icon', 'v2-icon').map((icon) => ({ tokens: undefined, extra: [icon] })),
    arbLayoutTree({ prefix: 'v2-lt-' }).map((extra) => ({ tokens: undefined, extra })),
    arbComponentNesting({ prefix: 'v2-cn-' }).map((extra) => ({ tokens: undefined, extra })),
  );
  return fc.tuple(arbBoardDocument(maxBase), feature).map(([base, f]) => withElements(base, f.extra, f.tokens));
}

/** Document whose elements include a Frame nesting chain at least `minDepth` (default 3) deep. */
export function arbNestedFrameDocument(minDepth = 3): fc.Arbitrary<BoardDocument> {
  return fc.tuple(arbBoardDocument(10), arbNestedFrames({ minDepth })).map(([b, e]) => withElements(b, e));
}

/** Document with a component nesting chain at least `minDepth` (default 3) deep, plus overrides. */
export function arbComponentNestingDocument(minDepth = 3): fc.Arbitrary<BoardDocument> {
  return fc.tuple(arbBoardDocument(10), arbComponentNesting({ minDepth })).map(([b, e]) => withElements(b, e));
}

/** Document containing a component cycle (length 1 to 3). Rejected by the Sync_Pass. */
export function arbComponentCycleDocument(): fc.Arbitrary<BoardDocument> {
  return fc.tuple(arbBoardDocument(10), arbComponentCycle()).map(([b, e]) => withElements(b, e));
}

/** Document containing a Layout_Frame tree with mixed sizing. */
export function arbLayoutTreeDocument(): fc.Arbitrary<BoardDocument> {
  return arbTokenCollection(true).chain((tokens) =>
    fc.tuple(arbBoardDocument(10), arbLayoutTree({ names: tokenNamesOf(tokens) })).map(([b, e]) => withElements(b, e, tokens)),
  );
}
