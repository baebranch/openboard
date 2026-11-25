# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.0.1] - 2026-11-20

### Added

- Initial release: whiteboard custom editor for `*.openboard` files.
- Element types: rectangle, ellipse, diamond, line, arrow, freehand, text, image, frame, sticky.
- Export to PNG, SVG, JPEG, WebP and PDF.
- Five agent tools (`openboard_workspaces`, `openboard_read_skill`, `openboard_execute`, `openboard_call`, `openboard_save`) for Language Model Tools and MCP, a built-in skill, and a sandboxed code mode (QuickJS).
- Bundled MCP stdio server with automatic registration on VS Code 1.101+ and an **OpenBoard: Copy MCP Server Config** command for other agents.
- Exported `{ list, describe, invoke }` API and the `openboard.invokeTool` command.
- JSON Schema validation for `*.openboard` files.

[Unreleased]: https://github.com/openboard-dev/openboard/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/openboard-dev/openboard/releases/tag/v0.0.1
