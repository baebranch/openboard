# Actions (`openboard_call`)

`openboard_call` runs one action: `{ "action": "element.create", "input": { ... }, "workspace": "..." }`. `input` is the action's JSON object below. Add `board` (path) to target a specific board; the default is the active board. Errors come back as `{ error: { code, message, issues?, hint? } }`; fix the input and retry. The same actions are available in code mode as `ob.call(action, input)`.

Types: `T?` is optional; `a | b` is a choice; `/* n..m */` is the allowed range or length.

## Mockup examples

One sequence, each line one `openboard_call` (`action` plus `input`). Tokens first:

```json
{ "action": "token.create", "input": { "category": "colors", "name": "brand", "value": "#1971c2" } }
{ "action": "token.update", "input": { "category": "colors", "name": "brand", "value": "#e8590c" } }
{ "action": "token.rename", "input": { "category": "colors", "name": "brand", "newName": "primary" } }
{ "action": "token.list", "input": { "category": "colors" } }
{ "action": "token.mode", "input": { "mode": "dark" } }
{ "action": "icon.search", "input": { "keyword": "arrow" } }
```

A card using every Mockup field: a clipping Layout_Frame with rounded top corners, text styling, an icon, a `fill` child and one child left out of the stack:

```json
{ "action": "element.create", "input": { "elements": [
  { "id": "card", "type": "frame", "name": "Card", "x": 0, "y": 0, "width": 240, "height": 100,
    "cornerRadii": [16, 16, 0, 0], "clipContent": true,
    "layout": { "direction": "vertical", "gap": 12, "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 }, "mainAlign": "start", "crossAlign": "start" },
    "sizing": { "width": "fixed", "height": "hug" } },
  { "id": "title", "type": "text", "parentId": "card", "text": "Hello", "fontWeight": 700, "textColor": "token:primary", "textWrap": "wrap" },
  { "id": "ico", "type": "icon", "parentId": "card", "name": "arrow-right" },
  { "id": "hero", "type": "rectangle", "parentId": "card", "height": 80, "sizing": { "width": "fill", "height": "fixed" } },
  { "id": "badge", "type": "ellipse", "parentId": "card", "x": 200, "y": 8, "width": 24, "height": 24, "ignoreLayout": true }
] } }
{ "action": "element.update", "input": { "ids": ["hero"], "set": { "imageFill": { "assetId": "<assetId>", "fit": "cover" } } } }
```

Derived geometry: the layout (and any instance sync) runs after each edit, in the same undo step. The result lists `geometryChanges: { count, ids, truncated }`; call `element.query` with those ids to read the arranged positions instead of computing them.

Components, then cleanup:

```json
{ "action": "component.create", "input": { "ids": ["card"], "name": "Card" } }
{ "action": "component.list", "input": {} }
{ "action": "component.instance.create", "input": { "master": "card", "x": 400, "y": 0 } }
{ "action": "component.instance.override.set", "input": { "id": "<instanceId>::title", "property": "text", "value": "Other" } }
{ "action": "component.instance.override.reset", "input": { "id": "<instanceId>", "childId": "title", "property": "text" } }
{ "action": "component.instance.detach", "input": { "id": "<instanceId>" } }
{ "action": "component.remove", "input": { "id": "card" } }
{ "action": "token.detach", "input": { "category": "colors", "name": "primary" } }
{ "action": "token.delete", "input": { "category": "colors", "name": "primary" } }
```

<!-- generated -->
