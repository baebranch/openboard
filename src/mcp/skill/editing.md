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

## Nested Frames

A Frame may contain other Frames through `parentId`.

- `element.arrange` `{ action: "moveIntoFrame", ids, targetId }` makes the Frame `targetId` the parent of each selected element (Frames included), except elements whose ancestor is also selected; those move along with it.
- `element.arrange` `{ action: "moveOutOfFrame", ids }` gives each selected element its parent Frame's own parent, or no parent when that Frame is top level.
- `parentId` rules: the parent must be a Frame, an element cannot be its own ancestor (no cycles), and nesting is at most 16 levels deep. A violation rejects the whole call and changes nothing. The same rules apply when you set `parentId` on create or update. Creating an element inside a Frame adopts it only; existing Frames are not re-parented.
- Moving a Frame moves all its descendants with it.
- Deleting a Frame clears `parentId` on its direct children only. They stay where they are, and deeper descendants keep their parents.
- Export: scope `allFrames` writes one file per top-level Frame (one with no Frame parent), each including its nested content. Scope `frame` accepts any Frame, nested or not. Scope `frames` exports slides (see the `export` topic).
- Slides: every top-level Frame that is not a component master is a slide, numbered in reading order (rows top to bottom, then left to right). There is no separate slide data; arranging frames on the board orders the slides. Presentation mode in the editor shows them in that order.

## Components

A master is a Frame marked as a component; instances are Frames that mirror it.

| Goal | Action (`openboard_call`) |
| --- | --- |
| make a master | `component.create` `{ ids, name }` one Frame, or non-Frame elements that get wrapped in a new Frame; name 1 to 100 chars after trimming, unique |
| list masters | `component.list` sorted by name, with instance counts |
| remove a master | `component.remove` `{ id }` keeps the Frame as ordinary, detaches all its instances |
| insert an instance | `component.instance.create` `{ master, x?, y?, parentId? }` (a master may not contain itself or nest deeper than 8 levels) |
| override | `component.instance.override.set` `{ id, property, value }` where `id` is `<instanceId>::<masterChildId>`, or the instance itself for a root override |
| reset overrides | `component.instance.override.reset` `{ id, childId?, property? }` removes matching overrides; nothing matching changes nothing |
| detach | `component.instance.detach` `{ id }` turns the instance into ordinary elements |

Overridable properties of an instance child: `text`, `fill`, `stroke`, `textColor`, `fontWeight`, `imageFill`, `icon`, `opacity`, and `visible`. On the instance root: `width`, `height`, `fill`, `stroke`, `opacity`, `imageFill`; every other root style (corner radius, stroke width, ...) follows the master, and editing the master later updates every instance whose root has no override for that property.

`visible: false` hides a child and everything inside it, so one master can cover states such as a checkbox on/off, a selected chip or a sold-out ticket instead of one master per state. A hidden child keeps its space in auto layout. Reset the override (or set `visible: true`) to show it again:

```js
// openboard_execute
await ob.board().setOverride({ id: "inst", childId: "checkmark", property: "visible", value: false });
```

The `icon` override sets the `name` of an `icon` child (for example `value: "heart"`); the master and other instances keep their icon, and a name outside the icon set renders a placeholder. Everything else follows the master. Each call is one undo step; a rejected call changes nothing.

Derived geometry: editing a master (or its size) resyncs every instance, and auto layout also moves elements. These derived changes are not in your request, so the result of a tool call or `batch` carries `geometryChanges: { count, ids, truncated }` listing the ids whose geometry changed (sorted, at most 500; `truncated` is true beyond that). Re-read those ids with `element.query` before relying on their positions.

### Using layout and sizing

Layout is applied automatically after every edit, in the same undo step as the edit. To build a stack: create the `frame` with a full `layout` (see the `elements` topic), create the children with `parentId` set to it, optionally give them `sizing` (`fixed` | `hug` | `fill`) and `ignoreLayout`, then read `geometryChanges.ids` with `element.query` to get the arranged positions and sizes. Do not compute child positions yourself and do not write `x`, `y`, `width` or `height` on arranged children or on `hug` / `fill` axes: the layout overwrites them. Editing text, `gap`, `padding`, `sizing` or adding and removing children re-flows the stack and reports the moved ids the same way. Use `layout: null` to stop arranging (children stay put). `gap` and each `padding` side may be `"token:<name>"` to use a `numbers` token (see Design tokens); `sizing` takes no tokens.

## Design tokens

A board holds named design tokens in three categories: `colors`, `fonts`, `numbers`. Reference a color or font token from a color field (`fill`, `stroke`, ...) or `fontFamily` as `"token:<name>"`, and a number token from a Layout_Frame's `layout.gap` or a `layout.padding` side the same way; changing the token updates every user (and re-flows the layout) in one undo step. A number token used as spacing is clamped to 0 to 1000; a missing one counts as 0, and detaching writes that number. Number tokens are not accepted in `cornerRadius` or `fontSize`. Names are 1 to 64 characters from letters, digits, `-`, `_`, `.`. Values are literals (a color, a font family string, a number), never `token:` references. Exports contain resolved literals only; a missing token renders with the field default.

| Goal | Action (`openboard_call`) |
| --- | --- |
| create | `token.create` `{ category, name, value }` (duplicate or invalid name/value is rejected) |
| change value | `token.update` `{ category, name, value }` |
| rename | `token.rename` `{ category, name, newName }` rewrites every reference in elements, overrides and library entries |
| delete | `token.delete` `{ category, name }` rejected with the reference count while anything references it |
| list | `token.list` `{ category? }` returns values and reference counts |
| detach | `token.detach` `{ ids?, category?, name? }` replaces `token:` references with literals (all elements by default; `category` and `name` go together) |

Each call is one undo entry and a rejected call changes nothing. Library components record the tokens they reference; inserting one adds missing tokens and keeps existing values.

Token modes: a `colors` token value may be `{ light, dark }`, both literal colors (no `token:` references). Plain literals apply in every mode. `token.mode` `{ mode: "light" | "dark" | "auto" }` sets the board mode, stored in `settings.activeMode`; `auto` follows the IDE theme. Each call is one undo entry. Export accepts a `tokenMode` option (`light` | `dark` | `active`) choosing which mode's values are resolved; `active` uses the board's current mode.

```js
// openboard_execute
await ob.call("token.create", { category: "colors", name: "brand", value: "#1971c2" });
await ob.board().update(["a", "b"], { fill: "token:brand" });
await ob.call("token.update", { category: "colors", name: "brand", value: "#e8590c" });
```

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
