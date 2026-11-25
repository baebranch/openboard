# Export

`export` (action) / `ob.board().export(opts)` renders a board to an image or PDF.

- `format`: `png` (default), `svg`, `jpeg`, `webp`, `pdf`.
- `scope`: `board` (everything), `selection` (with `ids`), `frame` (with `frameId`), `allFrames` (one file per frame).
- Options: `scale` 1 to 4 (raster only), `padding` 0 to 256 units around the content, `background` (`transparent`, `white`, `theme`), `matchTheme`, `embedBoard` (PNG only: embeds the board JSON so the PNG can be re-imported with `import` `source: "png"`).
- With `path` the file is written there (absolute, or relative to the workspace; `allFrames` adds `-1`, `-2`, ... before the extension) and the result lists the paths. Export is unavailable in an untrusted workspace.
- Without `path` the result carries base64 `data` and `mimeType`. In `openboard_execute` prefer `path` (a large result is cut off at about 512 KB); over MCP, image results from `openboard_call` come back as image content.

`board.preview` renders a quick PNG of the whole board or a `region` `{ x, y, width, height }` for visual checks; it is read-only and returns an image.

```js
// openboard_execute
await ob.board().export({ format: "svg", scope: "allFrames", path: "docs/screens.svg" });
```
