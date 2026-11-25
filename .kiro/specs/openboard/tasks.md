# Implementation Plan: OpenBoard

## Overview

Implementation language: TypeScript (the design uses TypeScript throughout). The plan builds the pure Core layer first (model, format, operations, Tool_Registry, geometry, layout, export math), validating it with fast-check property tests as it grows. It then adds the Extension host (custom editor, file I/O, agent exposure) and the React/ReactFlow webview, and finishes with manifest generation, packaging, and integration tests. Every edit path goes through the Tool_Registry so UI and agents share one pipeline.

## Tasks

- [x] 1. Project setup
  - [x] 1.1 Scaffold the extension project
    - Create `package.json`, `tsconfig.json`, esbuild bundling for host and webview, vitest, and fast-check (pinned versions)
    - Create the directory layout `src/core`, `src/host`, `src/webview`, `src/shared`, and `test/`
    - Add an ESLint `no-restricted-imports` rule forbidding `net`, `http`, `https`, `ws`, `child_process`, `dgram` in `src/`
    - Add the `test` script so a failing test exits non-zero and names each failing test
    - _Requirements: 1.1, 1.3, 14.6, 19.8_

- [x] 2. Core model and schema
  - [x] 2.1 Implement model types, IDs, geometry, and z-order helpers
    - Define `Element` types, `BoardDocument`, `Asset`, `LibraryComponent`, `Viewport`, and ranges
    - Implement `newId()` using `crypto.randomUUID()`, bounds math, and z-order helpers
    - _Requirements: 3.1, 11.4, 15.9_

  - [x] 2.2 Write property test for identifier uniqueness
    - **Property 26: Element identifiers do not collide**
    - **Validates: Requirements 15.9, 11.4**

  - [x] 2.3 Create the Board_File JSON Schema and Ajv standalone build
    - Author `board.schema.json` and per-element schemas, with a schema builder shared with tool schemas
    - Add a build script that compiles standalone validators with no runtime `eval`
    - _Requirements: 11.1, 11.8, 11.15, 13.8_

  - [x] 2.4 Create shared fast-check arbitraries
    - Implement `arbBoardDocument` (0 to 500 Elements), `arbElement(type)`, `arbViewport`, `arbBounds`, and `arbEditSequence` in `test/arbitraries/`
    - _Requirements: 19.1_

- [x] 3. Serializer, Parser, and migrations
  - [x] 3.1 Implement the canonical Serializer
    - Emit sorted keys at every level, 2-space indent, trailing newline, Elements in z-order
    - Deduplicate Assets by SHA-256 and omit unreferenced Assets
    - Flatten preserved unknown properties back to their original location
    - _Requirements: 7.10, 7.11, 11.1, 11.3, 11.11_

  - [x] 3.2 Implement the Parser
    - Return empty document for zero-byte input
    - Convert JSON errors to 1-based line and column; return schema errors with property path
    - Open newer Schema_Version as read-only; preserve unknown properties in an `extra` bag
    - _Requirements: 11.5, 11.7, 11.8, 11.10, 11.11, 11.12_

  - [x] 3.3 Implement the migration framework
    - Add `v(n) -> v(n+1)` migration chain and stored fixtures for each prior version
    - _Requirements: 11.9_

  - [x] 3.4 Write property test for document round trip
    - **Property 1: Document round trip**
    - **Validates: Requirements 11.5, 11.6, 11.4, 6.11**

  - [x] 3.5 Write property test for canonical serialization
    - **Property 2: Serialization is canonical and idempotent**
    - **Validates: Requirements 11.1, 11.3**

  - [x] 3.6 Write property test for unknown property preservation
    - **Property 3: Unknown properties are preserved**
    - **Validates: Requirements 11.11**

  - [x] 3.7 Write property test for JSON error positions
    - **Property 4: Invalid JSON reports a correct position**
    - **Validates: Requirements 11.7**

  - [x] 3.8 Write property test for schema error paths
    - **Property 5: Schema violations name the offending path**
    - **Validates: Requirements 11.8**

  - [x] 3.9 Write property test for migrations
    - **Property 6: Migration produces a current-version document**
    - **Validates: Requirements 11.9**

  - [x] 3.10 Write property test for asset storage
    - **Property 7: Assets are stored once and only when referenced**
    - **Validates: Requirements 7.10, 7.11**

  - [x] 3.11 Write migration fixture unit tests
    - For each prior Schema_Version, load the fixture and assert it loads at the current version
    - _Requirements: 19.7_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Operations engine and undo history
  - [x] 5.1 Implement `BoardModel`, `Tx`, and `transact`
    - Stage changes on a draft, produce patches and inverse patches, commit atomically, roll back on throw
    - Enforce invariants: unique IDs, edge endpoints exist, parents are frames, assets exist; edge cascade on remove
    - _Requirements: 10.1, 10.7, 8.6_

  - [x] 5.2 Implement `UndoHistory`
    - Push, undo, redo, redo-clear on new edit, eviction at the limit (default 500, at least 200), no-op when empty
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.8, 10.9_

  - [x] 5.3 Write property test for undo and redo
    - **Property 8: Undo and redo are inverses**
    - **Validates: Requirements 10.2, 10.3, 10.9, 19.4**

  - [x] 5.4 Write property test for history bookkeeping
    - **Property 9: History bookkeeping**
    - **Validates: Requirements 10.1, 10.4, 10.8**

- [x] 6. Tool_Registry core
  - [x] 6.1 Implement the registry and invoke pipeline
    - `ToolDefinition`, `list`, `describe`, `invoke` with input validation, per-board `SerialQueue`, output validation, structured errors
    - Enforce name length 1 to 64 and description length 1 to 1,000
    - _Requirements: 13.1, 13.3, 13.9, 13.10, 13.11, 14.16_

  - [x] 6.2 Implement board resolution and workspace trust gate
    - Resolve open, background-open, active, not-found, and no-active-board cases behind a host interface
    - Reject writes to files other than the active board in untrusted workspaces
    - _Requirements: 13.17, 14.9, 14.10, 14.11, 14.12, 14.13, 16.9_

  - [x] 6.3 Implement destructive confirmation message builder
    - Build messages of at most 300 characters with tool name, shortened board path, and effect
    - _Requirements: 14.17_

  - [x] 6.4 Write property test for input rejection
    - **Property 12: Invalid input is rejected before the handler runs**
    - **Validates: Requirements 13.9, 13.10, 19.2**

  - [x] 6.5 Write property test for tool schemas
    - **Property 13: Tool schemas accept valid and reject invalid samples**
    - **Validates: Requirements 19.2, 13.1**

  - [x] 6.6 Write property test for tool definition limits
    - **Property 14: Tool definitions satisfy size limits**
    - **Validates: Requirements 13.1**

  - [x] 6.7 Write property test for board resolution
    - **Property 19: Board resolution**
    - **Validates: Requirements 14.9, 14.10, 14.11, 14.12, 14.13**

  - [x] 6.8 Write property test for serial execution
    - **Property 20: Serial execution per board**
    - **Validates: Requirements 14.16**

  - [x] 6.9 Write property test for confirmation messages
    - **Property 22: Destructive confirmation messages**
    - **Validates: Requirements 14.17**

  - [x] 6.10 Write property test for the trust gate
    - **Property 23: Workspace trust gate**
    - **Validates: Requirements 16.9**

- [x] 7. Element tools and editing operations
  - [x] 7.1 Implement property descriptors and `validateProperty`
    - Ranges for stroke width, opacity, font size, rotation, corner radius, size, position precision, freehand width
    - _Requirements: 6.6, 6.7, 6.9, 9.7, 9.8_

  - [x] 7.2 Implement `element.create`, `update`, `query`, `delete`
    - Polymorphic creation by type; selection by ids, type, or filter (1 to 1,000); pagination 1 to 500; not-found errors
    - _Requirements: 13.4, 13.5, 13.14, 13.17, 6.8_

  - [x] 7.3 Implement `element.arrange`
    - Group, ungroup, align, distribute, z-order, duplicate, copy, cut, paste, nudge, with no-op and no history entry when preconditions fail
    - _Requirements: 5.6, 5.7, 5.8, 5.9, 5.10, 5.13_

  - [x] 7.4 Implement `connect`
    - Create edges with routing, arrowheads, label up to 200 characters, self-loops; edge cascade on delete
    - _Requirements: 8.2, 8.3, 8.5, 8.6, 8.7_

  - [x] 7.5 Write property test for property validation
    - **Property 41: Property validation**
    - **Validates: Requirements 6.6, 6.7, 6.9, 9.7, 9.8**

  - [x] 7.6 Write property test for filtered selection and paging
    - **Property 17: Filtered selection matches the filter**
    - **Validates: Requirements 13.5, 13.14**

  - [x] 7.7 Write property test for missing references
    - **Property 18: Missing references leave the document unchanged**
    - **Validates: Requirements 13.17, 14.13**

  - [x] 7.8 Write property test for selection-required operations
    - **Property 35: Selection-required operations**
    - **Validates: Requirements 5.6, 5.7**

  - [x] 7.9 Write property test for align
    - **Property 36: Align**
    - **Validates: Requirements 5.8**

  - [x] 7.10 Write property test for distribute
    - **Property 37: Distribute**
    - **Validates: Requirements 5.9**

  - [x] 7.11 Write property test for z-order
    - **Property 38: Z-order operations**
    - **Validates: Requirements 5.10**

  - [x] 7.12 Write property test for keyboard nudge
    - **Property 39: Keyboard nudge**
    - **Validates: Requirements 5.13**

  - [x] 7.13 Write property test for mixed property display
    - **Property 42: Mixed property display and bulk apply**
    - **Validates: Requirements 6.8**

  - [x] 7.14 Write property test for delete cascade
    - **Property 49: Deleting elements cascades to edges**
    - **Validates: Requirements 8.6**

- [x] 8. Batch, schema, and remaining tools
  - [x] 8.1 Implement `openboard.batch`
    - 1 to 500 ordered operations in one `transact`; failure index and reason; no nesting; `exceededTimeTarget` flag after 5 seconds
    - _Requirements: 13.6, 13.7, 10.6, 17.4, 17.7_

  - [x] 8.2 Implement schema, summary, selection, viewport, undo, redo, and library tools
    - `openboard.schema` returns all element and tool schemas; library save validates name 1 to 100 and non-empty selection; built-in components (button, input, card, navigation bar, device outline)
    - _Requirements: 13.2, 13.8, 13.14, 6.14, 6.15, 6.16_

  - [x] 8.3 Implement board lifecycle tools
    - List, open, create, save, close, via a host interface
    - _Requirements: 13.16, 14.12_

  - [x] 8.4 Write property test for failed operations
    - **Property 10: Failed operations leave the document unchanged**
    - **Validates: Requirements 13.6, 13.7, 10.7, 19.3**

  - [x] 8.5 Write property test for single history entry per tool call
    - **Property 11: Successful tool invocation is one history entry**
    - **Validates: Requirements 10.6, 13.11**

  - [x] 8.6 Write property test for component library names
    - **Property 45: Component library names**
    - **Validates: Requirements 6.15, 6.16**

  - [x] 8.7 Write property test for UI and agent equivalence
    - **Property 16: UI and agent edits are equivalent**
    - **Validates: Requirements 13.12**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Viewport and interaction math
  - [x] 10.1 Implement viewport functions
    - Zoom around pointer, pan, clamp to 2% to 800%, fit to bounds with 32 px margin, zoom to selection, empty-set no-op
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [x] 10.2 Implement grid and alignment snapping
    - Nearest grid multiple; 8 px edge/center snapping with guides
    - _Requirements: 3.11, 5.11_

  - [x] 10.3 Implement hit-testing, marquee selection, and viewport culling
    - Marquee with 1 px intersection and Shift union; culling with 256 px margin
    - _Requirements: 5.4, 17.2_

  - [x] 10.4 Write property test for zoom clamping
    - **Property 28: Zoom is clamped**
    - **Validates: Requirements 3.4, 3.5**

  - [x] 10.5 Write property test for pointer-fixed zoom
    - **Property 29: Zoom keeps the pointer point fixed**
    - **Validates: Requirements 3.2**

  - [x] 10.6 Write property test for pan
    - **Property 30: Pan follows the drag**
    - **Validates: Requirements 3.3**

  - [x] 10.7 Write property test for fit
    - **Property 31: Fit viewport contains all content**
    - **Validates: Requirements 3.6, 3.7, 3.8, 3.9, 3.10**

  - [x] 10.8 Write property test for grid snapping
    - **Property 32: Grid snapping**
    - **Validates: Requirements 3.11**

  - [x] 10.9 Write property test for alignment snapping
    - **Property 33: Alignment snapping**
    - **Validates: Requirements 5.11**

  - [x] 10.10 Write property test for marquee selection
    - **Property 34: Marquee selection**
    - **Validates: Requirements 5.4**

  - [x] 10.11 Write property test for viewport culling
    - **Property 60: Viewport culling**
    - **Validates: Requirements 17.2**

- [x] 11. Shapes, frames, freehand, and images
  - [x] 11.1 Implement shape creation, resize, and frames
    - Drag-to-bounds, 100 by 100 default for tiny drags, Shift aspect-ratio resize, frame child adoption and move, frame presets (5 devices, 3 social formats), text-edit empty deletion rule
    - _Requirements: 6.1, 6.2, 6.4, 6.10, 6.12, 6.13_

  - [x] 11.2 Implement freehand stroke logic
    - Smoothing within 2 px, pressure width 25% to 200%, Shift 15-degree constraint, single-dot strokes, eraser path intersection
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.9_

  - [x] 11.3 Implement image validation and sizing
    - Content-type detection, 25 MB limit (exact accepted), per-file batch handling, 1,024 cap, replace-source rule, alt text up to 500
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 7.12_

  - [x] 11.4 Write property test for shape creation
    - **Property 40: Shape creation from a drag**
    - **Validates: Requirements 6.1, 6.2**

  - [x] 11.5 Write property test for aspect-ratio resize
    - **Property 43: Aspect-ratio resize**
    - **Validates: Requirements 6.10**

  - [x] 11.6 Write property test for frame children
    - **Property 44: Frame children move with the frame**
    - **Validates: Requirements 6.12**

  - [x] 11.7 Write property test for pressure and smoothing
    - **Property 52: Pressure width and smoothing**
    - **Validates: Requirements 9.4, 9.5**

  - [x] 11.8 Write property test for the eraser
    - **Property 53: Eraser removes exactly intersected elements**
    - **Validates: Requirements 9.6**

  - [x] 11.9 Write property test for Shift-constrained strokes
    - **Property 54: Shift-constrained strokes**
    - **Validates: Requirements 9.9**

  - [x] 11.10 Write property test for image validation
    - **Property 46: Image validation**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.7**

  - [x] 11.11 Write property test for image sizing
    - **Property 47: Image sizing**
    - **Validates: Requirements 7.5, 7.9**

- [x] 12. Flow diagrams: anchors, layout, Mermaid
  - [x] 12.1 Implement edge anchors and routing
    - Straight, curved, orthogonal routing; anchor recomputation on move; self-loop geometry; seven Flow_Node presets
    - _Requirements: 8.1, 8.4, 8.7_

  - [x] 12.2 Implement `autoLayout`
    - Layered layout (dagre) for four directions, cycle breaking, single undoable transaction, too-few-nodes error
    - _Requirements: 8.8, 8.9, 8.10_

  - [x] 12.3 Implement the Mermaid flowchart parser and printer
    - Directions, node shapes mapped to presets, link forms and labels, first-error line number
    - _Requirements: 8.11, 8.12_

  - [x] 12.4 Write property test for edge re-routing
    - **Property 48: Edge re-routing keeps endpoints attached**
    - **Validates: Requirements 8.4**

  - [x] 12.5 Write property test for auto layout
    - **Property 50: Auto layout**
    - **Validates: Requirements 8.8, 8.9, 8.10**

  - [x] 12.6 Write property test for Mermaid import
    - **Property 51: Mermaid import round trip and errors**
    - **Validates: Requirements 8.11, 8.12**

  - [x] 12.7 Register `openboard.layout` and `openboard.import` tools
    - Wire layout and Mermaid, image, component, and embedded-PNG import through the registry
    - _Requirements: 8.8, 8.11, 13.2_

- [x] 13. Export
  - [x] 13.1 Implement export scope, size, and option validation
    - `selectScope`, `computeOutputSize`, padding validation (integer 0 to 256), empty-scope and 16,384 px limit errors
    - _Requirements: 12.2, 12.4, 12.5, 12.6, 12.12, 12.13, 12.15_

  - [x] 13.2 Implement `renderToSvg` and self-contained SVG export
    - Shared renderer for canvas and export; inline assets as data URIs; transparent and white backgrounds; match-theme option
    - _Requirements: 12.3, 12.7, 12.14, 4.8_

  - [x] 13.3 Implement PNG iTXt chunk embed and extract
    - Pure byte manipulation preserving pixels
    - _Requirements: 12.8_

  - [x] 13.4 Implement the minimal PDF writer
    - One page per export region, offline
    - _Requirements: 12.1_

  - [x] 13.5 Register `openboard.export` and `openboard.board.preview` tools
    - Base64 image results with MIME type; all-frames one file per Frame
    - _Requirements: 12.1, 12.2, 13.14, 13.15_

  - [x] 13.6 Write property test for export scope
    - **Property 56: Export scope**
    - **Validates: Requirements 12.2, 12.15**

  - [x] 13.7 Write property test for export options and limits
    - **Property 57: Export options and limits**
    - **Validates: Requirements 12.5, 12.6, 12.12, 12.13**

  - [x] 13.8 Write property test for self-contained SVG
    - **Property 58: SVG export is self-contained**
    - **Validates: Requirements 12.7**

  - [x] 13.9 Write property test for PNG metadata round trip
    - **Property 59: PNG metadata round trip**
    - **Validates: Requirements 12.8**

- [x] 14. Theme, sanitization, and settings logic
  - [x] 14.1 Implement theme palette resolution
    - CSS variable mapping, built-in fallbacks per theme kind, `pickContrastColor` at 4.5:1, `theme:default` resolution at render time
    - _Requirements: 4.1, 4.4, 4.5, 4.9_

  - [x] 14.2 Implement the text run model and sanitizer
    - Restricted runs with bold, italic, underline; whitelist HTML import; escaping; SVG assets as image data URIs
    - _Requirements: 6.11, 16.3, 16.4_

  - [x] 14.3 Implement settings descriptors and validation
    - Five options with defaults and fallback without writing back
    - _Requirements: 18.3, 18.5_

  - [x] 14.4 Write property test for theme colors
    - **Property 55: Theme colors**
    - **Validates: Requirements 4.4, 4.5, 4.9**

  - [x] 14.5 Write property test for text sanitization
    - **Property 25: Text content is sanitized**
    - **Validates: Requirements 16.3**

  - [x] 14.6 Write property test for settings fallback
    - **Property 61: Settings fall back to defaults**
    - **Validates: Requirements 18.3, 18.5**

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Extension host
  - [x] 16.1 Implement `AtomicFileWriter`
    - Write temp then rename with overwrite; delete temp on failure; `SaveFailed` error
    - _Requirements: 11.2, 11.16, 15.10, 15.11_

  - [x] 16.2 Write property test for atomic writes
    - **Property 27: Atomic writes survive any failure**
    - **Validates: Requirements 15.10, 15.11, 11.16**

  - [x] 16.3 Implement the webview/host message protocol
    - Shared message JSON Schema, compiled validator, drop-and-log on invalid messages
    - _Requirements: 16.5_

  - [x] 16.4 Write property test for invalid messages
    - **Property 24: Invalid host/webview messages are discarded**
    - **Validates: Requirements 16.5**

  - [x] 16.5 Implement `BoardDocument` and `BoardEditorProvider`
    - Size check (200 MB), parse, invalid-file panel, multi-editor support, dirty tracking, save, save as, revert, backup for hot exit, undo/redo via `onDidChangeCustomDocument`, read-only for newer versions, 5,000-element notice
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.9, 10.10, 11.10, 11.13, 11.14, 16.7, 17.6_

  - [x] 16.6 Implement `ExternalChangeHandler`
    - Ignore own writes; silent reload of clean documents preserving viewport; conflict prompt with keep local, load disk, compare as JSON text
    - _Requirements: 2.7, 2.8, 15.4, 15.5, 15.6_

  - [x] 16.7 Implement webview session sync and recovery
    - Patch broadcast to all tabs, gesture acks, viewport retention on hide, watchdog restart within 5 seconds, unacknowledged-edit notice, hidden render panel for background boards
    - _Requirements: 2.5, 2.10, 14.14, 14.15, 16.6, 16.10_

  - [x] 16.8 Write property test for multi-tab convergence
    - **Property 62: Multi-tab replicas converge**
    - **Validates: Requirements 2.5**

  - [x] 16.9 Implement LM_Tool_Bridge, exported API, and `openboard.invokeTool`
    - Register every registry tool without per-tool code; skip when `vscode.lm` is absent; `activate()` returns exactly `list`, `describe`, `invoke`; command accepts object or JSON string and errors on invalid arguments
    - _Requirements: 1.4, 13.13, 14.1, 14.3, 14.4, 14.5, 14.17_

  - [x] 16.10 Write property test for single registry exposure
    - **Property 15: One registry feeds all three exposure paths**
    - **Validates: Requirements 13.3, 13.13, 14.2, 14.3**

  - [x] 16.11 Write property test for invokeTool arguments
    - **Property 21: invokeTool argument validation**
    - **Validates: Requirements 14.5**

  - [x] 16.12 Wire activation, commands, settings, and trust
    - Six palette commands with no-active-board notification; settings reader pushing changes within 500 ms; trust handling; deactivate cleanup; no servers, lock files, or port files
    - _Requirements: 1.7, 14.6, 14.7, 15.1, 15.3, 15.7, 18.1, 18.2, 18.4_

- [x] 17. Webview
  - [x] 17.1 Build the webview shell and CSP
    - Nonce-based CSP with no remote origins, local resources only, message client with `init`, `ack`, `patch`, `reset`
    - _Requirements: 16.1, 16.2_

  - [x] 17.2 Build the Canvas with ReactFlow
    - Projection from document, culling, pan/zoom limits, grid, minimap, zoom percentage, snapping guides, resize and rotation handles, edge connection gestures, gesture-level single operations
    - _Requirements: 3.1, 3.11, 3.12, 5.5, 8.2, 8.3, 10.5, 17.2_

  - [x] 17.3 Build the Tool_Palette and shortcuts
    - 13 tools, exclusive active tool, roving tabindex, unique accessible names, Escape behavior, keyboard traversal and nudge, context menu
    - _Requirements: 5.1, 5.2, 5.3, 5.12, 5.13, 5.14_

  - [x] 17.4 Build the Properties_Panel
    - Descriptor-driven form, mixed values, error indications on rejection, position and size fields
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 8.5, 9.7, 9.8_

  - [x] 17.5 Wire the Theme_Adapter
    - MutationObserver on theme changes, update within 500 ms, high-contrast borders, editor font settings
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7_

  - [x] 17.6 Build text editing, image handling, and Mermaid paste
    - Inline text edit with run styling, image paste, drop, and picker with rejection messages, crop and replace, Mermaid paste with error line
    - _Requirements: 6.3, 6.5, 6.11, 7.1, 7.8, 8.11, 8.12_

  - [x] 17.7 Build the rasterizer and export UI
    - Offscreen canvas rasterization, Copy as PNG, export dialog options, host save dialog and cleanup on cancel or failure
    - _Requirements: 12.1, 12.9, 12.10, 12.11_

  - [x] 17.8 Write webview component and accessibility tests
    - Palette keyboard operation and unique names, Properties_Panel error states, `axe-core` checks, theme snapshots
    - _Requirements: 5.14, 4.3, 6.7_

- [x] 18. Manifest and packaging
  - [x] 18.1 Implement manifest generation and contributions
    - `scripts/gen-manifest.ts` generating `languageModelTools` from the registry; commands, menus with `when` clauses, hidden menu-only commands, configuration, activation events, engine version, `untrustedWorkspaces`
    - _Requirements: 1.2, 14.2, 16.8, 18.1, 18.3, 18.6, 18.7_

  - [x] 18.2 Add schema registration, icon, localization, and docs
    - `jsonValidation` for `.openboard`, language and file icon, `package.nls.json` with English fallback, README section on external MCP adapters, `.vsix` packaging script
    - _Requirements: 1.1, 11.15, 14.8, 18.8, 18.9_

- [x] 19. Integration, quality, and performance tests
  - [x] 19.1 Write per-element-type unit tests
    - For every Element type: create, update, serialize and parse, export, assert equality
    - _Requirements: 19.5_

  - [x] 19.2 Write action coverage and manifest tests
    - Every UI `ActionId` maps to a tool; manifest tool names equal registry names
    - _Requirements: 13.2, 13.3, 14.2_

  - [x] 19.3 Write the no-sockets and no-lock-file integration test
    - Activate, run core operations, assert zero listening sockets and no lock or port files
    - _Requirements: 14.6, 14.7, 19.6_

  - [x] 19.4 Write VS Code integration tests
    - Activation, open, save, hot exit, reopen as text, LM registration, API and command parity, external change flows, webview crash recovery, offline operation
    - _Requirements: 1.3, 2.4, 2.7, 2.8, 14.1, 14.4, 15.5, 15.6, 16.6_

  - [x] 19.5 Write the performance suite
    - Activation, open times, 30 fps pan/zoom and drag, 1,000-element batch, on the reference machine
    - _Requirements: 1.7, 2.1, 3.13, 17.1, 17.3, 17.4, 17.5_

- [x] 20. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Each of the 62 correctness properties has its own property-based test sub-task using fast-check with at least 100 iterations, tagged `Feature: openboard, Property {n}: {text}`
- Checkpoints ensure incremental validation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "10.1", "10.2", "10.3", "11.2", "11.3", "12.1", "12.3", "13.1", "13.3", "14.1", "14.2", "14.3", "16.1"] },
    { "id": 3, "tasks": ["3.1", "3.3", "5.1", "7.1", "12.2", "13.2", "16.2", "16.3", "10.4", "10.5", "10.6", "10.7", "10.8", "10.9", "10.10", "10.11", "11.7", "11.8", "11.9", "11.10", "11.11", "12.4", "12.6", "13.6", "13.7", "13.9", "14.4", "14.5", "14.6"] },
    { "id": 4, "tasks": ["3.2", "5.2", "6.1", "11.1", "12.5", "13.8", "13.4", "16.4"] },
    { "id": 5, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "5.3", "5.4", "6.2", "6.3", "7.2", "11.4", "11.5", "11.6", "12.7", "13.5", "16.5"] },
    { "id": 6, "tasks": ["6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "7.3", "7.4", "7.5", "7.6", "7.7", "16.6", "16.7", "16.9"] },
    { "id": 7, "tasks": ["7.8", "7.9", "7.10", "7.11", "7.12", "7.13", "7.14", "8.1", "16.8", "16.10", "16.11", "17.1"] },
    { "id": 8, "tasks": ["8.2", "8.3", "17.2", "17.3", "17.4", "17.5"] },
    { "id": 9, "tasks": ["8.4", "8.5", "8.6", "8.7", "16.12", "17.6", "17.7"] },
    { "id": 10, "tasks": ["17.8", "18.1", "19.1"] },
    { "id": 11, "tasks": ["18.2", "19.2", "19.3", "19.4", "19.5"] }
  ]
}
```
