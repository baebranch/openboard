# Code mode (`openboard_execute`)

Write the body of an async function. Use `await`, `return` a JSON-serializable value (that is the result) and `console.log` for notes (returned as `logs`). A global `ob` gives access to boards.

```js
const board = ob.board();                 // active board (or the `board` input)
const { counts } = await board.summary();
const ids = await board.create([{ type: "sticky", x: 0, y: 0, text: "Hello" }]);
return { counts, ids };
```

## Transactions

All edits made by one run are applied immediately (later reads see earlier writes) but are recorded as ONE undo entry per board when the code finishes. If the code throws (or times out) every edit is rolled back and the board is unchanged. If you catch an error yourself, the edits made so far are kept. `board.save()` commits pending edits first, so it splits the undo history; call it last or use `openboard_save` after the run.

## Errors

`ob` calls throw `OpenBoardError` with message `[code] message` (and validation issues). Catch to handle expected failures:

```js
try { await ob.board().update(["missing"], { x: 1 }); } catch (e) { console.warn(e.message); }
```

## Sandbox limits

- Plain JavaScript (ES2023) in a QuickJS WebAssembly sandbox. No `require`, `import`, `process`, `fetch`, file system, network, or timers (`setTimeout` does not exist; just `await` the `ob` calls).
- Wall-clock limit: `timeoutMs` (default 10000, max 60000). Memory limit 64 MB, call-stack limit 512 KB. Result limit about 512 KB, logs about 64 KB (extra output is cut). Violations stop the script, roll the edits back and return an error with a code: `timeout`, `memory`, `stack`, `result_too_large`.
- `ob` calls run one after another, in call order, even inside `Promise.all`.
- Keep results small: return counts, ids and short summaries, not whole boards.

## Reference

Declarations of everything available:

<!-- generated -->

## Examples

Grid of labelled boxes:

```js
const cols = 4;
const items = ["a", "b", "c", "d", "e", "f", "g", "h"].map((name, i) => ({
  id: name, type: "rectangle", text: name.toUpperCase(),
  x: (i % cols) * 180, y: Math.floor(i / cols) * 120, width: 140, height: 80, fill: "#e7f5ff",
}));
return await ob.board().create(items);
```

Recolour everything of one kind:

```js
const { items } = await ob.board().query({ type: "rectangle", limit: 500 });
await ob.board().update(items.map((e) => e.id), { fill: "#fff3bf" });
return items.length;
```

Flowchart from data, then layout:

```js
const steps = ["Plan", "Build", "Test", "Ship"];
await ob.board().create(steps.map((s, i) => ({ id: "s" + i, type: "flowNode", text: s })));
for (let i = 0; i < steps.length - 1; i++) await ob.board().connect("s" + i, "s" + (i + 1));
await ob.board().layout({ direction: "LR" });
```

Any action, including ones without a helper:

```js
const { items } = await ob.call("element.query", { type: "frame" });
await ob.call("viewport", { action: "zoomToFit" });
```

Tokens, an auto-layout stack and the derived geometry it reports:

```js
const b = ob.board();
await b.createToken({ category: "colors", name: "brand", value: "#1971c2" });
await b.createToken({ category: "numbers", name: "space", value: 12 });
await b.create([
  { id: "col", type: "frame", name: "Column", x: 0, y: 0, width: 200, height: 100,
    layout: { direction: "vertical", gap: "token:space", padding: { top: 8, right: 8, bottom: 8, left: 8 },
      mainAlign: "start", crossAlign: "start" },
    sizing: { width: "fixed", height: "hug" } },
  { id: "t", type: "text", parentId: "col", text: "Title", fontWeight: 700, textColor: "token:brand", textWrap: "wrap" },
  { id: "i", type: "icon", parentId: "col", name: (await b.searchIcons("search")).names[0] },
  { id: "r", type: "rectangle", parentId: "col", height: 40, cornerRadii: [8, 8, 0, 0], sizing: { width: "fill", height: "fixed" } },
]);
// Layout ran after the create; read the arranged geometry back (never compute it yourself).
const { items } = await b.query({ ids: ["col", "t", "i", "r"] });
return items.map((e) => [e.id, e.x, e.y, e.width, e.height]);
```

Components, instances, overrides and detach:

```js
const b = ob.board();
await b.createComponent({ ids: ["col"], name: "Column" });
const inst = await b.createInstance({ master: "col", x: 400, y: 0 });
await b.setOverride({ id: inst.id + "::t", property: "text", value: "Other" });
await b.resetOverride({ id: inst.id, childId: "t", property: "text" });
await b.detachInstance(inst.id);
await b.tokenMode("dark");
return await b.components();
```

Several boards in one run:

```js
const { boards } = await ob.boards();
return boards.map((b) => b.path);
const other = ob.board("/abs/path/other.openboard"); // opens it in the background when needed
```
