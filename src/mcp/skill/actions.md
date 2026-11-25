# Actions (`openboard_call`)

`openboard_call` runs one action: `{ "action": "element.create", "input": { ... }, "workspace": "..." }`. `input` is the action's JSON object below. Add `board` (path) to target a specific board; the default is the active board. Errors come back as `{ error: { code, message, issues?, hint? } }`; fix the input and retry. The same actions are available in code mode as `ob.call(action, input)`.

Types: `T?` is optional; `a | b` is a choice; `/* n..m */` is the allowed range or length.

<!-- generated -->
