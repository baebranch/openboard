/**
 * Generates `src/core/icons/icon-set.ts`, the curated Lucide subset embedded in OpenBoard
 * (Req 23.2). The source is the `lucide-static` devDependency (exact-pinned); only this
 * generator reads it, so no Lucide package ships at runtime. The generated module is
 * committed and contains plain data only (no imports), so it is safe for the Extension Host,
 * webview and code-mode bundles alike.
 *
 * Each icon is flattened to a single SVG path `d` string on Lucide's 24x24 grid: `circle`,
 * `ellipse`, `rect`, `line`, `polyline` and `polygon` nodes are converted to equivalent path
 * commands so the renderer can draw every icon with one `<path>`.
 *
 * Usage:
 *   node scripts/gen-icon-set.mjs           write the module
 *   node scripts/gen-icon-set.mjs --check   exit 1 when the committed module is stale
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lucideDir = join(root, 'node_modules', 'lucide-static');
const outFile = join(root, 'src', 'core', 'icons', 'icon-set.ts');
const check = process.argv.includes('--check');

/**
 * Hand-maintained curated list of common UI glyphs (Lucide names). Keep it at 100 or more
 * icons and well under the 150 KB bundle budget. Order here does not matter; the output is
 * sorted by name.
 */
const CURATED_ICON_NAMES = [
  // Arrows and navigation
  'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'arrow-up-right',
  'chevron-up', 'chevron-down', 'chevron-left', 'chevron-right', 'chevrons-left', 'chevrons-right',
  'corner-down-left', 'move', 'external-link', 'undo-2', 'redo-2', 'refresh-cw', 'rotate-ccw',
  // Actions
  'check', 'x', 'plus', 'minus', 'search', 'funnel', 'pencil', 'square-pen', 'trash', 'copy',
  'clipboard', 'download', 'upload', 'share-2', 'save', 'send', 'link', 'paperclip', 'scissors',
  'printer', 'log-in', 'log-out', 'power', 'zoom-in', 'zoom-out', 'maximize-2', 'minimize-2',
  'ellipsis', 'ellipsis-vertical', 'grip-vertical', 'menu', 'sliders-horizontal', 'settings', 'wrench',
  // Status and security
  'info', 'circle-exclamation-point', 'triangle-exclamation-point', 'circle-check', 'circle-x',
  'circle-question-mark', 'ban',
  'loader-circle', 'bell', 'bell-off', 'shield', 'shield-check', 'lock', 'lock-open', 'key-round',
  'eye', 'eye-off',
  // People
  'user', 'users', 'user-plus', 'circle-user',
  // Communication
  'mail', 'message-circle', 'message-square', 'phone', 'video', 'mic', 'mic-off', 'at-sign', 'inbox',
  // Media
  'play', 'pause', 'square', 'skip-back', 'skip-forward', 'volume-2', 'volume-x', 'list-music', 'image',
  'camera', 'film', 'headphones',
  // Files
  'file', 'file-text', 'folder', 'folder-open', 'archive', 'book-open', 'bookmark', 'tag',
  // Commerce
  'shopping-cart', 'shopping-bag', 'credit-card', 'wallet', 'dollar-sign', 'gift', 'package', 'truck',
  // Places, time and weather
  'house', 'map-pin', 'map', 'globe', 'compass', 'calendar', 'clock', 'sun', 'moon', 'cloud',
  // Devices and connectivity
  'smartphone', 'tablet', 'laptop', 'monitor', 'wifi', 'wifi-off', 'bluetooth', 'battery', 'database',
  'server',
  // Layout and data
  'layout-dashboard', 'layout-grid', 'list', 'table', 'panel-left', 'chart-column', 'chart-line',
  'chart-pie', 'trending-up', 'trending-down', 'activity', 'layers',
  // Text formatting
  'italic', 'underline', 'text-align-start', 'text-align-center', 'text-align-end', 'type',
  // Misc
  'heart', 'star', 'thumbs-up', 'thumbs-down', 'flag', 'triangle', 'award', 'zap', 'sparkles',
  'lightbulb', 'rocket', 'target', 'code', 'terminal', 'qr-code', 'hash', 'circle', 'toggle-left',
  'toggle-right',
];

/** Keyword cap per icon, to keep the bundle small while keeping search useful. */
const MAX_KEYWORDS = 12;

/** Generic "missing glyph": a rounded square with a question mark (24x24 grid). */
const PLACEHOLDER_ICON_PATH =
  'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' +
  'M9.1 9a3 3 0 0 1 5.8 1c0 2-2.9 3-2.9 3M12 17h.01';

const num = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`non-numeric attribute value: ${v}`);
  return String(Math.round(n * 1000) / 1000);
};
const attr = (a, k, d = 0) => (a[k] === undefined ? d : Number(a[k]));

const NUMBER = /^[\s,]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;

/**
 * Makes a path's leading moveto absolute so the path can be appended to another one. A path
 * that starts with a relative `m` treats its first pair as absolute and any further implicit
 * pairs as relative `l`; once concatenated, that `m` would become relative to the previous
 * path's end point, so it is rewritten as `M x y` followed by an explicit `l`.
 */
function absolutizeStart(d) {
  const s = String(d).trim();
  if (!s.startsWith('m')) return s;
  let rest = s.slice(1);
  const coords = [];
  for (let i = 0; i < 2; i++) {
    const m = NUMBER.exec(rest);
    if (!m) throw new Error(`bad moveto in path: ${s}`);
    coords.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  rest = rest.replace(/^[\s,]+/, '');
  const implicit = rest.length > 0 && !/^[A-Za-z]/.test(rest);
  return `M${coords[0]} ${coords[1]}${implicit ? 'l' : ''}${rest}`;
}

/** Converts one Lucide icon node to path data. */
function nodeToPath([tag, a]) {
  switch (tag) {
    case 'path':
      return absolutizeStart(a.d);
    case 'circle':
    case 'ellipse': {
      const cx = attr(a, 'cx');
      const cy = attr(a, 'cy');
      const rx = tag === 'circle' ? attr(a, 'r') : attr(a, 'rx');
      const ry = tag === 'circle' ? attr(a, 'r') : attr(a, 'ry');
      return (
        `M${num(cx - rx)} ${num(cy)}` +
        `a${num(rx)} ${num(ry)} 0 1 0 ${num(2 * rx)} 0` +
        `a${num(rx)} ${num(ry)} 0 1 0 ${num(-2 * rx)} 0z`
      );
    }
    case 'rect': {
      const x = attr(a, 'x');
      const y = attr(a, 'y');
      const w = attr(a, 'width');
      const h = attr(a, 'height');
      let rx = a.rx !== undefined ? Number(a.rx) : a.ry !== undefined ? Number(a.ry) : 0;
      let ry = a.ry !== undefined ? Number(a.ry) : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}z`;
      const arc = (dx, dy) => `a${num(rx)} ${num(ry)} 0 0 1 ${num(dx)} ${num(dy)}`;
      return (
        `M${num(x + rx)} ${num(y)}h${num(w - 2 * rx)}${arc(rx, ry)}` +
        `v${num(h - 2 * ry)}${arc(-rx, ry)}` +
        `h${num(-(w - 2 * rx))}${arc(-rx, -ry)}` +
        `v${num(-(h - 2 * ry))}${arc(rx, -ry)}z`
      );
    }
    case 'line':
      return `M${num(attr(a, 'x1'))} ${num(attr(a, 'y1'))}L${num(attr(a, 'x2'))} ${num(attr(a, 'y2'))}`;
    case 'polyline':
    case 'polygon': {
      const pts = String(a.points).trim().split(/[\s,]+/).map(num);
      if (pts.length < 4 || pts.length % 2 !== 0) throw new Error(`bad points: ${a.points}`);
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return tag === 'polygon' ? `${d}z` : d;
    }
    default:
      throw new Error(`unsupported icon node <${tag}>`);
  }
}

const nodes = JSON.parse(await readFile(join(lucideDir, 'icon-nodes.json'), 'utf8'));
const tags = JSON.parse(await readFile(join(lucideDir, 'tags.json'), 'utf8'));
const { version } = JSON.parse(await readFile(join(lucideDir, 'package.json'), 'utf8'));

const names = [...new Set(CURATED_ICON_NAMES)].sort();
if (names.length !== CURATED_ICON_NAMES.length) throw new Error('duplicate names in CURATED_ICON_NAMES');
const missing = names.filter((n) => !Array.isArray(nodes[n]));
if (missing.length) throw new Error(`icons not found in lucide-static ${version}: ${missing.join(', ')}`);
if (names.length < 100) throw new Error(`Icon_Set needs at least 100 icons, got ${names.length}`);

const paths = {};
const keywords = {};
for (const name of names) {
  paths[name] = nodes[name].map(nodeToPath).join('');
  const kw = [...new Set((tags[name] ?? []).map((t) => String(t).toLowerCase().trim()))]
    .filter((t) => /[a-z0-9]/.test(t) && t !== name)
    .slice(0, MAX_KEYWORDS);
  keywords[name] = kw;
}

const license = (await readFile(join(lucideDir, 'LICENSE'), 'utf8')).trim();
const banner = [
  '/*! @license',
  ` * Icon path data derived from Lucide (lucide-static ${version}), https://lucide.dev`,
  ' *',
  ...license.split(/\r?\n/).map((l) => (l ? ` * ${l.replace(/\*\//g, '* /')}` : ' *')),
  ' */',
].join('\n');

const objectLiteral = (obj, fmt) =>
  `{\n${Object.keys(obj)
    .map((k) => `  ${JSON.stringify(k)}: ${fmt(obj[k])},`)
    .join('\n')}\n}`;

const out = `${banner}
// GENERATED by scripts/gen-icon-set.mjs from lucide-static ${version}. Do not edit by hand;
// edit CURATED_ICON_NAMES in the script and run \`npm run gen:icon-set\`.

/** Number of icons in the embedded Icon_Set. */
export const ICON_COUNT = ${names.length};

/** Icon name to SVG path data on a 24x24 grid, sorted by name. */
export const ICON_PATHS: Readonly<Record<string, string>> = ${objectLiteral(paths, (v) => JSON.stringify(v))};

/** Icon name to lower-case search keywords (from Lucide tags). */
export const ICON_KEYWORDS: Readonly<Record<string, readonly string[]>> = ${objectLiteral(keywords, (v) => JSON.stringify(v))};

/** Generic "missing glyph" outline drawn for an icon name outside the Icon_Set. */
export const PLACEHOLDER_ICON_PATH = ${JSON.stringify(PLACEHOLDER_ICON_PATH)};
`;

const docFile = join(root, 'docs', 'icon-list.md');
const doc = `# Icon list

GENERATED by \`scripts/gen-icon-set.mjs\` from lucide-static ${version}. Do not edit by hand;
edit \`CURATED_ICON_NAMES\` in the script and run \`npm run gen:icon-set\`.

The Icon_Set embeds ${names.length} icons from [Lucide](https://lucide.dev). Use these names for the
\`name\` of an \`icon\` element and with the icon search tool. Licenses are in
\`THIRD_PARTY_NOTICES.md\`.

${names.map((n) => `- \`${n}\``).join('\n')}
`;

const readOrEmpty = async (f) => {
  try {
    return (await readFile(f, 'utf8')).replace(/\r\n/g, '\n');
  } catch {
    return ''; // a missing file counts as stale
  }
};

if (check) {
  if ((await readOrEmpty(outFile)) !== out) {
    console.error('src/core/icons/icon-set.ts is stale; run `npm run gen:icon-set`.');
    process.exit(1);
  }
  if ((await readOrEmpty(docFile)) !== doc) {
    console.error('docs/icon-list.md is stale; run `npm run gen:icon-set`.');
    process.exit(1);
  }
  console.log(`icon-set.ts and docs/icon-list.md are up to date (${names.length} icons).`);
} else {
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, out);
  await mkdir(dirname(docFile), { recursive: true });
  await writeFile(docFile, doc);
  console.log(`Wrote ${outFile} (${names.length} icons, ${out.length} chars) and ${docFile}.`);
}
