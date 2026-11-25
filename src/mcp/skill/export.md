# Export

`export` (action) / `ob.board().export(opts)` renders a board to an image or PDF.

- `format`: `png` (default), `svg`, `jpeg`, `webp`, `pdf`.
- `scope`: `board` (everything), `selection` (with `ids`), `frame` (with `frameId`), `allFrames` (one file per frame), `frames` (slides).
- `frames`: each frame is cut to its own box, in `frameIds` order. Without `frameIds` the slide order is used: top-level frames that are not component masters, in reading order (rows top to bottom, then left to right). `format` defaults to `pdf` here, and a PDF is ONE file with one page per frame; other formats write one file per frame. A `frameIds` entry that is not a frame fails with `not_found`; a board without frames fails with `empty-scope`.
- Options: `scale` 1 to 4 (raster only), `padding` 0 to 256 units around the content, `background` (`transparent`, `white`, `theme`), `matchTheme`, `embedBoard` (PNG only: embeds the board JSON so the PNG can be re-imported with `import` `source: "png"`).
- With `path` the file is written there (absolute, or relative to the workspace; `allFrames`, and `frames` in a format other than PDF, add `-1`, `-2`, ... before the extension) and the result lists the paths. Export is unavailable in an untrusted workspace.
- Without `path` the result carries base64 `data` and `mimeType`. In `openboard_execute` prefer `path` (a large result is cut off at about 512 KB); over MCP, image results from `openboard_call` come back as image content.

`board.preview` renders a quick PNG of the whole board or a `region` `{ x, y, width, height }` for visual checks; it is read-only and returns an image.

```js
// openboard_execute
await ob.board().export({ format: "svg", scope: "allFrames", path: "docs/screens.svg" });
// Every slide as one multi-page PDF (slide order), at 2x for sharper pages.
await ob.board().export({ scope: "frames", format: "pdf", scale: 2, path: "docs/deck.pdf" });
```
