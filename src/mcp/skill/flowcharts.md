# Flowcharts

## From Mermaid (fastest)

`import` with `source: "mermaid"` parses a flowchart and lays it out automatically; `ob.board().importMermaid(text)` does the same.

```
flowchart TD
  start([Start]) --> check{Valid?}
  check -- yes --> save[(Save)]
  check -- no --> fail[Show error]
```

Supported: `graph` / `flowchart` with `TD`, `TB`, `BT`, `LR`, `RL`; node shapes `[box]`, `(rounded)`, `([pill])`, `{decision}`, `[(database)]`, `[[document]]`, `[/input-output/]`, `>annotation]`; links `-->`, `---`, `-.->`, `==>` with labels (`-- text -->` or `-->|text|`). `style`, `classDef`, `class`, `linkStyle` and `click` lines are ignored. A syntax error returns an error with the line number and creates nothing. The call returns the created `ids`.

## By hand

Create `flowNode` elements with a `preset` (startEnd, process, decision, inputOutput, database, document, annotation) and `text`, then `connect` them. Edges default to straight lines with a target arrowhead; use `routing: "orthogonal"` for boxes-and-lines look. A decision node with labelled edges ("yes"/"no") reads best.

```js
const ids = await ob.board().create([
  { id: "s", type: "flowNode", preset: "startEnd", text: "Start" },
  { id: "d", type: "flowNode", preset: "decision", text: "OK?" },
  { id: "e", type: "flowNode", preset: "startEnd", text: "End" },
]);
await ob.board().connect([
  { sourceId: "s", targetId: "d" },
  { sourceId: "d", targetId: "e", label: "yes" },
]);
await ob.board().layout({ direction: "LR" });
```

## Auto layout

`layout` (`ob.board().layout(opts)`) arranges flow nodes in layers. `direction`: `TB` (default), `BT`, `LR`, `RL`. `ids` restricts it to some nodes; without it every flow node on the board is laid out. Needs at least two flow nodes. Layout moves nodes only; edges follow. It is one undo step.

Creating a node while connecting: `connect` with `toPosition: { x, y }` instead of `targetId` creates a new process node centred there.
