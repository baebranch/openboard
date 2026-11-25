# OpenBoard

An infinite-canvas whiteboard that opens `*.openboard` files as a custom editor in VS Code and compatible hosts (VSCodium, Cursor, and others). Boards are plain JSON, so they diff, merge and live in source control.

## Features

- Shapes (rectangle, ellipse, diamond), lines, arrows with connectors, freehand ink, rich text, images, frames and sticky notes.
- Undo/redo, grouping, alignment, z-order, snapping, grid and minimap.
- Mockup design: per-corner radius, text weight, color and wrapping, image fills, frame clipping, design tokens, reusable components with instances and overrides, auto layout, and icons (see [Mockup design](#mockup-design)).
- Auto layout for flow diagrams, Mermaid flowchart import, and a reusable component library.
- Export to PNG, SVG, JPEG, WebP and PDF (PNG can embed the board so it can be re-imported).
- Agent tools: every board operation is available to language models and other extensions.
- Fully offline: no network access, telemetry or remote content. The optional MCP channel is local only (named pipe or Unix socket, never a TCP port).

## Usage

- Create a board with **OpenBoard: New Board** (or right-click a folder in the Explorer), or just create a file ending in `.openboard`.
- Opening a `.openboard` file shows the whiteboard. **OpenBoard: Open as Text** shows the raw JSON.
- Commands: New Board, Export Board, Zoom to Fit, Toggle Grid, Toggle Minimap, Open as Text, Copy MCP Server Config.

## Mockup design

Boards can describe app and web screens as well as whiteboards. Everything below is optional: a board that uses none of it loads, edits and exports exactly as before.

- **Styling.** Per-corner radius, text weight and text color, text wrapping inside the box, image fills (`cover`, `contain`, `stretch`) and frame clipping.
- **Design tokens.** Named colors and fonts that elements reference, so one change restyles a board. Token values must be literals. Color tokens can have light and dark values, with a light, dark or auto preview mode.
- **Components.** **Create Component** turns a Frame into a master. Instances follow the master, can override text and colors locally, and can be reset (**Reset Overrides**), unlinked (**Detach Instance**) or traced back (**Go to master**). **Remove Component** unlinks a master. Library components create real masters, and the library includes a UI kit and phone, tablet and browser device frames.
- **Auto layout.** A Frame can arrange its children in a row or column with gap, padding and alignment. Children are `fixed`, `hug` their content or `fill` the space, Frames can nest, and resizing a Frame reflows its content. **Move into Frame** and **Move out of Frame** change a child's parent.
- **Icons.** The `icon` element draws a named glyph, recolored with the stroke color and sized freely. Use the icon picker in the tool palette or `icon.search` from an agent.
- **Agents.** All of this is available through `openboard_call` and `ob.call`: `token.*`, `component.*`, `component.instance.*`, `component.instance.override.*` and `icon.search`, plus the new fields on `element.create` and `element.update`. See the `actions` skill topic and [docs/action-coverage.md](docs/action-coverage.md).
- **Export.** SVG, PNG, JPEG, WebP and PDF render all of it through the same renderer as the canvas.

### Icon set license

The embedded icons are 167 icons from [Lucide](https://lucide.dev), taken from `lucide-static`, under the ISC license. Some are derived from Feather (MIT). The icon names are listed in [docs/icon-list.md](docs/icon-list.md) and the license texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). An icon whose name is not in the set is kept in the file unchanged.

### Schema version 2

A board is saved as `schemaVersion` 2 only when it uses a version 2 feature: tokens, token references, components, instances, overrides, `layout`, `sizing`, `ignoreLayout` or `icon` elements. Other boards keep saving as version 1, and version 1 files open without a prompt or an unsaved-changes mark.

**Older builds open version 2 boards read-only.** A build that predates mockup design shows a "created by a newer version" message, rejects saves and leaves the file untouched, so it can never break component links or layout. Update the extension to edit such boards. Version 1 boards saved by an older build keep the corner, text and image fields unchanged.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `openboard.defaultExportScale` | `2` | Pixel scale (1 to 4) for raster export. |
| `openboard.defaultExportBackground` | `theme` | `transparent`, `white` or `theme`. |
| `openboard.gridSpacing` | `20` | Grid spacing in board units (4 to 200). |
| `openboard.defaultFontFamily` | `""` | Font for new text; empty uses the editor font. |
| `openboard.autoLayoutDirection` | `horizontal` | Default direction for auto layout. |
| `openboard.mcp.enabled` | `true` | Open this window's local MCP channel. |

## Agent tools

OpenBoard gives agents a small, fixed surface of **five tools**, the same in VS Code (**Language Model Tools**, `contributes.languageModelTools`, referenceable in chat as `#openboard_execute` and so on) and over MCP:

| Tool | Purpose |
| --- | --- |
| `openboard_workspaces` | List running OpenBoard windows (`workspaceId`, `workspaceName`, `folders`, `ide`). In VS Code: this window plus its open boards. |
| `openboard_read_skill` | Built-in documentation. No `topic` returns the index; topics: `overview`, `elements`, `editing`, `flowcharts`, `export`, `library`, `code-mode`, `actions`. |
| `openboard_execute` | Run JavaScript in a sandbox with a global `ob` API (code mode, below). Best for multi-step edits. |
| `openboard_call` | Run one action (`element.create`, `connect`, `layout`, `export`, ...) with a JSON `input`. For agents that do not write code. |
| `openboard_save` | Save a board (the active one by default) and return the saved path. |

The descriptions and schemas of the five tools total under 4 KB, so they cost an agent little context; the details live in the skill. Behind them sits the same internal registry of 25 actions as before (`element.{create,update,query,delete,arrange}`, `connect`, `layout`, `import`, `export`, `board.{preview,list,open,create,save,close,summary}`, `schema`, `selection`, `viewport`, `undo`, `redo`, `library.{save,list,insert}`, `batch`); the exported API and `openboard.invokeTool` still use the dotted registry names (`openboard.element.create`). `openboard_call` only needs the short form (`element.create`), and its input schemas are in the `actions` skill topic, which is generated from the registry at build time so it cannot drift. A validation error from `openboard_call` returns the schema issues plus a hint to read that topic.

In VS Code, `openboard_execute` always asks for confirmation (it shows the start of the script) and `openboard_call` asks for destructive actions (delete, close, undo, redo, cut). MCP calls show no extra dialog; your agent's own confirmations apply.

### The skill

`openboard_read_skill` is the one place agents learn how OpenBoard works: concepts (boards, elements, ids, z-order, frames, edges, undo, the `workspace` parameter), every element type and property, editing, flowcharts and Mermaid import, export, the library, code mode with the full TypeScript declarations of `ob`, and every action with its input schema. The hand-written prose lives in `src/mcp/skill/*.md`; the element, action and `ob` reference parts are generated from the element schemas and the registry by `npm run build` into `dist/mcp-skill.json`. Over MCP each topic is also an MCP resource, `openboard://skill/<topic>`.

### Code mode (`openboard_execute`)

```js
// openboard_execute { code: "..." }
const [a, b] = await ob.board().create([
  { id: "a", type: "flowNode", text: "Start" },
  { id: "b", type: "flowNode", text: "Done" },
]);
await ob.board().connect(a, b, { label: "go" });
await ob.board().layout({ direction: "LR" });
return { ids: [a, b], total: (await ob.board().query({})).total };
```

The code is the body of an async function; its JSON-serializable return value is the result and `console.log/warn/error` output comes back as `logs`. `ob` offers `boards()`, `board(path?)` (handle with `summary`, `query`, `get`, `create`, `update`, `remove`, `arrange`, `connect`, `layout`, `importMermaid`, `library`, `insertComponent`, `viewport`, `export`, `save`) and `call(action, input)` for any registry action.

- **One undo step, all or nothing.** All edits of one run are applied live (later reads see earlier writes) but recorded as a single undo entry per board; if the code throws, times out or hits a limit, everything is rolled back and the board is unchanged. (`save()` inside a script commits the pending edits first, so it splits the undo history; call `openboard_save` after the run instead.)
- **Sandbox.** The code runs in a QuickJS WebAssembly sandbox (`quickjs-emscripten`): only standard JavaScript plus `ob` and `console` exist. There is no `require`, `import`, `process`, `fetch`, file system, network or timers, and the sandbox has no route to the host except `ob`.
- **Limits.** Wall-clock `timeoutMs` (default 10 s, max 60 s), 64 MB memory, 512 KB call stack, about 512 KB of result and 64 KB of logs. A violation returns an error with a code (`timeout`, `memory`, `stack`, `result_too_large`, `script_error`) and rolls back. `ob` calls run one at a time, in call order.
- Over MCP the sandbox runs in the MCP server process and talks to the window over the local channel inside one transaction; in VS Code it runs inside the extension host and calls the registry directly.

### Exported API

The extension exports `{ list, describe, invoke }`:

```ts
const ext = vscode.extensions.getExtension('baebranch.openboard');
const api = await ext?.activate();
api.list();                                   // string[] of tool names
api.describe('openboard.element.create');     // description + input/output schema
await api.invoke('openboard.board.create', { path: 'file:///work/plan.openboard' });
await api.invoke('openboard.element.create', {
  board: 'file:///work/plan.openboard',
  elements: [{ type: 'rectangle', x: 0, y: 0, width: 160, height: 80 }],
});
```

### `openboard.invokeTool` command

```ts
await vscode.commands.executeCommand('openboard.invokeTool', 'openboard.board.list', {});
await vscode.commands.executeCommand('openboard.invokeTool', 'openboard.element.query', {
  board: 'file:///work/plan.openboard',
  type: 'rectangle',
});
```

## MCP server

Agents in any VS Code or Open VSX IDE (Kiro, Cursor, VS Code with any agent, Claude Code and others) can use the same five tools over MCP, even if they do not support `vscode.lm` tools. The bundled MCP stdio server (`dist/mcp.js`) lists the tools and serves the skill (as tools and as `openboard://skill/<topic>` resources) without any IDE window running, runs `openboard_execute` scripts in its own sandbox, and forwards the tool calls to the right OpenBoard window. Its `instructions` tell the agent to read the skill first, prefer `openboard_execute` for multi-step edits, pass `workspace` when several windows are open, and save with `openboard_save`. The server needs `dist/quickjs.wasm` next to `dist/mcp.js` (the extension package includes it).

**VS Code 1.101+ (automatic).** OpenBoard registers itself as an MCP server provider (`contributes.mcpServerDefinitionProviders`). The server appears under MCP servers and defaults to the workspace of its own window. It launches with the IDE's own runtime (`ELECTRON_RUN_AS_NODE=1`), so no separate Node install is needed. On hosts without this API (for example Kiro, older VS Code) the extension logs a note and skips it.

**Other agents (copy config).** Run **OpenBoard: Copy MCP Server Config** and paste the snippet into your agent's MCP configuration, for example `~/.kiro/settings/mcp.json` or `.kiro/settings/mcp.json` (Kiro), `~/.cursor/mcp.json` (Cursor), or `claude mcp add-json openboard '<snippet>'` / `.mcp.json` (Claude Code):

```json
{
  "mcpServers": {
    "openboard": {
      "command": "node",
      "args": ["/home/you/.openboard/bin/openboard-mcp.js"]
    }
  }
}
```

The command is `node` when it is on `PATH`; otherwise the IDE executable is used together with `"env": { "ELECTRON_RUN_AS_NODE": "1" }`. The args point at a stable launcher (`~/.openboard/bin/openboard-mcp.js`) that the extension rewrites on activation, so updating the extension does not break the config. OpenBoard never edits other tools' config files.

**Choosing a window.** Every IDE window runs OpenBoard independently, with its own boards and workspace id. `openboard_execute`, `openboard_call` and `openboard_save` accept an optional `workspace` argument: a workspace id from `openboard_workspaces`, or an absolute path inside the workspace. The window is resolved in this order: `workspace` (id or path), an absolute `board` path in the input, the `OPENBOARD_WORKSPACE_ID` environment variable (set by the VS Code auto-registration), the only running window, otherwise an error that lists the running workspaces and asks for `workspace`.

**Settings and security.** `openboard.mcp.enabled` (default `true`) opens or closes this window's channel at runtime.

- Each window listens only on a local endpoint: a named pipe on Windows (`\\.\pipe\openboard-<random>`) or a Unix socket in `~/.openboard/run/` (mode 0600, directory 0700). It never opens a TCP port.
- Instance records in `~/.openboard/instances/` (mode 0600, directory 0700) hold the endpoint and a random 32-byte token per window. Requests with a wrong token are rejected. Records are removed when the window closes, and stale ones are pruned.
- Calls go through the same registry pipeline as the exported API, including the workspace trust gate. MCP calls show no extra confirmation dialog; your agent's own confirmations apply.
- Scripts run in a QuickJS WebAssembly sandbox with no network, file or process access (see Code mode). A script's tool calls form a session on the window's channel; a session whose caller disappears is rolled back after 2 minutes, or immediately when the window closes.
- Set `OPENBOARD_HOME` to use a different directory than `~/.openboard`.

## File format

A `.openboard` file is UTF-8 JSON with `schemaVersion`, `meta`, `viewport`, `elements` (in z-order), `assets` (embedded images) and `library` (saved components). `schemaVersion` is 1 or 2 (see [Schema version 2](#schema-version-2)); version 1 is migrated in memory on open. Files over 200 MB, or that are not valid JSON or do not match the schema, are not opened in the board editor (use **Open as Text**). A JSON Schema (`src/core/schema/board.schema.json`) is registered for `*.openboard`, so the text view gets validation and completion.

## Offline and security notes

- No network access (no TCP, HTTP or WebSocket): the webview content security policy blocks remote resources, and no scripts are loaded from the web.
- The webview only receives data through a validated message protocol; board content is never evaluated as code.
- In untrusted workspaces boards can be viewed and edited, but tools that write other files are disabled.
- Writes are atomic (temp file then rename), and external changes to an open file are detected and reconciled.

## Development

```
npm install
npm run build        # builds dist/
npm test
npm run package      # builds schemas + minified bundles, checks the manifest, creates openboard-<version>.vsix
npm run test:integration   # runs test/integration inside a real VS Code
```

`npm test` includes the extension-host scenarios against an in-memory fake `vscode` (test/host/extension.test.ts).
`npm run test:integration` downloads VS Code into `.vscode-test/` on first run, so it needs network once; after that it runs offline. Set `OPENBOARD_VSCODE_EXECUTABLE` to an installed VS Code to skip the download, or `OPENBOARD_VSCODE_VERSION` to pin a version. On Linux CI without a display, run it under `xvfb-run -a`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

### Publishing

Pushing a `v<version>` tag (matching `version` in `package.json`) runs the **Release** workflow (`.github/workflows/release.yml`). It verifies and packages the extension once, publishes that same `.vsix` to the Visual Studio Marketplace and Open VSX (checking its SHA-256 before each upload), and then creates a GitHub release with the `.vsix`, its `.sha256` checksum and notes from `CHANGELOG.md`. It needs the `VSCE_PAT` and `OVSX_PAT` repository secrets and fails if either is missing.

To publish by hand, use the VS Code tasks `openboard: publish to VS Code Marketplace` and `openboard: publish to Open VSX`, or:

- Visual Studio Marketplace: `npx vsce publish --packagePath openboard.vsix` (needs the `VSCE_PAT` environment variable).
- Open VSX: `npx ovsx publish openboard.vsix` (needs the `OVSX_PAT` environment variable). `ovsx` is a pinned dev dependency, so `npx` runs the local copy.

## Installing from a release

Download `openboard-<version>.vsix` from the [GitHub releases](https://github.com/openboard-dev/openboard/releases) page and run **Extensions: Install from VSIX...** in VS Code, or `code --install-extension openboard-<version>.vsix`. The release lists its SHA-256, which matches the package on both marketplaces.

## Contributing and security

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
