# Elements

Every element has `id`, `type`, a box (`x`, `y`, `width`, `height`, `rotation`) and a style. Omitted properties take defaults when you create elements (box 100x100 at 0,0; default fill/stroke from the theme).

## Style

Style properties may be given flat on the element (`{ type: "rectangle", fill: "#ffcc00" }`) and, on create, also inside `style: { ... }`. In `update` / `ob.board().update(ids, set)` use flat names only.

- `fill`, `stroke`: `#rgb`, `#rrggbb`, `#rrggbbaa`, or `theme:default` (follows the IDE theme).
- `strokeWidth` (number), `strokeStyle` (`solid` | `dashed` | `dotted`), `opacity` (0 to 100), `cornerRadius` (>= 0, bounded by half the smaller side).
- `cornerRadii`: optional per-corner radii `[topLeft, topRight, bottomRight, bottomLeft]`, four numbers each >= 0 and at most half the smaller side. Valid on `rectangle`, `frame`, `sticky`, `flowNode` and `image`. When present it overrides `cornerRadius`; each corner is independent and a `0` corner is square.

  Example, a card with only the top corners rounded:

  ```json
  { "type": "rectangle", "width": 200, "height": 120, "cornerRadii": [16, 16, 0, 0] }
  ```

- `imageFill`: optional `{ assetId, fit }` painting an image over the fill, clipped to the exact outline (including `cornerRadii` and the ellipse). `fit` is `"cover"` (fill the box, crop the overflow), `"contain"` (whole image visible, may letterbox) or `"stretch"` (distort to the box). Valid on `rectangle`, `ellipse`, `diamond`, `frame`, `sticky` and `flowNode`. Set `imageFill: null` in an update to remove it. If the asset is missing or cannot be decoded, the flat `fill` shows instead; a dangling `assetId` is valid. The asset is stored once and kept while any element, Library entry or `imageFill` references it.

  The easiest way to set one is `import` with `source: "image"` and `fillIds`: it stores the image and sets `imageFill` with fit `"cover"` on those existing elements instead of creating an image element. Every id must exist and support `imageFill`, otherwise nothing is applied. Change `fit` afterwards with an update.

  ```json
  { "source": "image", "data": "<base64>", "fillIds": ["<elementId>"] }
  ```

  ```json
  { "imageFill": { "assetId": "<assetId>", "fit": "contain" } }
  ```

## Layout and sizing

A `frame` may carry `layout`, which turns it into a Layout_Frame that arranges its direct children in a stack. `layout` must be given complete (every key is required, unknown keys are rejected); `layout: null` in an update removes it and leaves the children where they are.

- `direction`: `"horizontal"` or `"vertical"`.
- `gap`: space between children, a number from 0 to 1000, or `"token:<name>"` for a `numbers` token.
- `padding`: `{ top, right, bottom, left }`, each a number from 0 to 1000 or `"token:<name>"`.
- `mainAlign`: `"start"` | `"center"` | `"end"` | `"spaceBetween"` (along the stack direction).
- `crossAlign`: `"start"` | `"center"` | `"end"` (across it).

Defaults used by the editor when enabling layout: horizontal, gap 0, padding 0 on every side, `start` and `start`.

Any element can carry `sizing: { width, height }` (both keys required), each one of:

- `fixed`: the stored `width`/`height` is kept (the default when `sizing` is absent).
- `hug`: the size follows the content. A Layout_Frame hugs its children plus padding; `text`, `sticky` and `flowNode` hug their text.
- `fill`: inside a Layout_Frame, take the available space. On the main axis the leftover space is shared evenly between `fill` children (each at least 1); on the cross axis the child takes the full inner size. A `fill` axis whose parent is not a Layout_Frame behaves as `fixed`, and a `fill` child on the same axis as a `hug` parent behaves as `hug`; the stored value is not changed.

`ignoreLayout: true` on a child of a Layout_Frame leaves it out of the stack: it keeps its own `x`/`y` and does not count toward the gap or size of its siblings. Set `null` to remove either `sizing` or `ignoreLayout`.

Children are ordered along the main axis by their current position, so to reorder them move them (or change `x`/`y`) and the layout re-flows. Rotation is ignored when arranging.

Position, `width` and `height` of arranged children (and of `hug` / `fill` axes) are derived: the layout overwrites them after every edit, so setting them by hand on such an axis has no lasting effect. Change `layout`, `sizing` or the content instead. `layout.gap` and each `layout.padding` side may be `"token:<name>"` for a `numbers` token; `sizing` takes no tokens.

  ```json
  { "type": "frame", "name": "Card", "width": 240, "height": 100,
    "layout": { "direction": "vertical", "gap": 8, "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 }, "mainAlign": "start", "crossAlign": "start" },
    "sizing": { "width": "fixed", "height": "hug" } }
  ```

  Children are ordinary elements with `parentId` set to the frame, for example a title with `sizing: { "width": "fill", "height": "hug" }` and a badge with `ignoreLayout: true`.

## Text

`text`, `sticky` and `flowNode` hold rich text in `runs: [{ text, bold?, italic?, underline? }]`. As a shortcut pass `text: "Hello"` on create or update (replaces all runs). Also `fontFamily`, `fontSize`, `align`.

`fontWeight` (integer 100 to 900 in steps of 100) and `textColor` (`"theme:default"` or a hex color, the same forms as `style.fill`) apply to `text`, `sticky` and `flowNode`. `textColor: "theme:default"` follows the active theme; an explicit hex color is not remapped on theme change.

`textWrap` (`"none"` | `"wrap"`, default `"none"`) applies to `text`, `sticky` and `flowNode`. With `"wrap"`, text breaks at whitespace to fit the element width minus the text padding; a word longer than the line is broken between characters. Explicit newlines always break. Wrapped lines are never clipped, so they can extend below the element bottom: size the element yourself if you need them inside. With `"none"` or omitted, only explicit newlines break lines.

  ```json
  { "type": "sticky", "width": 160, "height": 120, "text": "A long note that wraps inside the sticky", "textWrap": "wrap" }
  ```

### Text_Measurer

`measure({ text, fontFamily, fontSize, fontWeight?, availableWidth })` in `src/core/text` returns `{ ok: true, value: { lines, widestLine, height } }` or `{ ok: false, error }`. It is pure and deterministic: it uses a built-in glyph-width table for printable ASCII (1.0em for other characters), not real font metrics, so results are identical in every bundle and in code mode and are an estimate of rendered width. Line height is 1.2 times `fontSize`. `fontSize` must be a finite number above 0 and `availableWidth` finite or `Infinity` (no wrapping); otherwise it returns an error. A width narrower than one character yields one character per line. Use it to size an element to its wrapped text before creating it.

## Notes per type

- `rectangle`, `ellipse`, `diamond`, `line`, `arrow`: plain shapes.
- `freehand`: a stroke; `points` are relative to x,y; `p` is pressure 0 to 1.
- `text`: free text without a background. `sticky`: coloured note.
- `image`: references an `assetId` stored in the board; import pictures with `import` (`source: "image"`), do not create them by hand.
- `frame`: `name` and optional `preset`; children point to it with `parentId`. Optional `clipContent` (boolean, default `false`) clips descendants to the frame bounds when `true`; descendants of nested clipping frames are clipped to the intersection of all of them. Edges are never clipped, and pointer hits on a clipped-away part of a descendant fall through to what lies beneath. Applies to `frame` only.
- Component master: a `frame` with `component` (the master name). Create one with `component.create`. Never set `component` or `instanceOf` by hand.
- Component instance: a `frame` with `instanceOf` (the master id). Its children are derived from the master with ids `<instanceId>::<masterChildId>` and follow master edits; do not edit their geometry directly. Per-property differences are stored in the instance `overrides`.
- `icon`: a vector glyph from the built-in icon set (a curated Lucide subset), drawn from `name` (1 to 64 characters, for example `"search"`). It defaults to 24x24 with stroke width 2 and uses the element stroke color and width. Find names with the `openboard.icon.search` tool (`{ keyword }`, case-insensitive over names and keywords, at most 50 names, alphabetical; it needs no board). A `name` outside the set is still valid and kept as written, but it renders a placeholder glyph instead of failing. In an instance, override the icon with the `icon` override key (it changes only that instance's child `name`).

  ```json
  { "type": "icon", "name": "search", "x": 40, "y": 40 }
  ```

- `flowNode`: a flowchart box. `preset` picks the shape: startEnd (pill), process, decision (diamond), inputOutput (parallelogram), database, document, annotation.
- `edge`: `sourceId`, `targetId`, `routing`, arrowheads, `label` (max 200 chars). Prefer `connect` over creating edges by hand; edges cannot connect to edges.

Some properties are validated against ranges; a bad value fails the whole call and nothing changes. Unknown properties for a type are rejected with `unknown_property`.

<!-- generated -->
