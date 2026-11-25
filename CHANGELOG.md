# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-25

### Added

- Slides and presentation mode. Every top-level Frame is a slide, numbered in reading order (component masters only when "Include components" is checked). The Slides panel shows numbered previews; **Present** hides all toolbars and steps through the slides with the arrow keys, Space, Home/End or a typed slide number; **Export PDF** writes every slide into one multi-page PDF.
- Board sidebar at the bottom of the tool palette: **Layers** (a searchable tree of every element), **Slides**, **Components** (masters shown as previews) and a button that shows or hides the sidebar.
- Zoom controls beside the minimap: zoom out, zoom in, reset to 100% and zoom to fit.
- Component instances follow the master's fill, stroke, corner radius and other root styles, also after the master is edited. The instance root can override fill, stroke, opacity and image fill.
- `visible` override: hide a child of an instance (and everything inside it), so one master covers states such as a checkbox on or off, a selected chip or a sold-out ticket.
- Export scope `frames` (`frameIds`, default slide order): each frame cut to its own box, as one multi-page PDF or one file per frame.
- Font family picker that lists the generic families and the fonts installed on the machine, each previewed in its own font.
- Mockup design features. Boards that use none of them behave and export exactly as before.
  - Per-corner radius (`cornerRadii`), text weight and text color, text wrapping with measured sizes, image fills, and frame clipping (`clipContent`).
  - Design tokens for colors and fonts (`tokens`, token references, optional light/dark modes).
  - Components: mark a Frame as a component master, place instances, override text and colors per instance, reset overrides, detach, and "Go to master". Library components create real masters, and a built-in UI kit and device frame presets (phone, tablet, browser) ship with the library.
  - Auto layout on Frames (row or column, gap, padding, alignment) with `fixed`, `hug` and `fill` child sizing, nested Frames, and reflow on resize.
  - An `icon` element type backed by an embedded Icon_Set of 167 icons from [Lucide](https://lucide.dev) (ISC license; some icons derive from Feather, MIT). The icon names are in `docs/icon-list.md` and the notices are in `THIRD_PARTY_NOTICES.md`.
  - New agent actions reachable through `openboard_call` and `ob.call`: `token.{create,update,rename,delete,list,detach,mode}`, `component.{create,remove,list}`, `component.instance.{create,detach}`, `component.instance.override.{set,reset}` and `icon.search`. Existing `element.*` actions accept the new fields.
  - Webview commands: Create Component, Remove Component, Detach Instance, Reset Overrides, Go to master, Move into Frame, Move out of Frame, and an icon picker.
  - Export (SVG, PNG, JPEG, WebP, PDF) renders all of the above through the same SVG renderer as the canvas.

### Changed

- Properties panel redesign: collapsible sections (Position, Dimensions, Auto Layout, Appearance, Text, Fill, Stroke), compact inputs with inline labels, color swatches, icon buttons instead of dropdowns for alignment, wrap, stroke style, routing and layout direction, and a thinner scrollbar. Optional values the element does not store (such as text wrap `none`) now show their default instead of an empty field.
- Selection is a blue box with corner grab points and a size badge; an area selection also outlines each selected element. Connection dots show only on hover.
- Text drawn with the theme default color stays readable on what is behind it (its own fill, a filled shape or Frame beneath it, or the canvas), and explicit text colors directly on the canvas switch to black or white when they would be unreadable after a theme change.
- Instances no longer draw the frame name label above them.
- Copy as PNG is offered only while something is selected and confirms when the image is on the clipboard.
- **Schema version 2.** A board is saved as `schemaVersion` 2 only when it uses a version 2 feature (tokens, token references, components, instances, overrides, `layout`, `sizing`, `ignoreLayout` or `icon`). Boards without them still save as version 1, byte for byte as before. Version 1 files open without a prompt and are not marked modified.
- **Older builds open version 2 boards read-only.** A build that predates this release shows a "created by a newer version" message, rejects saves and leaves the file unchanged. Update the extension to edit these boards. Version 1 boards written by older builds keep the Phase 1 fields (`cornerRadii`, `fontWeight`, `textColor`, `textWrap`, `imageFill`, `clipContent`) unchanged.
- The bundled JSON Schema accepts `schemaVersion` 1 and 2 and rejects any other value.

### Fixed

- Exports started from the board (the Export dialog, Export PDF) now ask where to save; before, the file was not written.
- The Export dialog's dropdowns and buttons were squashed by the toolbar's icon-button style.

### Performance

Medians from `npm run test:perf` on one development machine (Windows, i7-10750H, Node 24). The suite applies a 3x tolerance, so a measurement passes when it is under the limit, not necessarily under the budget.

| Measurement | Median | Budget | Limit (3x) |
| --- | --- | --- | --- |
| Open a 5,000-element mockup board (parse and project) | 120 to 165 ms | 3000 ms | 9000 ms |
| Drag a frame, 50 selected on 5,000 elements (per frame) | 2.5 to 6.5 ms | 33.3 ms | 100 ms |
| Token resolution, 1,000 elements | 0.54 to 1.38 ms | 1 ms | 3 ms |
| Measure 10,000 characters of text | 1.0 to 2.4 ms | 20 ms | 60 ms |
| Wrap toggle on 2,500 texts | 9 to 16 ms | 100 ms | 300 ms |
| Sync and layout, 100 instances of 20 children | 296 ms | 250 ms | 750 ms |
| No-op layout pass, 1,000 elements | 0.09 ms | 5 ms | 15 ms |
| Layout of 200 children | 1.1 ms | 50 ms | 150 ms |
| Resize layout, 500-element subtree | 1.2 ms | 100 ms | 300 ms |

Two results are over budget in some runs and only pass because of the 3x tolerance: token resolution (one run measured a 1.38 ms median against the 1 ms budget; another measured 0.54 ms) and sync plus layout of 100 instances (296 ms against 250 ms). Ranges show two runs on the same machine.

## [0.0.1] - 2026-11-20

### Added

- Initial release: whiteboard custom editor for `*.openboard` files.
- Element types: rectangle, ellipse, diamond, line, arrow, freehand, text, image, frame, sticky.
- Export to PNG, SVG, JPEG, WebP and PDF.
- Five agent tools (`openboard_workspaces`, `openboard_read_skill`, `openboard_execute`, `openboard_call`, `openboard_save`) for Language Model Tools and MCP, a built-in skill, and a sandboxed code mode (QuickJS).
- Bundled MCP stdio server with automatic registration on VS Code 1.101+ and an **OpenBoard: Copy MCP Server Config** command for other agents.
- Exported `{ list, describe, invoke }` API and the `openboard.invokeTool` command.
- JSON Schema validation for `*.openboard` files.

[Unreleased]: https://github.com/openboard-dev/openboard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/openboard-dev/openboard/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/openboard-dev/openboard/releases/tag/v0.0.1
