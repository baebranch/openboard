import type { BoardDocument, ElementType, ExtraBag } from '../model/types';
import { documentFields, fieldsFor } from '../model/mockup-fields';
import { CURRENT_SCHEMA_VERSION } from '../model/ranges';
import { newId } from '../model/ids';
import { defaultMigrationRegistry, type MigrationRegistry, type RawDoc } from './migrations';

/** Compiled Ajv validator shape (dist/validators.js `validateBoard`). */
export interface BoardValidator {
  (data: unknown): boolean;
  errors?: ReadonlyArray<{ instancePath: string; keyword?: string; message?: string; params?: Record<string, unknown> }> | null;
}

export type ParseResult =
  | { ok: true; doc: BoardDocument; readOnly: boolean; migratedFrom?: number; rawText?: string }
  | { ok: false; kind: 'json'; line: number; column: number; message: string }
  | { ok: false; kind: 'schema'; path: string; message: string };

export interface ParseOptions {
  /** Validator to use; defaults to the one registered with `setBoardValidator`. */
  validator?: BoardValidator;
  migrations?: MigrationRegistry;
}

let registeredValidator: BoardValidator | undefined;

/**
 * Registers the compiled board validator (the host loads dist/validators.js and passes it in,
 * keeping core free of file system access). Pass `undefined` to clear.
 */
export function setBoardValidator(v: BoardValidator | undefined): void {
  registeredValidator = v;
}

/** An empty Board_Document (used for zero-byte files, Req 11.12). */
export function createEmptyDocument(): BoardDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { id: newId() },
    viewport: { x: 0, y: 0, zoom: 1 },
    elements: [],
    assets: [],
    library: [],
  };
}

/**
 * Offset of the first character that cannot extend a valid JSON prefix (text length when the text
 * ends early), or null if valid. Used when the engine message carries no position
 * (e.g. "Unexpected token 'x', ... is not valid JSON").
 */
function scanJsonFailure(s: string): number | null {
  let i = 0;
  const fail = (at: number): never => {
    throw at;
  };
  const ws = () => {
    while (i < s.length && ' \t\n\r'.includes(s[i]!)) i++;
  };
  const digits = () => {
    const start = i;
    while (i < s.length && s[i]! >= '0' && s[i]! <= '9') i++;
    if (i === start) fail(i);
  };
  const word = (w: string) => {
    for (const ch of w) {
      if (s[i] !== ch) fail(i);
      i++;
    }
  };
  const str = () => {
    i++;
    for (;;) {
      const c = s[i];
      if (c === undefined) fail(i);
      else if (c === '"') {
        i++;
        return;
      } else if (c.charCodeAt(0) < 0x20) fail(i);
      else if (c === '\\') {
        i++;
        const e = s[i];
        if (e === undefined || !'"\\/bfnrtu'.includes(e)) fail(i);
        i++;
        if (e === 'u') {
          for (let k = 0; k < 4; k++) {
            if (!/[0-9a-fA-F]/.test(s[i] ?? '')) fail(i);
            i++;
          }
        }
      } else i++;
    }
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      ws();
      if (s[i] === close) {
        i++;
        return;
      }
      for (;;) {
        if (c === '{') {
          ws();
          if (s[i] !== '"') fail(i);
          str();
          ws();
          if (s[i] !== ':') fail(i);
          i++;
        }
        value();
        ws();
        if (s[i] === ',') i++;
        else if (s[i] === close) {
          i++;
          return;
        } else fail(i);
      }
    } else if (c === '"') str();
    else if (c === 't') word('true');
    else if (c === 'f') word('false');
    else if (c === 'n') word('null');
    else if (c !== undefined && (c === '-' || (c >= '0' && c <= '9'))) {
      if (c === '-') i++;
      if (s[i] === '0') i++;
      else digits();
      if (s[i] === '.') {
        i++;
        digits();
      }
      if (s[i] === 'e' || s[i] === 'E') {
        i++;
        if (s[i] === '+' || s[i] === '-') i++;
        digits();
      }
    } else fail(i);
  };
  try {
    value();
    ws();
    return i < s.length ? i : null;
  } catch (e) {
    if (typeof e === 'number') return e;
    throw e;
  }
}

/** Converts a JSON.parse failure message into 1-based line and column (Req 11.7). */
export function jsonErrorPosition(text: string, message: string): { line: number; column: number } {
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) };
  const pm = /position (\d+)/.exec(message);
  let pos = pm ? Number(pm[1]) : (scanJsonFailure(text) ?? text.length);
  if (pos > text.length) pos = text.length;
  let line = 1;
  let column = 1;
  for (let i = 0; i < pos; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      line++;
      column = 1;
    } else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      line++;
      column = 1;
    } else column++;
  }
  return { line, column };
}

// ---- Unknown property preservation (Req 11.11) ----

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Moves properties not in `known` into `extra`; maps known children through `children`. */
function split(raw: Obj, known: readonly string[], children: Record<string, (v: unknown) => unknown> = {}): Obj {
  const out: Obj = {};
  const extra: ExtraBag = {};
  let hasExtra = false;
  for (const k of Object.keys(raw)) {
    if (known.includes(k)) {
      const f = children[k];
      out[k] = f ? f(raw[k]) : raw[k];
    } else {
      extra[k] = raw[k];
      hasExtra = true;
    }
  }
  if (hasExtra) out['extra'] = extra;
  return out;
}

const list = (f: (v: unknown) => unknown) => (v: unknown) => (Array.isArray(v) ? v.map(f) : v);
const obj = (known: readonly string[], children?: Record<string, (v: unknown) => unknown>) => (v: unknown) =>
  isObj(v) ? split(v, known, children) : v;

const STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'strokeStyle', 'opacity', 'cornerRadius', ...fieldsFor('style')];
const BASE_KEYS = [
  'id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'parentId', 'locked', 'groupId', 'style',
  ...fieldsFor('base'),
];
const TEXT_KEYS = ['runs', 'fontFamily', 'fontSize', 'align'];
const TYPE_KEYS: Record<string, string[]> = {
  freehand: ['points', 'baseWidth'],
  text: TEXT_KEYS,
  sticky: TEXT_KEYS,
  image: ['assetId', 'crop', 'alt'],
  frame: ['name', 'preset'],
  flowNode: [...TEXT_KEYS, 'preset'],
  edge: ['sourceId', 'targetId', 'routing', 'sourceArrow', 'targetArrow', 'label'],
};

const runs = list(obj(['text', 'bold', 'italic', 'underline']));
const points = list(obj(['x', 'y', 'p']));

function element(v: unknown): unknown {
  if (!isObj(v)) return v;
  const type = typeof v['type'] === 'string' ? v['type'] : '';
  const known = [...BASE_KEYS, ...(TYPE_KEYS[type] ?? []), ...fieldsFor('type', type as ElementType)];
  return split(v, known, {
    style: obj(STYLE_KEYS),
    runs,
    points,
    crop: obj(['x', 'y', 'w', 'h']),
  });
}

const elements = list(element);

/** Splits unknown properties into `extra` bags at every level of a validated raw document. */
export function attachExtras(raw: RawDoc): BoardDocument {
  const rootKeys = ['schemaVersion', 'meta', 'viewport', 'elements', 'assets', 'library', 'settings', ...documentFields()];
  const out = split(raw, rootKeys, {
    tokens: obj(['colors', 'fonts', 'numbers']),
    meta: obj(['id', 'title', 'createdAt', 'modifiedAt', 'generator']),
    viewport: obj(['x', 'y', 'zoom']),
    elements,
    assets: list(obj(['id', 'mime', 'hash', 'width', 'height', 'data'])),
    library: list(
      obj(['id', 'name', 'elements', 'builtin', 'tokens'], {
        elements,
        tokens: obj(['colors', 'fonts', 'numbers']),
      }),
    ),
    settings: obj(['grid', 'minimap', 'activeMode'], { grid: obj(['enabled', 'spacing']) }),
  });
  return out as unknown as BoardDocument;
}

// ---- Validation ----

function schemaError(validate: BoardValidator, fallbackPath: string): { path: string; message: string } {
  const e = validate.errors?.[0];
  if (!e) return { path: fallbackPath, message: 'Invalid board file' };
  let path = e.instancePath ?? '';
  if (e.keyword === 'required' && typeof e.params?.['missingProperty'] === 'string') {
    path += '/' + String(e.params['missingProperty']).replace(/~/g, '~0').replace(/\//g, '~1');
  }
  return { path: path === '' ? '/' : path, message: e.message ?? 'Invalid board file' };
}

/** Parses Board_File text (Req 11.5, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12). */
export function parse(text: string, options: ParseOptions = {}): ParseResult {
  if (text.replace(/^\uFEFF/, '').trim() === '') return { ok: true, doc: createEmptyDocument(), readOnly: false };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, kind: 'json', ...jsonErrorPosition(text, message), message };
  }

  const validate = options.validator ?? registeredValidator;
  if (!validate) throw new Error('No board validator registered; call setBoardValidator() first');

  if (!isObj(raw)) {
    validate(raw);
    return { ok: false, kind: 'schema', ...schemaError(validate, '/') };
  }

  const registry = options.migrations ?? defaultMigrationRegistry;
  const m = registry.migrate(raw, CURRENT_SCHEMA_VERSION);
  if (!m.ok) {
    if (m.reason === 'newer') {
      // Opened read-only with the raw text retained for display (Req 11.10).
      const lenient = validate(raw) ? attachExtras(raw) : createEmptyDocument();
      return { ok: true, doc: lenient, readOnly: true, rawText: text };
    }
    if (m.reason === 'invalid-version') {
      validate(raw);
      return { ok: false, kind: 'schema', ...schemaError(validate, '/schemaVersion') };
    }
    return { ok: false, kind: 'schema', path: '/schemaVersion', message: `No migration from schema version ${String(m.version)}` };
  }

  if (!validate(m.doc)) return { ok: false, kind: 'schema', ...schemaError(validate, '/') };
  const doc = attachExtras(m.doc);
  return m.applied > 0 ? { ok: true, doc, readOnly: false, migratedFrom: m.fromVersion } : { ok: true, doc, readOnly: false };
}
