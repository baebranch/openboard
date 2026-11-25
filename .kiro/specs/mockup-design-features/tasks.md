# Implementation Plan: Mockup and Design Features

## Overview

This plan implements the mockup and design features in the order the design prescribes: a cross-cutting foundation first, then Phase 1 (visual fidelity primitives), Phase 2 (design tokens), Phase 3 (components and the Derived_Geometry_Pass), Phase 4 (auto layout and nested frames), Phase 5 (icons and device frames), and finally agent/code-mode reachability, localization, accessibility, performance, the full test suite, and documentation.

The implementation language is TypeScript, matching the existing codebase and the design document. Tests use `vitest` and `fast-check`, as the project already does.

Guiding rules for every task:

- Every Mockup_Field is optional. A document that uses none of them must serialize byte-identically and render identically to the pre-feature build (Requirements 1.2, 1.3, 2.9). The guard fixtures from task 1.1 run in every phase.
- Each top-level task group leaves the repository green: `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:manifest`, and `npm run package` must all pass at its checkpoint.
- When a task adds a Mockup_Field, it adds the field's entry to the Field Registry (task 1.2) in the same task. The lockstep test (task 1.3) then covers the schema, parser, and tool normalization automatically.
- When a task adds a user-visible string to the webview, it goes through the `t()` shim from task 1.7. Task 24.1 swaps the shim's backing implementation for `@vscode/l10n`.
- When a task adds an Agent_Tool or a command, it also updates the registry, the generated manifest (`npm run gen:manifest`), and `docs/action-coverage.md` where those exist, so `check:manifest` and `test/action-coverage.test.ts` stay green.

## Tasks

- [x] 1. Cross-cutting foundation
  - [x] 1.1 Capture the non-regression guard fixtures before any behavior changes
    - Add at least three `.openboard` fixtures under `test/fixtures/non-regression/` that use no Mockup_Field (a whiteboard with freehand and text, a flowchart with edges and labels, a frame/sticky/image board with an asset)
    - Generate the expected serializer output and expected SVG export output from the current, unmodified build and store them next to the fixtures
    - Add `test/non-regression.test.ts` asserting byte-identical `serialize()` output after open, edit with a pre-feature operation, and save, and byte-identical `renderToSvg()` output
    - Assert that opening a fixture does not mark the document as modified and shows no error, warning, or migration prompt
    - Confirm the existing property-based tests run unchanged (no assertion edits)
    - _Requirements: 1.2, 1.3, 1.12, 1.13, 1.14, 2.9, 28.6_

  - [x] 1.2 Create the Field Registry and wire it into the known-key lists
    - Create `src/core/model/mockup-fields.ts` with `MockupFieldSpec` (name, location, appliesTo, schemaV2, plus a non-empty `description` and a `valueType` string used later by the schema tool), `MOCKUP_FIELD_SPECS` (empty at this point), `fieldsFor(location, type?)`, and `isSchemaV2Field(name)`
    - Refactor `src/core/format/parser.ts` (`STYLE_KEYS`, `BASE_KEYS`, `TEXT_KEYS`, `TYPE_KEYS`) and `src/core/tools/element-tools.ts` (`STYLE_KEYS`, `DESCRIPTOR_KEYS`, `passthroughKeys`) to concatenate their existing keys with `fieldsFor(...)`, with no behavior change while the registry is empty
    - Export the module from `src/core/model/index.ts`
    - _Requirements: 4.1, 4.5_

  - [x] 1.3 Add the registry lockstep test
    - Create `test/schema/mockup-fields-lockstep.test.ts` that iterates `MOCKUP_FIELD_SPECS` and, for every applicable element type, asserts: the schema from `buildElementSchemas()` lists the field; `attachExtras` does not move the field into an `extra` bag; `normalise` in `element-tools.ts` accepts a valid value and rejects the field with `unknown_property` on a type outside `appliesTo`; and, where the field has a Properties_Panel control, `fieldsFor` in `webview/properties/model.ts` includes it
    - The test passes vacuously while the registry is empty and covers each later field automatically
    - _Requirements: 4.1, 4.5, 28.2_

  - [x] 1.4 Add the schema-version module and make the serializer write the lowest representable version
    - Create `src/core/format/schema-version.ts` with `hasSchemaV2Feature(doc)` and `effectiveSchemaVersion(doc)`; the predicate returns false for every document until the first Schema_V2_Feature ships, and each later field task adds its own clause
    - Change `serialize()` in `src/core/format/serializer.ts` to write `effectiveSchemaVersion(doc)` instead of echoing `doc.schemaVersion`
    - Leave `CURRENT_SCHEMA_VERSION` at 1 for now; task 9.3 raises it to 2 together with the identity migration
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 1.5 Add render cache key plumbing
    - Create `src/core/export/render-key.ts` exporting a pure `renderContextKey(el, ctx)` that combines the resolved token values used by an element, the content hash of any referenced Asset, the ids of clipping ancestors, and the master revision for Instance_Children; each contribution is a no-op value while the corresponding feature is absent
    - Update `svgFor` in `src/webview/canvas/ElementNode.tsx` to compare that key in addition to the existing palette, assets, and endpoints checks, so a context change produces a cache miss while an unchanged element still hits
    - _Requirements: 5.4, 5.5, 5.6_

  - [x] 1.6 Write property test for render cache key completeness
    - **Property 6: Render_Cache key completeness**
    - Generate an element and mutate one JSON leaf of the element, one resolved context value, or the bytes of a referenced Asset, then assert the cache key differs; later phases extend the generator as new fields appear
    - **Validates: Requirements 5.4**

  - [x] 1.7 Add the webview `t()` string shim
    - Create `src/webview/i18n/t.ts` exporting `t(key, ...args)` that looks up a string in a bundle object and falls back to the key text
    - Seed the bundle from `l10n/bundle.l10n.json` through the build so later tasks only add keys; task 24.1 replaces the backing implementation
    - _Requirements: 26.4_

  - [x] 1.8 Write unit tests for schema-version selection and serializer output
    - Assert a document with no Schema_V2_Feature serializes with `schemaVersion` 1 and no Mockup_Field key (including no null, empty, or default-valued key)
    - Assert the serializer output stays byte-identical to the guard fixtures
    - _Requirements: 1.2, 3.1, 3.3_

- [x] 2. Checkpoint - Foundation green
  - Ensure all tests pass, ask the user if questions arise. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:manifest`, and `npm run package`.

- [x] 3. Phase 1a: Per-corner radius
  - [x] 3.1 Add `cornerRadii` to the data layer
    - Add `cornerRadii?: readonly [number, number, number, number]` to `ElementStyle` in `src/core/model/types.ts`
    - Add the field to the style schema in `src/core/schema/elements.ts` (exactly four finite numbers, each at least 0) and add its Field Registry entry (location `style`, applies to rectangle, frame, sticky, flowNode, image)
    - Validate in `element-tools.ts` `normalise`: length four, finite, non-negative, and at most `maxCornerRadius` of the target size; reject with an error naming the property path and element type, leaving the document unchanged
    - On an update that changes `width` or `height` of an element with `cornerRadii`, clamp each value to half of the new shorter side in the same transaction
    - _Requirements: 4.2, 4.6, 4.7, 4.8, 6.1, 6.5, 6.9, 25.1_

  - [x] 3.2 Render per-corner radii
    - Add `cornerPath(el, radii)` to `src/core/export/svg.ts` that emits one closed path with an arc for each corner whose radius is above 0 and a square corner for 0
    - Use it for rectangle, frame, sticky, flowNode, and the image fallback when `style.cornerRadii` is present; keep the existing `rectPath(el, cornerRadius)` path otherwise
    - _Requirements: 1.3, 6.2, 6.3, 6.10_

  - [x] 3.3 Clamp radii in the webview resize gesture
    - Update the resize path in `src/webview/canvas/gestures.ts` and `src/core/shapes/shapes.ts` (`scalePatches`) so the clamp from task 3.1 lands in the same Undo_History entry as the resize
    - _Requirements: 6.9_

  - [x] 3.4 Add the corner fields to the Properties_Panel
    - Add a `corners` field kind to `src/core/properties/descriptors.ts` and `src/webview/properties/model.ts`, plus a view in `PropertiesPanelView.tsx`, showing four corner fields in top-left, top-right, bottom-right, bottom-left order and one linked field
    - A linked-field commit writes `cornerRadius` and removes `cornerRadii`; a single corner commit creates `cornerRadii` from the current `cornerRadius` (or 0) or changes only that corner; each commit is one Undo_History entry
    - Reuse the Agent_Tool validation, show mixed values for differing selections, and show an error indication with the previous value retained on rejection
    - _Requirements: 6.4, 6.6, 6.7, 6.8, 6.11, 6.12, 26.1, 26.6, 26.7, 26.10_

  - [x] 3.5 Document `cornerRadii` in the skill docs
    - Add the field description and one example to `src/mcp/skill/elements.md`
    - _Requirements: 25.9_

  - [x] 3.6 Write property test for corner radius clamp and independence
    - **Property 7: Corner radius clamp and independence**
    - **Validates: Requirements 6.9, 6.11, 6.12**

  - [x] 3.7 Write property test for invalid corner radius rejection
    - **Property 8: Invalid corner radius always rejected**
    - **Validates: Requirements 6.4, 6.5**

  - [x] 3.8 Write unit tests for corner path output and backward compatibility
    - Assert a single closed path with arcs for radii above 0 and square corners for 0, and that an element without `cornerRadii` renders as before
    - _Requirements: 6.2, 6.10, 1.3_

- [x] 4. Phase 1b: Font weight and text color
  - [x] 4.1 Add `fontWeight` and `textColor` to the data layer
    - Add both optional fields to `TextProps` in `types.ts`, the schema (integer 100 to 900 in steps of 100; color forms as `fill`), registry entries (applies to text, sticky, flowNode), and `normalise` validation
    - _Requirements: 4.2, 4.6, 4.7, 4.8, 7.1, 7.4, 25.1_

  - [x] 4.2 Render weight and text color
    - Update `renderText` and its five call sites in `svg.ts`: emit `font-weight`, use `max(700, fontWeight ?? 400)` for bold runs, pass `el.textColor ?? el.style.stroke` as the text color, and keep the shape stroke driven by `style.stroke` only
    - _Requirements: 1.4, 1.5, 7.2, 7.3, 7.5, 7.11, 7.12_

  - [x] 4.3 Add the theme default text color and theme-change remap
    - Update `src/core/theme` and `src/webview/theme/ThemeAdapter.ts` so new Text_Bearing_Elements get a default text color meeting 4.5:1 contrast in light, dark, and high-contrast themes
    - Remap a `textColor` of "theme default" within 500 ms of a theme kind change and leave explicit colors unchanged
    - _Requirements: 7.9, 7.10_

  - [x] 4.4 Add weight and text color controls to the Properties_Panel
    - Add a font weight enum control and a text color control; committing text color writes only `textColor`, and changing stroke on an element with `textColor` leaves `textColor` unchanged
    - Reject non-integer, empty, or out-of-step weights, retain the previous value, and show an error indication
    - _Requirements: 7.6, 7.7, 7.8, 26.1, 26.6, 26.7, 26.10_

  - [x] 4.5 Document `fontWeight` and `textColor` in the skill docs
    - _Requirements: 25.9_

  - [x] 4.6 Write property test for text weight resolution
    - **Property 9: Text weight resolution**
    - **Validates: Requirements 7.2, 7.3, 7.11**

  - [x] 4.7 Write property test for text color and stroke independence
    - **Property 10: Text color and stroke color independence**
    - **Validates: Requirements 7.6, 7.7, 7.12**

  - [x] 4.8 Write unit tests for theme contrast and remap
    - Assert the 4.5:1 ratio for the four theme kinds and the remap and no-remap cases
    - _Requirements: 7.9, 7.10_

- [x] 5. Phase 1c: Text_Measurer and text wrapping
  - [x] 5.1 Implement the Text_Measurer
    - Create `src/core/text/measure.ts` with `measure(input): MeasureOutcome`, a synthetic glyph-width table for printable ASCII, a 1.0em fallback for other characters, explicit-newline splitting, greedy whitespace wrapping, character-level breaking of overlong words, and one character per line when the width is narrower than a character
    - Return an error outcome for a font size that is not a finite number above 0 or an available width that is not finite (or `Infinity`); use the same 1.2 line height as `renderText`
    - Export it from `src/core/text/index.ts`; no DOM, canvas, or font access
    - _Requirements: 8.2, 8.3, 8.5, 8.12, 8.13_

  - [x] 5.2 Add `textWrap` to the data layer
    - Add the optional `textWrap: 'none' | 'wrap'` to `TextProps`, the schema, a registry entry (applies to text, sticky, flowNode), and `normalise`
    - _Requirements: 4.2, 4.6, 4.7, 4.8, 8.1, 25.1_

  - [x] 5.3 Render wrapped text
    - Extend `renderText` in `svg.ts` to call `measure()` when `textWrap` is `wrap`, using the element width minus the text padding, and re-slice the `TextRun[]` at the break offsets so bold, italic, and underline survive a split run
    - Draw every wrapped line without clipping, including lines below the element bottom; keep newline-only breaking when `textWrap` is absent or `none`
    - _Requirements: 1.6, 8.4, 8.6, 8.12_

  - [x] 5.4 Align the editing overlay with the Renderer
    - Update `src/webview/editing/EditingLayer.tsx` and `caret.ts` to use `measure()` and render the pre-broken lines when the edited element has `textWrap` of `wrap`, driving caret positions from the same line model; leave the native textarea flow when wrap is off
    - _Requirements: 8.8, 8.9_

  - [x] 5.5 Add the text wrap control to the Properties_Panel
    - _Requirements: 26.1, 26.6, 26.7, 26.10_

  - [x] 5.6 Document `textWrap` and the Text_Measurer in the skill docs
    - _Requirements: 25.9_

  - [x] 5.7 Write property test for Text_Measurer round trip
    - **Property 11: Text_Measurer round trip**
    - Put it in `src/core/text/measure.property.test.ts`
    - **Validates: Requirements 8.10**

  - [x] 5.8 Write property test for width monotonicity
    - **Property 12: Text_Measurer width monotonicity (metamorphic)**
    - Put it in `src/core/text/measure.monotonic.test.ts`
    - **Validates: Requirements 8.11**

  - [x] 5.9 Write unit tests for the Text_Measurer
    - Cover explicit newlines, overlong words, one-character-per-line, invalid input errors, and the 20 ms budget for 10,000 characters
    - _Requirements: 8.3, 8.5, 8.7, 8.13_

- [x] 6. Phase 1d: Image fill
  - [x] 6.1 Add `imageFill` to the data layer
    - Add `imageFill?: { assetId: AssetId; fit: 'cover' | 'contain' | 'stretch' }` to `ElementStyle`, the schema, a registry entry (applies to rectangle, ellipse, diamond, frame, sticky, flowNode), and `normalise`; a dangling asset id is valid
    - _Requirements: 4.2, 4.6, 4.7, 4.8, 9.1, 9.9, 25.1_

  - [x] 6.2 Track asset references from `imageFill` and gate assets in the canvas projection
    - Update asset reference collection so the serializer stores each Asset once and omits unreferenced Assets whether referenced by an image element, Library entry, or `imageFill`
    - Update `src/webview/canvas/project.ts` so elements with `imageFill` receive the assets they need and the render key includes the asset content
    - _Requirements: 5.4, 5.8, 9.8_

  - [x] 6.3 Render image fills
    - In `svg.ts`, add a pure fit-geometry function in `src/core/image/fit.ts` for `cover`, `contain`, and `stretch`, and paint the image over the fill inside a per-element `<clipPath>` that matches the exact outline (corner radii or ellipse)
    - Fall back silently to the fill color when the Asset is missing or cannot be decoded; render SVG assets as image resources with no script and no remote loads
    - _Requirements: 5.2, 5.8, 9.2, 9.3, 9.4, 9.5, 9.9, 9.10, 9.11, 1.7_

  - [x] 6.4 Apply and remove image fills from the Properties_Panel
    - Add an `imageFill` control with file, drop, and clipboard input that reuses the image type, size, and decoding rules of Base Requirement 7, sets fit `cover`, and rejects invalid input while leaving the existing fill unchanged
    - Add a fit mode control and a remove action that deletes `imageFill`
    - _Requirements: 9.6, 9.7, 9.12, 26.1, 26.6, 26.10_

  - [x] 6.5 Document `imageFill` in the skill docs
    - _Requirements: 25.9_

  - [x] 6.6 Write property test for image fill fit geometry
    - **Property 13: Image fill fit-mode geometry**
    - **Validates: Requirements 9.3, 9.4, 9.5**

  - [x] 6.7 Write property test for asset deduplication
    - **Property 14: Asset deduplication round trip**
    - **Validates: Requirements 9.8**

  - [x] 6.8 Write property test for missing image references
    - **Property 15: Missing image reference never throws**
    - **Validates: Requirements 9.9, 9.10**

- [x] 7. Phase 1e: Frame clipping
  - [x] 7.1 Add `clipContent` to the data layer
    - Add the optional boolean to `FrameProps`, the schema, a registry entry (applies to frame), and `normalise`
    - _Requirements: 4.2, 4.6, 4.7, 4.8, 10.1, 25.1_

  - [x] 7.2 Render clipping with nested composition
    - Build a `parentId` index in the render context; emit a `<clipPath>` per clipping Frame whose own definition references the nearest clipping ancestor, and wrap each descendant in `clip-path` pointing at its nearest clipping ancestor; draw Edges without clipping
    - _Requirements: 1.8, 10.2, 10.4, 10.5, 10.6, 10.8_

  - [x] 7.3 Ignore pointer hits outside a clipping Frame
    - Update hit testing in the canvas projection and selection code so a hit on a clipped part of a descendant falls through to the next visible element or the background
    - _Requirements: 10.3_

  - [x] 7.4 Verify nested clip rendering empirically in the rasterizer
    - Add a test that exports an SVG with two nested clipping Frames through `src/webview/export/rasterizer.ts` (and the PDF path that wraps its output) and inspects pixels outside the intersection
    - If the engine does not honor `clip-path` on `<clipPath>`, change `svg.ts` to wrap each nesting level in its own `<g clip-path>` instead, and record the finding in a code comment
    - _Requirements: 10.4, 10.5, 5.3_

  - [x] 7.5 Add the clip content toggle to the Properties_Panel
    - One commit is one Undo_History entry and undo restores the previous value
    - _Requirements: 10.7, 26.1, 26.6_

  - [x] 7.6 Document `clipContent` in the skill docs
    - _Requirements: 25.9_

  - [x] 7.7 Write property test for nested clip intersection
    - **Property 16: Nested clip intersection**
    - **Validates: Requirements 10.2, 10.5, 10.8**

  - [x] 7.8 Write unit tests for clip export in every format
    - Assert SVG, PNG, JPEG, WebP, and PDF contain no descendant pixel outside the Frame shape
    - _Requirements: 10.4, 10.6_

- [x] 8. Checkpoint - Phase 1 green
  - Ensure all tests pass, ask the user if questions arise. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:manifest`, and `npm run package`, and confirm the non-regression fixtures from task 1.1 still pass.

- [x] 9. Phase 2: Design tokens
  - [x] 9.1 Implement the pure token module
    - Create `src/core/tokens/types.ts` (`TokenCollection`), name validation (1 to 64 characters from letters, digits, hyphen, underscore, period), value validation per category, `resolveTokens`, and reference scan/rewrite helpers used by rename, delete, and detach
    - _Requirements: 11.1, 11.2, 11.3, 11.18_

  - [x] 9.2 Add tokens to the data layer
    - Add `tokens?: TokenCollection` to `BoardDocument`, the `token:${string}` variant to `Color`, the root schema entry (at most 500 tokens per category, no Token_Reference as a Token value), parser handling that preserves unknown nested properties, and registry entries; accept token references in color fields and `fontFamily` in `normalise`
    - _Requirements: 4.1, 4.4, 11.1, 11.3, 11.4, 11.5, 25.1_

  - [x] 9.3 Raise the schema version and register the migration
    - Set `CURRENT_SCHEMA_VERSION` to 2 in `src/core/model/ranges.ts`, register the identity migration in `migrations.ts`, add the tokens clause to `hasSchemaV2Feature`, and make `scripts/build-schemas.mjs` publish `schemaVersion: { enum: [1, 2] }`
    - Update the existing migration tests whose expectations are superseded by Requirement 3.3 and keep the guard fixtures passing
    - _Requirements: 1.13, 3.3, 3.4, 3.5, 3.6, 3.9, 11.14_

  - [x] 9.4 Add the token Tx surface and invariants
    - Add token create, update, rename, and delete operations to `Draft` in `src/core/ops/model.ts`, and a defense-in-depth duplicate-name and limit check in `invariants.ts`
    - _Requirements: 11.2, 11.7, 11.8_

  - [x] 9.5 Implement the token tools
    - Create `src/core/tools/token-tools.ts` with `openboard.token.create`, `update`, `rename`, `delete`, `list`, and a detach action; rename rewrites every reference in elements, overrides, and Library entries in one transaction; delete is rejected with the reference count while references exist; invalid names and values are rejected without changes
    - Register them in the registry with input and output schemas
    - _Requirements: 11.7, 11.8, 11.10, 11.11, 11.17, 11.18, 25.2_

  - [x] 9.6 Resolve tokens in the Renderer and the canvas
    - Add resolved tokens to the render context in `svg.ts`, resolve `token:` in `colorOf` and `fontFamily` with the field default for a missing token, export resolved literals only, and pass tokens through `project.ts` and `ElementNode.tsx` so a value change re-renders every user within 500 ms
    - _Requirements: 5.4, 5.5, 5.7, 11.4, 11.5, 11.6, 11.9_

  - [x] 9.7 Carry tokens through the Library
    - Update `src/core/tools/library-tools.ts` so saving records the tokens an entry references and inserting adds missing tokens with the recorded values, keeping existing values, in the same Undo_History entry as the insertion
    - _Requirements: 11.13, 16.3_

  - [x] 9.8 Add token apply, detach, and missing-token marking to the Properties_Panel
    - Add `tokenColor` and `tokenFont` field kinds with a token picker, a detach action, and a "missing token" mark that leaves the board usable
    - _Requirements: 11.9, 11.12, 11.17, 26.1, 26.6_

  - [x] 9.9 Document tokens in the skill docs
    - _Requirements: 25.9_

  - [x] 9.10 Implement token modes (optional, later)
    - Allow a color Token to hold a light and dark value, add `activeMode` to settings with `auto` as the default, resolve through the IDE theme kind when `auto`, add the export mode option, and record mode changes as one Undo_History entry
    - Allow number tokens in layout gap, padding, corner radius, and font size fields (Requirement 11.15) once layout exists
    - _Requirements: 11.15, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 9.11 Write property test for token uniqueness and collection round trip
    - **Property 17: Token name uniqueness and collection round trip**
    - **Validates: Requirements 11.1, 11.2, 11.16**

  - [x] 9.12 Write property test for token update isolation
    - **Property 18: Token update isolation**
    - **Validates: Requirements 11.7**

  - [x] 9.13 Write property test for token delete and detach invariants
    - **Property 19: Token delete/detach invariants**
    - **Validates: Requirements 11.9, 11.10, 11.17**

  - [x] 9.14 Write unit tests for token tools
    - Cover duplicate names, invalid names, Token_Reference as a value, rename rewriting, and Library carry-over
    - _Requirements: 11.8, 11.11, 11.13, 11.18_

- [x] 10. Checkpoint - Phase 2 green
  - Ensure all tests pass, ask the user if questions arise. Run the full gate (`typecheck`, `lint`, `test`, `check:manifest`, `package`) and confirm a Schema_Version 1 fixture still saves as version 1.

- [x] 11. Phase 3a: Component data model, Sync_Pass, and the Derived_Geometry_Pass
  - [x] 11.1 Add the component data model
    - Add `component`, `instanceOf`, and `overrides` to `FrameProps`, `Override` in `src/core/components/types.ts` (key `''` for the instance root size), schema, parser, registry entries, schema-version clauses, and `normalise` validation of Overridable_Property values
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8, 13.1, 14.2, 14.16, 25.1_

  - [x] 11.2 Implement the pure Sync_Pass
    - Create `src/core/components/sync.ts` with `syncPass(doc)`: build a master-to-descendants index once, expand each Component_Instance from its master and overrides with ids `<instanceId>::<masterChildId>` and origin-offset positions, create missing Instance_Children, replace existing ones in place to keep stacking order, delete orphaned ones (cascading Edges), leave User_Children untouched, and treat an unknown master as an ordinary Frame
    - Throw `ComponentCycleError` and `ComponentDepthError` naming the implicated masters for a cycle or a chain longer than 8 levels
    - _Requirements: 14.2, 14.3, 14.10, 14.11, 14.12, 14.13, 14.17, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.14_

  - [x] 11.3 Add the Derived_Geometry_Pass module
    - Create `src/core/ops/derived-geometry.ts` with `needsDerivedPass`, `runDerivedGeometryPass` over a list of pass functions (Sync_Pass only for now), a shared `diffElements` utility that emits the same replace patches `Draft.update` produces, a 10-iteration cap, and `DerivedGeometryError`; the pass treats locked elements like unlocked ones
    - _Requirements: 18.2, 18.5, 18.6, 18.8, 18.14_

  - [x] 11.4 Hook the pass into `BoardModel.transact`
    - In `src/core/ops/model.ts`, run the pass between `draft.finish()` and `checkInvariants`, concatenate patches as `[edit, derived]` and inverse patches as `[derived inverse, edit inverse]`, skip the pass when `needsDerivedPass` is false, and expose `takeLastDerivedIds()`
    - A thrown pass error aborts the whole transaction with no change to the document, Undo_History, or subscribers; undo and redo must not re-run the pass
    - _Requirements: 18.1, 18.3, 18.4, 18.7, 18.12, 18.13_

  - [x] 11.5 Report derived geometry changes from the registry
    - In `src/core/tools/registry.ts`, attach `geometryChanges: { count, ids, truncated }` (ids ascending, at most 500) to successful write tool results; in `batch-tool.ts` and `session.ts`, read the ids per sub-step so reads after an earlier batch step see derived geometry
    - _Requirements: 18.9, 18.10, 18.11_

  - [x] 11.6 Guard Instance_Children and capture overrides in `Draft`
    - In `Draft`, reject moves, resizes, deletes, reparenting, shape changes, and non-overridable property edits of an Instance_Child with an error that says the instance must be detached; translate an edit of an Overridable_Property of an Instance_Child, or of an instance root size, into an Override on its Component_Instance
    - Add invariant checks that `component` and `instanceOf` are mutually exclusive on a Frame
    - _Requirements: 13.4, 14.4, 14.5, 14.6_

  - [x] 11.7 Sync on load without spurious modification
    - In `src/host/editor/state.ts`, apply the Sync_Pass when a loaded document has a missing, extra, or differing Instance_Child and mark the document modified; leave it unmodified when no difference exists; on a component cycle open without syncing and show an error naming every master in the cycle
    - _Requirements: 15.10, 15.11, 15.13, 1.14_

  - [x] 11.8 Write property test for Sync_Pass model-based correctness
    - **Property 21: Sync_Pass model-based correctness**
    - **Validates: Requirements 14.2, 14.3, 15.2, 15.3, 15.5, 15.14**

  - [x] 11.9 Write property test for Sync_Pass idempotence
    - **Property 22: Sync_Pass idempotence**
    - **Validates: Requirements 15.6, 28.3**

  - [x] 11.10 Write property test for Derived_Geometry_Pass termination
    - **Property 23: Derived_Geometry_Pass termination**
    - **Validates: Requirements 15.7, 18.6, 18.7, 28.3**

  - [x] 11.11 Write property test for one undo entry and pass idempotence
    - **Property 24: One undo entry, pass idempotence**
    - **Validates: Requirements 18.3, 18.5**

  - [x] 11.12 Write property test for undo and redo exactness around the pass
    - **Property 25: Undo/Redo exactness around the pass**
    - **Validates: Requirements 18.12, 18.13, 28.4**

- [x] 12. Phase 3b: Component tools and copy, paste, and delete semantics
  - [x] 12.1 Implement component create, remove, and list
    - Create `src/core/components/names.ts` with `uniqueComponentName` and `src/core/tools/component-tools.ts` with `openboard.component.create` (single Frame, or non-Frame selection wrapped in a new Frame at the union bounds), `remove`, and `list` (sorted by name); validate name length after trimming, uniqueness, selection shape, and the instance case before any mutation
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.6, 13.7, 13.12, 13.13, 13.14, 25.3_

  - [x] 12.2 Implement the instance tools
    - Add `openboard.component.instance.create`, `override.set`, `override.reset`, and `detach` to `component-tools.ts` and register them; reject any action that would create a component cycle or a chain over 8 levels with the document and history unchanged; reset with no matching override changes nothing; detach on a non-instance is rejected
    - _Requirements: 14.1, 14.4, 14.5, 14.8, 14.12, 14.13, 15.8, 15.9, 15.12, 25.3, 25.13_

  - [x] 12.3 Remap components on copy, paste, duplicate, and delete
    - Extend `cloneElements` and the duplicate and paste paths in `arrange-tools.ts` so a duplicated or pasted master gets new ids and a unique name, existing instances stay linked to the original, an instance pasted with its master points at the pasted master, an instance copied in the same document keeps its overrides and gets derived child ids, and an instance pasted without its master becomes an ordinary Frame with former Instance_Children converted to ordinary elements
    - In `Draft.remove`, deleting a master detaches its instances in the same transaction; moving an instance moves its Instance_Children and User_Children by the same offset
    - _Requirements: 13.8, 13.9, 13.10, 14.7, 14.14, 14.15_

  - [x] 12.4 Write property test for component name de-duplication
    - **Property 20: Component name de-duplication**
    - **Validates: Requirements 13.9**

  - [x] 12.5 Write unit tests for component tools
    - Cover each rejection path (empty name, over 100 characters, duplicate name, mixed selection, instance as master), detach, reset, and the cycle and depth rejections
    - _Requirements: 13.3, 13.4, 13.13, 13.14, 14.12, 14.13_

- [x] 13. Phase 3c: Library integration, built-in UI kit, and component UI
  - [x] 13.1 Integrate components with the Library
    - Update `library-tools.ts` and `src/core/library/index.ts` so saving a master stores it with the masters its instances depend on and the tokens it references; inserting creates the master at least 100 units from existing content plus one instance at the viewport center, or only an instance when the master already exists; plain-element entries insert as before; later Library edits never change inserted masters; a missing or inconsistent entry fails with no change and no history entry
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.12, 16.13, 16.14, 25.3_

  - [x] 13.2 Convert the built-in UI kit to masters
    - Change button, input field, card, and navigation bar in `src/core/library/builtins.ts` into Component_Masters whose colors and fonts reference seeded tokens; keep the device outline component unchanged
    - _Requirements: 2.15, 16.5, 16.6, 16.7, 16.8, 24.10_

  - [x] 13.3 Add component controls and canvas indicators
    - Add a component name control, "Detach Instance", "Reset Overrides", "Go to master", an Override indicator, and a "master missing" indication to the Properties_Panel; show a master indicator on the canvas that never appears in exports; "Go to master" selects the master and brings it into view
    - _Requirements: 13.5, 14.9, 14.11, 14.18, 14.19, 26.9_

  - [x] 13.4 Add component commands and context menu entries
    - Add "Create Component", "Remove Component", "Detach Instance", "Reset Overrides", and "Go to master" to `src/webview/palette/contextMenu.ts`, enabled only when the selection satisfies the matching tool's preconditions; add the commands to the contribution source and regenerate the manifest with `npm run gen:manifest`
    - _Requirements: 26.8, 26.11_

  - [x] 13.5 Add the component panel and its palette control
    - Create `src/webview/panel/ComponentPanel.tsx` listing masters alphabetically with a "Go to master" action that adds no history entry, an empty state, and a refresh within 500 ms of changes; add the Tool_Palette control that opens it
    - _Requirements: 13.6, 26.2_

  - [x] 13.6 Add the "Exclude component masters" export option (optional)
    - Filter masters, their descendants, and attached connectors before scope selection, compute bounds from the remaining elements, produce one file per non-master Frame for the all-Frames scope, and abort with the nothing-to-export message when the scope is empty
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [x] 13.7 Document components, tokens, and the Library in the skill docs
    - Update `src/mcp/skill/library.md`, `elements.md`, and `editing.md` with masters, instances, overrides, detach, and the derived geometry behavior
    - _Requirements: 25.9_

  - [x] 13.8 Write unit tests for Library integration
    - Cover first insert, repeat insert, nested master dependencies, token carry-over, and failure with no partial entry
    - _Requirements: 16.1, 16.2, 16.3, 16.13, 16.14_

  - [x] 13.9 Extend the built-in kit with checkbox, toggle, avatar, and badge (optional, later)
    - _Requirements: 16.11_

- [x] 14. Checkpoint - Phase 3 green
  - Ensure all tests pass, ask the user if questions arise. Run the full gate and confirm the guard fixtures, which contain no instances or layouts, still produce zero derived patches.

- [x] 15. Phase 4a: Nested frames
  - [x] 15.1 Add nesting guards
    - Add `frameNestingDepth` and `wouldCreateFrameCycle` to `src/core/shapes/shapes.ts` and apply them in `element.update`, create, paste, and Library insertion: the new parent must be an existing Frame, no Frame becomes its own ancestor, and no Frame exceeds depth 16 including Frames below a moved Frame; reject the whole edit with the document and history unchanged
    - Keep creation-time adoption unchanged (only non-Frame elements fully inside the new Frame become children)
    - _Requirements: 21.1, 21.5, 21.6, 21.10, 2.14_

  - [x] 15.2 Add "Move into Frame" and "Move out of Frame"
    - Add both actions to `arrange-tools.ts`, skipping elements whose ancestor is also selected; add context menu entries and commands, then regenerate the manifest
    - _Requirements: 21.2, 21.3, 26.8, 26.11_

  - [x] 15.3 Drop a selection onto a Frame or Layout_Frame
    - Update `src/webview/canvas/gestures.ts` so a drop sets the target as `parentId` of each dropped element, including Frames, as one Undo_History entry
    - _Requirements: 21.4_

  - [x] 15.4 Delete a Frame without deleting nested Frames
    - Update `Draft.remove` so deleting a Frame clears `parentId` of its direct children only, keeps them in place, and leaves deeper descendants unchanged
    - _Requirements: 21.8_

  - [x] 15.5 Export scopes for nested Frames
    - Update `src/core/export/scope.ts` so the all-Frames scope produces one file per Frame with no Frame parent and the single-Frame scope accepts any Frame
    - _Requirements: 21.9_

  - [x] 15.6 Write property test for the Frame move cascade
    - **Property 30: Frame move cascade**
    - **Validates: Requirements 21.7**

  - [x] 15.7 Write property test for nested-frame edit rejection
    - **Property 31: Nested-frame edit rejection invariant**
    - **Validates: Requirements 21.6**

  - [x] 15.8 Write unit tests for nesting behavior
    - Cover depth 16, self-ancestor, non-Frame parent, move into and out of, and creation-time adoption leaving existing Frames alone
    - _Requirements: 21.1, 21.2, 21.3, 21.6, 21.10_

  - [x] 15.9 Document nested Frames in the skill docs
    - _Requirements: 25.9_

- [x] 16. Phase 4b: Stack layout, sizing, and the Layout_Pass
  - [x] 16.1 Add layout and sizing to the data layer
    - Create `src/core/layout/types.ts` (`SizingMode`, `MainAxisAlign`, `CrossAxisAlign`, `LayoutConfig`); add `layout` to `FrameProps` and `sizing` and `ignoreLayout` to `ElementBase`; add schema, parser, registry entries, schema-version clauses, and `normalise` range validation (gap and padding 0 to 1,000, finite numbers, allowed enum values) with errors that name the property path
    - _Requirements: 4.2, 4.6, 4.7, 4.8, 19.1, 19.10, 19.12, 20.1, 25.1_

  - [x] 16.2 Implement `arrangeStack`
    - Create `src/core/layout/stack.ts`: order children by main-axis center with stored order as the tie-break, place for `start`, `center`, `end`, and `spaceBetween`, align on the cross axis, place overflow from the start padding edge, ignore `ignoreLayout` children and rotation, and round to 2 decimals
    - Keep the existing flowchart `autoLayout.ts` untouched
    - _Requirements: 2.5, 19.2, 19.3, 19.4, 19.5, 19.6, 19.14, 19.16, 20.14_

  - [x] 16.3 Implement `runLayoutPass`
    - Create `src/core/layout/index.ts`: resolve `hug` bottom-up (Layout_Frames and Text_Bearing_Elements through the Text_Measurer), resolve `fill` and positions top-down, apply the evaluation-time degradation rules for `fill` outside a Layout_Frame, `fill` in a `hug` parent, and `hug` on unsupported elements without changing stored `sizing`, keep the current size when the Text_Measurer fails, and collect `changedIds`
    - _Requirements: 19.5, 19.15, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.12, 20.13, 20.14, 22.6_

  - [x] 16.4 Register the Layout_Pass in the Derived_Geometry_Pass
    - Add `runLayoutPass` after `syncPass` in `derived-geometry.ts`, extend `needsDerivedPass` to Layout_Frames, and make a layout failure abort the transaction and surface an error notification that the layout could not be computed
    - _Requirements: 18.2, 18.6, 19.15, 20.11, 22.1, 22.2, 22.3, 22.5, 22.10_

  - [x] 16.5 Write property test for the layout placement algebra
    - **Property 26: Layout_Pass placement algebra**
    - **Validates: Requirements 19.2, 19.3, 19.4, 19.5, 19.6**

  - [x] 16.6 Write property test for sizing resolution
    - **Property 27: Sizing resolution formulas**
    - **Validates: Requirements 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9**

  - [x] 16.7 Write property test for layout idempotence and determinism
    - **Property 28: Layout_Pass idempotence and determinism**
    - Run twice in-process and compare serialized forms; cross-bundle equality is covered by task 27.10
    - **Validates: Requirements 22.6, 22.7, 28.8**

  - [x] 16.8 Write property test for fixed-children containment
    - **Property 29: Fixed-children containment**
    - **Validates: Requirements 22.8**

  - [x] 16.9 Write unit tests for layout behavior
    - Cover empty Frames, spaceBetween with one child, overflow, hug on the main and cross axis, reflow when a child is added or removed, text edits, ancestor propagation, locked elements, and Edge re-routing after a layout change
    - _Requirements: 2.8, 19.7, 19.8, 19.15, 22.2, 22.3, 18.14_

- [x] 17. Phase 4c: Layout UI, resize and drag behavior, and kit layout
  - [x] 17.1 Add layout and sizing controls to the Properties_Panel
    - Add a `layout` composite control (direction, gap, padding, alignments) with enable and disable actions: enabling writes the defaults (horizontal, gap 0, padding 0, start and start) and arranges children as one Undo_History entry, even for an empty Frame; disabling removes `layout` and leaves children where they are
    - Add a `sizing` control with width and height segments of fixed, hug, and fill, whose change is one Undo_History entry including the reflow; reject invalid values with an error indication and the previous value retained
    - _Requirements: 19.8, 19.9, 20.11, 26.1, 26.6, 26.7, 26.10_

  - [x] 17.2 Make resizing a hug axis switch it to fixed
    - Update the resize gesture so resizing a Layout_Frame on a `hug` axis writes the chosen size and sets that axis to `fixed` in one `element.update`; confirm resizing a Layout_Frame cascades through the pass and resizing a Frame with no `layout` leaves children untouched
    - _Requirements: 1.9, 20.10, 22.1, 22.4_

  - [x] 17.3 Reorder children by dragging inside a Layout_Frame
    - Update the drag-release commit in `gestures.ts` so the move and the reflow (including an unchanged order) are one Undo_History entry
    - _Requirements: 19.11_

  - [x] 17.4 Give the built-in UI kit Auto Layout
    - Update `builtins.ts` so the kit masters use layout and hug sizing, and changing instance text resizes the instance as one Undo_History entry
    - _Requirements: 16.9, 16.10_

  - [x] 17.5 Add the `ignoreLayout` control (optional, later)
    - Add the Properties_Panel control for children of a Layout_Frame
    - _Requirements: 19.14, 26.1_

  - [x] 17.6 Document layout and sizing in the skill docs
    - _Requirements: 25.9_

  - [x] 17.7 Write DOM tests for the layout and sizing controls
    - Cover enable and disable, defaults, mixed values, and rejected input
    - _Requirements: 19.8, 19.9, 26.7, 26.10_

- [x] 18. Checkpoint - Phase 4 green
  - Ensure all tests pass, ask the user if questions arise. Run the full gate and confirm a document with no instances or layouts still completes the derived pass check with zero patches.

- [x] 19. Phase 5a: Icon set
  - [x] 19.1 Generate the curated Lucide subset
    - Add `lucide-static` as a devDependency with an exact pinned version, a hand-maintained curated name list of at least 100 icons, and `scripts/gen-icon-set.mjs` that writes `src/core/icons/icon-set.ts` (`ICON_PATHS`, `ICON_KEYWORDS`, `PLACEHOLDER_ICON_PATH`) plus a pure `searchIcons(keyword)` returning at most 50 alphabetical matches by name or keyword, case-insensitive
    - _Requirements: 23.2, 23.10_

  - [x] 19.2 Package the license and document the icon list
    - Add `THIRD_PARTY_NOTICES.md` with the Lucide ISC license text, extend `.vscodeignore` so `vsce package` includes it, and generate the documented list of included icon names under `docs/`
    - _Requirements: 23.2, 23.11_

  - [x] 19.3 Enforce the bundle size budget
    - Add a test that bundles and minifies the icon module through esbuild and asserts the increase is no more than 153,600 bytes
    - _Requirements: 23.2_

  - [x] 19.4 Write unit tests for icon search
    - Cover name and keyword matches, case-insensitivity, the 50 result cap, alphabetical order, and the empty result
    - _Requirements: 23.7, 23.10_

- [x] 20. Phase 5b: Icon element end to end
  - [x] 20.1 Add the `icon` element type to the data layer
    - Add `'icon'` to `ELEMENT_TYPES`, `IconProps`, `IconElement`, schema, parser type keys, a registry entry for `name`, the schema-version clause, `normalise` validation (1 to 64 characters; any name outside the Icon_Set is valid and preserved), and creation defaults of 24 by 24 and stroke width 2
    - Update `test/element-types.test.ts` and any exhaustive switches that the compiler flags
    - _Requirements: 4.1, 4.2, 4.6, 23.1, 23.3, 23.12, 23.13, 23.14, 23.15, 25.1_

  - [x] 20.2 Render icons
    - Add the `icon` case to `renderElement` in `svg.ts`: scale the 24-unit path to the element size with `vector-effect="non-scaling-stroke"`, use the element stroke color and width, use the placeholder glyph for an unknown name, and use no external reference and no `foreignObject`
    - _Requirements: 5.2, 23.4, 23.5, 23.6_

  - [x] 20.3 Add the icon search tool
    - Create `src/core/tools/icon-tools.ts` with `openboard.icon.search` and register it with input and output schemas
    - _Requirements: 23.10, 25.3_

  - [x] 20.4 Add the Icon tool and picker to the palette
    - Add the 14th palette tool (`icon`, shortcut `K`) to `src/webview/palette/tools.ts`, an icon picker component, and click-to-place that centers a 24 by 24 icon on the click; update `ToolPalette.dom.test.tsx` for the new count; keep exactly one active tool
    - _Requirements: 2.1, 23.3, 23.8, 26.2_

  - [x] 20.5 Add the icon name control to the Properties_Panel
    - Add an `icon` field kind with a filterable picker that updates within 100 ms of each keystroke and shows a no-match indication
    - _Requirements: 23.7, 26.1_

  - [x] 20.6 Support icon name overrides in instances
    - Map the `icon` Override key to the Instance_Child `name` in the expansion, add the override affordance for icons in the Properties_Panel, and confirm the master and other instances stay unchanged
    - _Requirements: 14.4, 23.9_

  - [x] 20.7 Document icons in the skill docs
    - _Requirements: 25.9_

  - [x] 20.8 Write property test for icon name round trip and safe rendering
    - **Property 32: Icon name round trip and safe rendering**
    - **Validates: Requirements 23.6, 23.13, 23.14, 23.15**

  - [x] 20.9 Write unit tests for icon behavior
    - Cover placeholder glyphs, creation defaults, stroke width independence from size, and presence in SVG, PNG, JPEG, WebP, and PDF output
    - _Requirements: 23.3, 23.4, 23.5, 23.6_

- [x] 21. Phase 5c: Device frame presets
  - [x] 21.1 Add the three device presets
    - Add phone (390 by 844), tablet (820 by 1180), and browser (1440 by 900) Component_Masters to `builtins.ts` with `clipContent` on the root, corner radii above 0 on all four corners (phone and tablet) or the top two (browser), and icons only for status and toolbar glyphs; insertion uses the library flow of task 13.1 with the instance sized at the preset dimensions
    - Keep the existing device outline and Frame size presets unchanged
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.10_

  - [x] 21.2 Verify User_Children and clipping inside device instances
    - Make sure an element added inside a preset instance is stored as a User_Child and that the clip ancestor index covers Instance_Child and User_Child descendants, fixing `svg.ts` if needed, without changing stored geometry
    - _Requirements: 24.7, 24.8_

  - [x] 21.3 Handle preset insertion failure
    - On failure, show an insertion error and leave no master or instance added
    - _Requirements: 24.9_

  - [x] 21.4 Write unit tests for the device presets
    - Assert exact dimensions, flags, icon-only glyphs, User_Child storage, and clipping of overflow
    - _Requirements: 24.2, 24.3, 24.4, 24.5, 24.7, 24.8_

  - [x] 21.5 Document device frames in the skill docs
    - _Requirements: 25.9_

- [x] 22. Checkpoint - Phase 5 green
  - Ensure all tests pass, ask the user if questions arise. Run the full gate and confirm the packaged `.vsix` contains `THIRD_PARTY_NOTICES.md`.

- [x] 23. Agent and code-mode reachability
  - [x] 23.1 Add the new query filters
    - Extend `matches()` in `element-tools.ts` so `element.query` filters on `instanceOf`, `component`, `parentId`, and a `tokenRef` that matches elements referencing the token in any Mockup_Field; multiple filters combine with AND
    - _Requirements: 25.6_

  - [x] 23.2 List Mockup_Fields in the schema tool
    - Update `src/core/tools/schema-tools.ts` so the schema action returns every Mockup_Field for an element type with its value type and a non-empty description from the Field Registry
    - _Requirements: 25.5_

  - [x] 23.3 Keep the agent surface within budget
    - Shorten the `openboard_call` description in `src/codemode/surface.ts` to point at the `actions` topic instead of listing action names, keep exactly five top-level tools with no per-tool registration code, and measure `surfaceSize`; if the budget in `test/codemode/skill.test.ts` is still exceeded, raise it through an explicit edit to that test
    - _Requirements: 25.7, 25.8_

  - [x] 23.4 Expose the new actions in the `ob` API
    - Add the matching `BoardHandle` methods and declaration lines in `src/codemode/ob-api.ts` for tokens, components, instances, overrides, detach, and icon search, accepting the same inputs and returning the same results and errors as the Agent_Tools
    - _Requirements: 25.3, 25.4_

  - [x] 23.5 Regenerate catalogs and action coverage
    - Run `npm run gen:mcp-tools`, update `src/mcp/catalog.ts` if needed, and update `docs/action-coverage.md` and `test/action-coverage.test.ts` for every new action
    - _Requirements: 25.7, 25.11_

  - [x] 23.6 Write the hand-authored skill topics
    - Update `overview.md`, `library.md`, `actions.md`, and `code-mode.md` so each Mockup_Field, each new action, and the Derived_Geometry_Pass has at least one example
    - _Requirements: 25.9_

  - [x] 23.7 Write schema validity tests for the new tools
    - For each new Agent_Tool, validate one generated valid and one invalid input against the input schema and one valid and one invalid output against the output schema, and check missing-item and invalid-field errors leave the document unchanged
    - _Requirements: 25.11, 25.12, 25.13, 28.7_

  - [x] 23.8 Write property test for cross-surface edit equivalence
    - **Property 33: Cross-surface edit equivalence**
    - Apply the same `ElementPatch` through the webview path, an MCP tool call, and a code-mode script (reusing the `sandbox.test.ts` harness) and assert equal documents and exactly one history entry each
    - **Validates: Requirements 28.5**

- [x] 24. Webview localization
  - [x] 24.1 Replace the `t()` shim with `@vscode/l10n`
    - Add `@vscode/l10n` at an exact pinned version, configure it in `src/webview/main.tsx` with the bundle contents the host embeds, and make `t()` delegate to it
    - _Requirements: 26.4_

  - [x] 24.2 Populate and audit the localization bundle
    - Add every new user-visible webview string and package contribution string to `l10n/bundle.l10n.json` and `package.nls.json`, and extend `test/nls.test.ts` so strings added by this feature must go through `t()` or the manifest bundle
    - _Requirements: 26.4_

- [x] 25. Accessibility
  - [x] 25.1 Audit and fix the new controls
    - Ensure every new control has a non-empty accessible name that is unique within its panel, is reachable and operable by keyboard alone, and takes its colors from VS Code theme CSS variables
    - _Requirements: 26.3, 26.5_

  - [x] 25.2 Write axe and keyboard DOM tests
    - Extend the `axeHelper.ts` pattern to the icon picker, component panel, corner, token, layout, and sizing controls, and the roving-focus palette
    - _Requirements: 26.3_

- [x] 26. Performance
  - [x] 26.1 Add the large-board notice and viewport rule for the new element kinds
    - Make culling treat clipped elements, Layout_Frames, Component_Instances, and Instance_Children like any other element within the viewport plus 256 pixels, and show the performance notice for a board of more than 5,000 elements that uses Mockup_Fields while still opening it
    - _Requirements: 27.5, 27.6_

  - [x] 26.2 Extend the perf fixtures
    - Add generators in `test/perf/fixtures.ts` for 100 instances with 20 children each, 5,000 elements using Mockup_Fields, 1,000 token-using elements, 200 Layout_Frame children, and 500-element layout subtrees
    - _Requirements: 27.1, 27.2, 27.4_

  - [x] 26.3 Benchmark the derived passes
    - Assert the Sync_Pass plus Layout_Pass median of 5 runs stays within 250 ms for the 100-instance fixture, the no-op pass within 5 ms for 1,000 elements, the 200-child layout within 50 ms, and the 500-element resize within 100 ms
    - _Requirements: 18.8, 19.13, 22.9, 27.1_

  - [x] 26.4 Benchmark open, drag, token resolution, and text
    - Assert the 5,000-element open within 3 seconds, the drag at no less than 30 fps, the token resolution overhead of at most 1 ms per 1,000 elements, the 10,000-character Text_Measurer within 20 ms, and the wrap re-render within 100 ms
    - _Requirements: 8.7, 8.9, 27.2, 27.3, 27.4_

- [x] 27. Test suite for Requirement 28
  - [x] 27.1 Build the shared arbitraries
    - Extend `test/arbitraries/` with a Board_Document generator that includes every Mockup_Field, and generators for component nesting depth of at least 3, Frame nesting depth of at least 3, component cycles, and Layout_Frame trees with mixed sizing
    - _Requirements: 28.1, 28.3_

  - [x] 27.2 Write property test for the whole-document round trip
    - **Property 1: Whole-document round trip**
    - At least 100 documents per run, each with at least one value for every Mockup_Field
    - **Validates: Requirements 3.10, 4.1, 4.4, 28.1**

  - [x] 27.3 Write property test for serializer stability
    - **Property 2: Serializer stability**
    - **Validates: Requirements 3.11**

  - [x] 27.4 Write property test for the lowest representable schema version
    - **Property 3: Lowest-representable schema version**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.14, 11.14, 13.11, 14.16, 19.12, 23.12**

  - [x] 27.5 Write property test for unknown nested properties
    - **Property 4: Unknown nested properties survive round trips**
    - Also assert that no Mockup_Field ever lands in an extra-properties bag
    - **Validates: Requirements 4.4, 28.2**

  - [x] 27.6 Write property test for cross-surface validation agreement
    - **Property 5: Cross-surface validation agreement**
    - **Validates: Requirements 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 25.1, 25.10, 25.12**

  - [x] 27.7 Write export tests for every format
    - Export a document containing Icons, image fills, corner radii, clipping, and token colors as SVG, PNG, JPEG, WebP, and PDF and assert each feature is rendered
    - _Requirements: 28.11, 5.1, 5.3_

  - [x] 27.8 Write migration and older-build tests
    - Open a stored Schema_Version 1 fixture and assert in-memory version 2 and a version 1 save without Schema_V2_Features; simulate a build with a lower current version opening a Schema_Version 2 fixture and assert read-only, a rejected save, and an unchanged file; assert Phase 1 fields written by an older build survive unchanged
    - _Requirements: 3.7, 3.8, 28.9, 28.10_

  - [x] 27.9 Make property-test failures reportable
    - Confirm `vitest` exits non-zero on failure and that failing property tests print the seed and the generated counterexample, adding fast-check reporter settings in `vitest.config.mts` if needed
    - _Requirements: 28.12_

  - [x] 27.10 Write the cross-bundle determinism test
    - **Property 34: Cross-bundle determinism**
    - Run the Text_Measurer and the Layout_Pass on at least 100 generated inputs in the webview bundle, the Extension Host bundle, and the code-mode QuickJS sandbox, and assert identical numeric output (this also completes the determinism clause of Property 28)
    - **Validates: Requirements 28.8, 22.6**

  - [x] 27.11 Cover Requirement 28.3 for all three passes
    - Run the Sync_Pass, Layout_Pass, and Derived_Geometry_Pass on at least 100 shared-generator documents per run, including depth-3 nesting and a component cycle, asserting idempotence and completion within 5 seconds each
    - _Requirements: 28.3_

  - [x] 27.12 Extend non-regression coverage
    - Assert Edge re-routing within 100 ms for Frame, Instance_Child, and Layout_Frame child changes on a 500-element board, and that inputs valid before this feature produce the same results on boards with no Mockup_Field
    - _Requirements: 2.4, 2.8, 2.12, 28.6_

- [x] 28. Documentation and changelog
  - [x] 28.1 Update README and CHANGELOG
    - Describe the mockup capabilities, the schema version 2 behavior and its read-only effect on older builds, the Icon_Set license, and the new commands
    - _Requirements: 3.7, 23.2, 23.11_

- [x] 29. Final checkpoint - Everything green
  - Ensure all tests pass, ask the user if questions arise. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:perf`, `npm run check:manifest`, and `npm run package`, and confirm the guard fixtures from task 1.1 still pass byte for byte.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The guard fixtures (1.1), the lockstep test (1.3), the rasterizer clip verification (7.4), and the bundle budget test (19.3) are intentionally required because they enforce constraints the design treats as non-negotiable.
- Each task references specific requirements for traceability, and each property test references its Correctness Property number from the design document.
- Checkpoints keep every phase green. Phases are ordered so later phases only add optional fields, so earlier phases never need rework.
- Unit tests validate specific examples and edge cases; property tests validate universal properties.
- Task 7.4 verifies nested `clipPath` behavior in the real rasterizer and switches to per-level `<g clip-path>` wrapping if the engine does not honor it.
- Task 23.3 may require an explicit edit to the surface size budget in `test/codemode/skill.test.ts`, which Requirement 25.8 allows.
- Tasks in the same wave of the dependency graph touch different files and can run in parallel. Tasks that edit the same shared file (`types.ts`, `svg.ts`, `element-tools.ts`, `registry.ts`, `model.ts`, the Properties_Panel files, and the skill docs) sit in different waves.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.4", "1.5", "1.7"] },
    { "id": 1, "tasks": ["1.3", "1.6", "1.8", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "3.7", "4.1", "5.1"] },
    { "id": 3, "tasks": ["3.5", "3.6", "3.8", "4.2", "4.3", "4.4", "5.2", "5.7", "5.8", "5.9"] },
    { "id": 4, "tasks": ["4.5", "4.6", "4.7", "4.8", "5.3", "5.4", "5.5", "6.1"] },
    { "id": 5, "tasks": ["5.6", "6.2", "6.3", "6.4", "7.1"] },
    { "id": 6, "tasks": ["6.5", "6.6", "6.7", "6.8", "7.2", "7.3", "7.5"] },
    { "id": 7, "tasks": ["7.4", "7.6", "7.7", "7.8"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["9.2"] },
    { "id": 10, "tasks": ["9.3", "9.4", "9.6"] },
    { "id": 11, "tasks": ["9.5", "9.7", "9.11", "9.12"] },
    { "id": 12, "tasks": ["9.8", "9.13", "9.14"] },
    { "id": 13, "tasks": ["9.9", "9.10"] },
    { "id": 14, "tasks": ["11.1"] },
    { "id": 15, "tasks": ["11.2"] },
    { "id": 16, "tasks": ["11.3", "11.8", "11.9"] },
    { "id": 17, "tasks": ["11.4"] },
    { "id": 18, "tasks": ["11.5", "11.6", "11.10", "11.11", "11.12"] },
    { "id": 19, "tasks": ["11.7", "12.1"] },
    { "id": 20, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 21, "tasks": ["12.5", "13.1"] },
    { "id": 22, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6"] },
    { "id": 23, "tasks": ["13.7", "13.8", "13.9"] },
    { "id": 24, "tasks": ["15.1"] },
    { "id": 25, "tasks": ["15.2", "15.3", "15.4", "15.5", "15.6", "15.7"] },
    { "id": 26, "tasks": ["15.8", "15.9", "16.1"] },
    { "id": 27, "tasks": ["16.2", "17.1"] },
    { "id": 28, "tasks": ["16.3", "16.5", "17.5"] },
    { "id": 29, "tasks": ["16.4", "16.6", "16.7", "16.8"] },
    { "id": 30, "tasks": ["16.9", "17.2", "17.4"] },
    { "id": 31, "tasks": ["17.3", "17.6", "17.7"] },
    { "id": 32, "tasks": ["19.1"] },
    { "id": 33, "tasks": ["19.2", "19.3", "19.4"] },
    { "id": 34, "tasks": ["20.1"] },
    { "id": 35, "tasks": ["20.2", "20.3", "20.4"] },
    { "id": 36, "tasks": ["20.5", "20.6", "20.8", "20.9"] },
    { "id": 37, "tasks": ["20.7"] },
    { "id": 38, "tasks": ["21.1"] },
    { "id": 39, "tasks": ["21.2", "21.3"] },
    { "id": 40, "tasks": ["21.4", "21.5"] },
    { "id": 41, "tasks": ["23.1", "23.2"] },
    { "id": 42, "tasks": ["23.3", "23.4"] },
    { "id": 43, "tasks": ["23.5", "23.6", "23.7", "23.8", "26.1"] },
    { "id": 44, "tasks": ["24.1", "27.1"] },
    { "id": 45, "tasks": ["24.2", "27.2", "27.3", "27.4", "27.5", "27.6", "27.7", "27.8", "27.9"] },
    { "id": 46, "tasks": ["25.1", "27.10", "27.11", "27.12"] },
    { "id": 47, "tasks": ["25.2", "26.2"] },
    { "id": 48, "tasks": ["26.3", "26.4"] },
    { "id": 49, "tasks": ["28.1"] }
  ]
}
```
