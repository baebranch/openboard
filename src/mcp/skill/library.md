# Component library

Each board has a library of reusable components. Built-ins (always available): button, input field, card, navigation bar, device outline. Components saved in the board are listed after them.

- `library.list` / `ob.board().library()`: the available components with their ids and names.
- `library.insert` `{ component, x?, y? }` / `ob.board().insertComponent(idOrName, { x, y })`: inserts a copy with new element ids; `x`,`y` place its top-left corner. The result lists the new ids.
- `library.save` `{ name, ids? }`: saves elements (default: the current selection) as a component named 1 to 100 characters. Edges are kept only when both ends are included.
- `import` with `source: "component"` is another way to insert one.

Inserted elements are ordinary elements: update, connect, or delete them afterwards.
