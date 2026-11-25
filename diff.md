They're different kinds of tool. pen.dev is a UI design tool, roughly in the Figma category. OpenBoard is a whiteboard for diagrams that happens to be good enough to sketch screens on. That's why the WA flow moved over well but needed workarounds.

What's below comes from what I saw in `go.pen` and from OpenBoard's own docs, plus how both behaved during the migration. I didn't check pen.dev's pricing, features outside your file, or OpenBoard's roadmap.

| | pen.dev (`go.pen`) | OpenBoard |
|---|---|---|
| Main purpose | Designing app and web screens | Whiteboarding: flowcharts, diagrams, sticky notes |
| Layout | Auto layout: `layout: vertical`, `gap`, `padding`, `fill_container` sizing. Content reflows when text changes | Every element has a fixed absolute x/y. Nothing reflows |
| Text | Real weights (500/700), color via `fill`, text sizes to fit its container | Bold/italic/underline only, color via `stroke`. No wrapping, so line breaks are manual |
| Components | Reusable masters (`reusable: true`) and instances (`ref`) with per-instance overrides. Change the master and every copy updates | Library "components" are copy-paste templates. An inserted copy is ordinary elements with no link back, so changes don't spread |
| Design tokens | Variables like `$text-primary` | None. Hex colors only |
| Icons | Built-in Lucide icons, vector and recolorable | None. Only imported raster images |
| Images | Image fills on any shape (`fill: {type: "image", url}`) | Separate `image` element. Assets must be imported into the board |
| Shapes | Corner radius can differ per corner (`[16,16,0,0]`), plus strokes and layered frames | One radius for all corners |
| Flow/diagram tools | Not really. In `go.pen` the WA screens are just placed side by side, with no connectors | Connectors that follow when you move things, labels, orthogonal routing, flowchart shapes, Mermaid import, auto layout of flowcharts |
| Whiteboard extras | No | Sticky notes, freehand drawing |
| File format | JSON (v2.22). The MCP says it's encrypted, but this file was readable plain JSON | Plain JSON `.openboard` |
| AI/scripting access | MCP, needs the document open in the pen.dev app, and is now paid. It wouldn't connect for me today | MCP with a JS sandbox. One script run is one undo step and rolls back on error. Free and worked right away |
| Export | Not tested | PNG at 1–4× scale |

What this means for you:
- For mapping user journeys, how screens connect, and branch logic, OpenBoard is the better tool. Your WA board has arrows and outcomes that `go.pen` never had.
- For polished, high-fidelity mockups that will change often, OpenBoard costs you a lot. There's no auto layout and no linked components. A change like renaming the "Rivver Go" header means updating every screen by hand, or by script, which I can do.
- Icons and image-heavy screens like the event cards and maps in `go.pen` are where you'd lose the most fidelity.

A reasonable split: keep the flows and journey maps in OpenBoard, and treat the screens there as low-to-mid fidelity wireframes. If you still need high-fidelity mockups, a free tool with auto layout and components, like Penpot (open source) or Figma's free tier, would fit better than OpenBoard. I can also script repeated edits across OpenBoard screens, which makes up for some of the missing features.