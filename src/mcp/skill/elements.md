# Elements

Every element has `id`, `type`, a box (`x`, `y`, `width`, `height`, `rotation`) and a style. Omitted properties take defaults when you create elements (box 100x100 at 0,0; default fill/stroke from the theme).

## Style

Style properties may be given flat on the element (`{ type: "rectangle", fill: "#ffcc00" }`) and, on create, also inside `style: { ... }`. In `update` / `ob.board().update(ids, set)` use flat names only.

- `fill`, `stroke`: `#rgb`, `#rrggbb`, `#rrggbbaa`, or `theme:default` (follows the IDE theme).
- `strokeWidth` (number), `strokeStyle` (`solid` | `dashed` | `dotted`), `opacity` (0 to 100), `cornerRadius` (>= 0, bounded by half the smaller side).

## Text

`text`, `sticky` and `flowNode` hold rich text in `runs: [{ text, bold?, italic?, underline? }]`. As a shortcut pass `text: "Hello"` on create or update (replaces all runs). Also `fontFamily`, `fontSize`, `align`.

## Notes per type

- `rectangle`, `ellipse`, `diamond`, `line`, `arrow`: plain shapes.
- `freehand`: a stroke; `points` are relative to x,y; `p` is pressure 0 to 1.
- `text`: free text without a background. `sticky`: coloured note.
- `image`: references an `assetId` stored in the board; import pictures with `import` (`source: "image"`), do not create them by hand.
- `frame`: `name` and optional `preset`; children point to it with `parentId`.
- `flowNode`: a flowchart box. `preset` picks the shape: startEnd (pill), process, decision (diamond), inputOutput (parallelogram), database, document, annotation.
- `edge`: `sourceId`, `targetId`, `routing`, arrowheads, `label` (max 200 chars). Prefer `connect` over creating edges by hand; edges cannot connect to edges.

Some properties are validated against ranges; a bad value fails the whole call and nothing changes. Unknown properties for a type are rejected with `unknown_property`.

<!-- generated -->
