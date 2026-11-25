# Component library

Each board has a library of reusable components. Built-ins (always available): button, input field, card, navigation bar, checkbox, toggle, avatar, badge, phone, tablet, browser, device outline. Components saved in the board are listed after them.

- `library.list` / `ob.board().library()`: the available components with their ids and names.
- `library.insert` `{ component, x?, y? }` / `ob.board().insertComponent(idOrName, { x, y })`: inserts a copy with new element ids; `x`,`y` place its top-left corner. The result lists the new ids.
- `library.save` `{ name, ids? }`: saves elements (default: the current selection) as a component named 1 to 100 characters. Edges are kept only when both ends are included.
- `import` with `source: "component"` is another way to insert one.

Inserted elements are ordinary elements: update, connect, or delete them afterwards.

## Masters and tokens in the Library

- Saving a component master (a Frame with `component`) brings its whole subtree plus every master its instances depend on. The entry also records the values of the tokens it references.
- Inserting an entry saved from a master adds the missing masters (placed at least 100 units right of existing content; masters the board already has are shared, not duplicated) and the missing tokens (existing token values are kept), then one instance of the master at `x`,`y` or the viewport center. The inserted masters keep no link to the entry. The result lists the new ids.
- Other entries insert as plain copies; missing tokens are still added. Insertion is one undo step.

Example (code mode): save a master, then insert its entry on another board position.

```js
await ob.board().createComponent({ ids: ["col"], name: "Column" });
await ob.call("library.save", { name: "Column", ids: ["col"] });   // brings dependent masters and the tokens it references
const r = await ob.board().insertComponent("Column", { x: 600, y: 0 }); // adds missing masters/tokens, then one instance
return r;
```

Derived geometry: after an insert the instance is synced from its master and any layout is re-flowed in the same undo step; read `geometryChanges.ids` from the result with `element.query` rather than computing positions.

## Device frames

The built-in `phone`, `tablet` and `browser` are component masters, so inserting one adds a master (if the board lacks it) and one instance sized for the device:

- phone: 390 x 844
- tablet: 820 x 1180
- browser: 1440 x 900

Each master clips its content (`clipContent`) and has rounded corners (all four for phone and tablet, the top two for browser), so anything that sticks out past the device edge is cut off in the editor and in exports. Stored geometry is never changed by the clip. The status bar and toolbar glyphs are icons only.

To put your own content on a device, create elements inside the instance: drop them with `parentId` set to the instance id (for example `element.create` / `element.update` with `parentId`). They are stored as User_Children of the instance, are kept on every sync of the master, move with the instance, and are clipped to the device shape. Do not edit the master's own `<instance-id>::...` children; those are regenerated from the master.

Steps: call `library.insert` `{ component: "phone", x: 0, y: 0 }` (or `ob.board().insertComponent("phone", { x: 0, y: 0 })` in code mode), read the new instance id from the result, then create your elements with `parentId` set to that id. The device outline and the Frame size presets are unchanged and still available.

## Built-in UI kit

The built-in button, input field, card and navigation bar are component masters whose colors and fonts reference seeded tokens, so editing a token restyles every instance. Inserting one adds the tokens it needs and one instance. The device outline is a plain set of shapes. Use `library.list` for the exact ids and names.
