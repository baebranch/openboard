# OpenBoard overview

OpenBoard is an infinite-canvas whiteboard inside the IDE. Boards are `.openboard` JSON files; an open board has a live in-memory model that the editor shows and that tools edit.

## Concepts

- **Board**: one file. Tools take an optional `board` (absolute path, or a path relative to the workspace folder). Without it they act on the **active board** (the focused editor tab). Use `ob.boards()` / action `board.list` to see open boards, `board.open` / `board.create` to open or create one.
- **Element**: everything on a board. Types: rectangle, ellipse, diamond, line, arrow, freehand, text, image, frame, sticky, flowNode, edge, icon. See topic `elements`.
- **Ids**: every element has a string `id`. Give your own ids when you create elements (`{ id: "start", type: "flowNode" }`) so later calls can refer to them; otherwise ids are generated and returned by create.
- **Coordinates**: board units, x to the right, y down, origin anywhere. Positions are the top-left corner of the element's box. Rotation is degrees.
- **Z-order**: elements are stored back to front; later elements draw on top. New elements go on top. Change with `arrange` (`zorder`: front, back, forward, backward).
- **Frames**: a `frame` is a labelled container. An element whose `parentId` is a frame belongs to it and is exported with it. Deleting a frame detaches its children.
- **Edges**: an `edge` connects two non-edge elements (`sourceId`, `targetId`) and follows them when they move. Deleting an element deletes its edges.
- **Groups**: elements sharing a `groupId` select and move together (`arrange` with `group` / `ungroup`).
- **Undo**: every edit is undoable by the user. One `openboard_execute` run is ONE undo step; every other action is one step each. Undo/redo actions exist (`undo`, `redo`) but are destructive; prefer fixing forward.
- **Saving**: edits live in memory (the editor shows an unsaved dot) until saved. Call `openboard_save` when done.
- **Workspace param (MCP)**: when several IDE windows are open, pass `workspace` (a `workspaceId` from `openboard_workspaces`) to every call. With one window it is optional.

## Mockup features (all optional)

Every mockup feature is an optional property; boards without them behave as before. Details are in topics `elements`, `editing` and `library`.

- **Text and corners**: `fontWeight` (100 to 900 in steps of 100), `textColor`, `textWrap` (`none` | `wrap`), per-corner `cornerRadii`. Example: `{ type: "rectangle", cornerRadii: [12, 12, 0, 0] }`.
- **Image fill**: `imageFill: { assetId, fit: "cover" | "contain" | "stretch" }` on rectangles, ellipses, diamonds, frames, stickies and flow nodes.
- **Clipping**: `clipContent: true` on a frame clips its descendants to its bounds.
- **Icons**: `{ type: "icon", name: "search" }`; find names with action `icon.search` `{ keyword }`.
- **Design tokens**: named colors, fonts and numbers, referenced as `"token:<name>"` (for example `fill: "token:brand"`). Manage with `token.create`, `token.update`, `token.rename`, `token.delete`, `token.list`, `token.detach` and `token.mode` `{ mode: "light" | "dark" | "auto" }`.
- **Auto layout**: a frame with `layout: { direction, gap, padding, mainAlign, crossAlign }` arranges its children; children take `sizing: { width, height }` (`fixed` | `hug` | `fill`) and `ignoreLayout`.
- **Components**: masters (`component.create`), instances (`component.instance.create`), per-instance overrides (`component.instance.override.set` / `.reset`) and `component.instance.detach`. Never set `component`, `instanceOf` or `overrides` by hand.
- **Derived geometry**: after every edit OpenBoard re-syncs instances from their masters and re-flows layouts, in the same undo step. The result carries `geometryChanges: { count, ids, truncated }`; re-read those ids with `element.query` instead of computing positions yourself.

## Tools

| Tool | Use |
| --- | --- |
| `openboard_workspaces` | list windows (and, in VS Code, open boards) |
| `openboard_read_skill` | this documentation |
| `openboard_execute` | JavaScript sandbox with the `ob` API; best for anything with more than one step |
| `openboard_call` | one registry action with a JSON input; see topic `actions` |
| `openboard_save` | save a board |

## Suggested workflow

1. `openboard_read_skill` with `code-mode` (or `actions` if you will not write code).
2. Look first: `ob.board().summary()` or `board.summary` for counts and bounds, `element.query` for details.
3. Edit with one `openboard_execute` run (all-or-nothing), reading back what you need.
4. Check the result visually with `board.preview` (returns a PNG) when layout matters.
5. `openboard_save`.
