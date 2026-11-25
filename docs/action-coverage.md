# Action coverage

Every user-facing action is performed by a registry tool (Req 13.2, 13.3). The webview builds a tool
input and the host runs it through the same registry the agent uses. `test/action-coverage.test.ts`
checks that every `ActionId` below appears here, maps to an existing tool, and builds valid input.

Note on agent names: tool names below are registry names (dotted); the exported API and
`openboard.invokeTool` use them as is. Language model tools and the MCP server expose only five
polymorphic tools (`openboard_workspaces`, `openboard_read_skill`, `openboard_execute`,
`openboard_call`, `openboard_save`); every registry tool is reached through `openboard_call` by its
short action name (`openboard.element.create` becomes `element.create`) or through `ob.call(...)`
in `openboard_execute`. The enum of `openboard_call` and the `actions` skill topic are generated
from the registry, and `test/action-coverage.test.ts` checks them against it.

## Selection actions (`src/webview/actions.ts`)

| ActionId | User action | Tool |
| --- | --- | --- |
| `copy` | Copy | `openboard.element.arrange` (`copy`) |
| `cut` | Cut | `openboard.element.arrange` (`cut`) |
| `paste` | Paste | `openboard.element.arrange` (`paste`) |
| `duplicate` | Duplicate | `openboard.element.arrange` (`duplicate`) |
| `delete` | Delete | `openboard.element.delete` |
| `group` | Group | `openboard.element.arrange` (`group`) |
| `ungroup` | Ungroup | `openboard.element.arrange` (`ungroup`) |
| `align-left` | Align left | `openboard.element.arrange` (`align`) |
| `align-center` | Align center | `openboard.element.arrange` (`align`) |
| `align-right` | Align right | `openboard.element.arrange` (`align`) |
| `align-top` | Align top | `openboard.element.arrange` (`align`) |
| `align-middle` | Align middle | `openboard.element.arrange` (`align`) |
| `align-bottom` | Align bottom | `openboard.element.arrange` (`align`) |
| `distribute-horizontal` | Distribute horizontally | `openboard.element.arrange` (`distribute`) |
| `distribute-vertical` | Distribute vertically | `openboard.element.arrange` (`distribute`) |
| `bring-to-front` | Bring to front | `openboard.element.arrange` (`zorder`) |
| `bring-forward` | Bring forward | `openboard.element.arrange` (`zorder`) |
| `send-backward` | Send backward | `openboard.element.arrange` (`zorder`) |
| `send-to-back` | Send to back | `openboard.element.arrange` (`zorder`) |
| `nudge` | Nudge with arrow keys | `openboard.element.arrange` (`nudge`) |

## Gestures and dialogs

| User action | Tool |
| --- | --- |
| Move, resize, rotate, property edits, text edits, crop, alt text | `openboard.element.update` |
| Draw shape, freehand | `openboard.element.create` |
| Erase | `openboard.element.delete` |
| Drag connector | `openboard.connect` (inside `openboard.batch` when combined) |
| Paste Mermaid, import image | `openboard.import` |
| Export dialog | `openboard.export` |
