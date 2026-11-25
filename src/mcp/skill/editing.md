# Editing boards

| Goal | Action (`openboard_call`) | `ob` API (`openboard_execute`) |
| --- | --- | --- |
| add elements | `element.create` `{ elements: [...] }` | `board.create(elements)` returns ids |
| change properties | `element.update` `{ ids \| type \| filter, set }` | `board.update(ids, set)` |
| delete | `element.delete` `{ ids \| type \| filter }` | `board.remove(ids)` |
| find / read | `element.query` | `board.query(opts)`, `board.get(id)` |
| align, distribute, group, z-order, duplicate, copy/cut/paste, nudge | `element.arrange` `{ action, ids, ... }` | `board.arrange(action, opts)` |
| connect | `connect` `{ edges: [...] }` | `board.connect(a, b, opts)` or `board.connect([...])` |
| overview | `board.summary` | `board.summary()` |
| move the camera | `viewport` | `board.viewport(opts)` |

## Rules of thumb

- Selecting elements: by `ids`, by `type`, or by `filter` (exact match on properties, e.g. `{ fill: "#ff0000" }`); conditions combine (AND). A selection that matches nothing fails with `no_match`; unknown ids fail with `not_found`. At most 1000 elements per call.
- Calls are all-or-nothing: if any item is invalid nothing is applied.
- Positions: lay things out on a grid you compute (`x = col * 160`, `y = row * 100`) instead of adding elements at the origin. Leave about 40 units between boxes.
- Give meaningful `id`s when you will refer to elements afterwards.
- Style by flat properties: `update(ids, { fill: "#cce5ff", stroke: "#1971c2" })`.
- `arrange` with `align` needs 2+ ids, `distribute` 3+; if preconditions fail nothing changes and `changed` is false.
- Paging: `element.query` returns at most 500 items (default 100) plus `nextCursor` when there is more.
- Viewport changes are not undoable and never count as edits.
- Destructive actions (`element.delete`, `undo`, `redo`, `board.close`, arrange `cut`) may ask the user for confirmation in VS Code.

## Example

```js
// openboard_execute
const [a, b] = await ob.board().create([
  { id: "a", type: "rectangle", x: 0, y: 0, width: 140, height: 60, text: "Client" },
  { id: "b", type: "rectangle", x: 260, y: 0, width: 140, height: 60, text: "Server" },
]);
await ob.board().connect(a, b, { label: "HTTP", routing: "orthogonal" });
return { created: [a, b] };
```
