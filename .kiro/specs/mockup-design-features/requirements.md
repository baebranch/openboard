# Requirements Document

## Introduction

OpenBoard is meant to be an all-in-one whiteboard, flowchart, and mockup builder inside the IDE. Today it handles whiteboards and flowcharts well, but building app and web screens needs workarounds: corners share one radius, text takes its color from the stroke, text does not wrap, fills cannot be images, there are no design tokens, library components are copy-paste templates with no link back, nothing reflows when content changes, and there are no icons. `diff.md` compares OpenBoard with pen.dev and lists these gaps.

This feature closes those gaps for mockups and screen design without removing or changing any whiteboard or flowchart capability. The agreed approach is:

- Mockup capabilities are OPTIONAL properties on existing Element types. There is no separate mockup mode. A Frame acts as a screen, a container, or a component.
- A Board_Document that uses none of the new properties behaves, renders, and round-trips exactly as it does today.
- Child Elements keep absolute document coordinates. Computed layout is written back to `x` and `y`, so no coordinate migration is needed and Edges keep routing from Element geometry.
- Rendering stays in one place (the shared Renderer used by the Canvas and every export format). Icons are vector path data because the rasterizer cannot load external references or rely on `foreignObject`.
- Component masters live on the Canvas as visible Frames. Instances are Frames linked to a master, with per-child overrides. The existing library stays the cross-board sharing layer.
- Derived geometry (component sync, then auto layout) lands in the same undo step as the edit that triggered it, for the webview, MCP, and code-mode clients alike.

The work ships in five phases, in priority order:

| Phase | Scope | Schema_Version written |
|---|---|---|
| 1 | Visual fidelity primitives: per-corner radius, text weight and text color, text wrapping with a shared Text_Measurer, image fill, frame clipping | 1 |
| 2 | Design tokens, with token modes as an optional later item | 2 for documents that use tokens |
| 3 | Reusable components: masters, instances, overrides, sync, detach, library integration, built-in UI kit | 2 |
| 4 | Auto layout: layout on Frames, child sizing, nested Frames, resize cascade | 2 |
| 5 | Icons from a curated subset of the Lucide icon set, and device frame presets | 2 |

Requirements marked "Optional" or "Later" are lower priority and may be deferred without blocking the rest of their phase.

Out of scope: component variants, layout constraints and responsive resizing, boolean operations and vector path editing, prototyping and click-through, import from other design tools, the full Lucide icon set, and live synchronization of components between boards.

This document extends the `openboard` spec in `.kiro/specs/openboard/requirements.md`. References to "Base Requirement N" point to that document.

## Glossary

- **OpenBoard**: The VS Code extension that is the subject of this document.
- **Base_Spec**: The existing requirements document at `.kiro/specs/openboard/requirements.md`.
- **Board_Editor**, **Canvas**, **Board_Document**, **Board_File**, **Element**, **Flow_Node**, **Edge**, **Frame**, **Properties_Panel**, **Tool_Palette**, **Tool_Registry**, **Agent_Tool**, **Exporter**, **Serializer**, **Parser**, **Schema_Version**, **Asset**, **Undo_History**, **Theme_Adapter**: As defined in the Base_Spec.
- **Mockup_Field**: Any optional Element or Board_Document property introduced by this feature: `cornerRadii`, `fontWeight`, `textColor`, `textWrap`, `imageFill`, `clipContent`, `layout`, `sizing`, `ignoreLayout`, the component marker, `instanceOf`, `overrides`, the `tokens` collection, and the `icon` Element type.
- **Schema_V2_Feature**: A Mockup_Field whose use requires Schema_Version 2: the `tokens` collection, any Token_Reference, the component marker, `instanceOf`, `overrides`, `layout`, `sizing`, `ignoreLayout`, and the `icon` Element type.
- **Renderer**: The single shared rendering implementation in the core export module (`src/core/export/svg.ts`) that produces the Canvas output and every export format.
- **Render_Cache**: The Canvas cache that stores rendered output per Element.
- **Text_Measurer**: A pure, deterministic core function that returns text width, wrapped lines, and text height from text content, font family, font size, font weight, and available width, without using the DOM, a canvas, or installed fonts.
- **Text_Bearing_Element**: An Element that renders text: text, sticky, Flow_Node, and the title of a Frame.
- **Fillable_Element**: An Element that has a fill: rectangle, ellipse, diamond, Frame, sticky, and Flow_Node.
- **Corner_Radii**: An optional list of four non-negative numbers on an Element style, in the order top-left, top-right, bottom-right, bottom-left.
- **Image_Fill**: An optional fill of a Fillable_Element that paints an Asset inside the Element shape, with a fit mode of cover, contain, or stretch.
- **Token**: A named value stored in the Board_Document `tokens` collection. A Token belongs to one category: colors, fonts, or numbers.
- **Token_Reference**: A string of the form `token:<name>` used in place of a literal value in a color field or in `fontFamily`.
- **Token_Resolution**: The Renderer step that replaces a Token_Reference with the current Token value at render time.
- **Component_Master**: A Frame that carries the component marker (a component name of 1 to 100 characters). A Component_Master is a visible Frame on the Canvas.
- **Component_Instance**: A Frame whose `instanceOf` property holds the id of a Component_Master.
- **Instance_Child**: An Element generated by the Sync_Pass inside a Component_Instance, with the id `<instanceId>::<masterChildId>`.
- **User_Child**: A child Element of a Component_Instance that is not an Instance_Child.
- **Override**: A stored per-element property value on a Component_Instance that replaces the master value for one Overridable_Property of one master Element.
- **Overridable_Property**: One of: text content, fill, stroke, text color, font weight, image fill, icon name, opacity, and, for the instance root only, width and height.
- **Sync_Pass**: The step that regenerates the Instance_Children of every affected Component_Instance from its Component_Master and Overrides.
- **Auto_Layout**: An optional `layout` property on a Frame that arranges the direct children of the Frame in a row or a column.
- **Layout_Frame**: A Frame whose `layout` property is present.
- **Sizing_Mode**: The value `fixed`, `hug`, or `fill` of an Element width or height.
- **Layout_Pass**: The step that computes sizes and positions for every affected Layout_Frame and writes them to `x`, `y`, `width`, and `height`.
- **Derived_Geometry_Pass**: The combined Sync_Pass followed by Layout_Pass, run inside `BoardModel.transact` after the edit callback and before the invariant check.
- **Icon**: An Element of type `icon` that draws one named vector glyph from the Icon_Set.
- **Icon_Set**: The curated subset of the Lucide icon set embedded in OpenBoard as vector path data.
- **Device_Frame_Preset**: A built-in Component_Master that represents a phone, tablet, or browser window.
- **Library**: The component library of a Board_Document, as defined in Base Requirement 6.
- **Agent_Surface**: The five top-level agent tools and their action list, as defined by `src/codemode/surface.ts`.

## Requirements

### Requirement 1: Optional Fields and Unchanged Behavior for Existing Boards

**User Story:** As an existing OpenBoard user, I want boards that do not use mockup features to behave exactly as before, so that upgrading never changes my whiteboards or flowcharts.

#### Acceptance Criteria

1. THE OpenBoard SHALL provide every Mockup_Field as an optional property, with no setting, toggle, or command that switches between a mockup mode and a non-mockup mode, so that every tool, panel, and command that exists before this feature produces the same results for a board with Mockup_Fields as for a board without Mockup_Fields when the operation does not read or write a Mockup_Field.
2. WHEN a Board_File that contains no Mockup_Field is opened, edited with operations that exist before this feature, and saved, THE Serializer SHALL write output byte-identical to the output of the build that precedes this feature for the same edits, and the output SHALL NOT contain any Mockup_Field key, including keys with null, empty, or default values.
3. WHERE an Element has no `cornerRadii`, THE Renderer SHALL draw all four corners of the Element with a uniform radius equal to `cornerRadius`, producing the same rendered output as the build that precedes this feature.
4. WHERE a Text_Bearing_Element has no `fontWeight`, THE Renderer SHALL render the text at the same weight as the build that precedes this feature.
5. WHERE a Text_Bearing_Element has no `textColor`, THE Renderer SHALL render the text in the stroke color of the Element, as the build that precedes this feature does.
6. WHERE an Element has no `textWrap`, THE Renderer SHALL lay out text with line breaks only at explicit newline characters in the text, producing the same layout as the build that precedes this feature.
7. WHERE a Fillable_Element has no `imageFill`, THE Renderer SHALL paint only the fill color of the Element.
8. WHERE a Frame has no `clipContent`, THE Renderer SHALL draw every child of the Frame in full, including the parts of a child that extend beyond the Frame bounds.
9. WHERE a Frame has no `layout`, THE Board_Editor SHALL keep the position and size of every child of the Frame equal to the values stored in the Board_Document, including after the Frame is opened, moved, resized, or has a child added or removed.
10. WHERE an Element has no `sizing`, THE Board_Editor SHALL treat both the width and the height of the Element as `fixed`.
11. WHERE a Frame has neither the component marker nor `instanceOf`, THE Board_Editor SHALL treat the Frame as an ordinary Frame, with no component or instance behavior and no component or instance indication in the user interface.
12. WHEN an operation that exists before this feature creates an Element, THE OpenBoard SHALL create the Element without any Mockup_Field.
13. THE OpenBoard SHALL pass every automated test that exists before this feature, including every existing property-based test, with zero failures and no change to the assertions of those tests, except for the tests that assert the behavior superseded by Requirement 3 criterion 3.
14. WHEN a Board_File that contains no Mockup_Field is opened, THE OpenBoard SHALL load the Board_File without displaying an error, a warning, or a migration prompt, and SHALL NOT mark the Board_Document as modified until the user performs an edit.

### Requirement 2: Non-Regression of Whiteboard, Flowchart, and Export Features

**User Story:** As a user who relies on whiteboards and flowcharts, I want every existing capability to keep working while mockup features are added, so that OpenBoard stays an all-in-one tool.

#### Acceptance Criteria

1. THE Tool_Palette SHALL keep the tools Select, Hand, Rectangle, Ellipse, Diamond, Line, Arrow, Freehand, Text, Image, Frame, Sticky_Note, and Eraser, with the behavior defined in Base Requirements 5, 6, and 9, for boards that contain no Mockup_Field.
2. WHEN the user completes a stroke with the Freehand tool or the Eraser tool on a board that contains no Mockup_Field, THE Board_Editor SHALL produce the same Elements, with the same property values, and the same number and content of Undo_History entries as the build that precedes this feature produces for the same pointer input sequence.
3. WHEN the user creates, edits, or connects a Flow_Node, THE Board_Editor SHALL behave as defined in Base Requirement 8, including connection handles, routing styles, arrowheads, edge labels, and self-loops.
4. WHILE the user is dragging a Flow_Node or an Edge endpoint on a board of up to 500 Elements, THE Board_Editor SHALL re-route each connected Edge within 100 ms of each pointer-move update.
5. WHEN the user triggers the flowchart "Auto Layout" action of Base Requirement 8, THE Board_Editor SHALL apply the graph layout algorithm of Base Requirement 8 and SHALL place the Flow_Nodes at the same positions as the build that precedes this feature produces for the same board, independent of the Layout_Pass.
6. WHEN the user pastes Mermaid flowchart text that parses without error, THE Board_Editor SHALL create the same Flow_Nodes and Edges, with the same labels, directions, and positions, as the build that precedes this feature, and SHALL set no Mockup_Field on them.
7. IF the user pastes Mermaid flowchart text that fails to parse, THEN THE Board_Editor SHALL create no Elements, SHALL add no Undo_History entry, SHALL leave the Board_Document unchanged, and SHALL show an error message indicating that the Mermaid text could not be parsed.
8. WHEN either Element of an Edge is a Frame, a Component_Instance, an Instance_Child, or a Layout_Frame child, and the position or size of that Element changes, THE Canvas SHALL re-route the Edge from the current geometry of both connected Elements within 100 ms of the change, for a board of up to 500 Elements.
9. WHEN the user exports a Board_Document that contains no Mockup_Field, THE Exporter SHALL produce SVG output that is byte-identical to the SVG output of the build that precedes this feature for the same Board_Document and the same export options.
10. WHEN the user exports a Board_Document that contains no Mockup_Field as PNG, JPEG, WebP, or PDF, THE Exporter SHALL derive the output from the same SVG rendering that is produced for SVG export of that Board_Document.
11. THE Exporter SHALL keep the formats, scopes, scale factors, padding, transparent background, embedded Board_Document metadata, and limits defined in Base Requirement 12.
12. WHEN an Agent_Tool is invoked with an input that was valid before this feature, on a board that contains no Mockup_Field, THE Tool_Registry SHALL accept the input and SHALL return the same result value and produce the same resulting Board_Document as the build that precedes this feature.
13. WHEN the user performs Undo, Redo, copy, paste, duplicate, group, align, distribute, or a z-order change on Elements that carry no Mockup_Field, THE Board_Editor SHALL produce the same resulting Elements and the same Undo_History entries as defined in Base Requirements 5 and 10.
14. WHEN the user creates a Frame, THE Board_Editor SHALL make each non-Frame Element that is fully inside the Frame bounds a child of that Frame, as defined in Base Requirement 6, SHALL NOT make any non-Frame Element that is not fully inside the Frame bounds a child of that Frame, and SHALL leave other Frames that are inside the Frame bounds as they are.
15. THE Library SHALL continue to list the components button, input field, card, navigation bar, and device outline, and SHALL continue to support saving selected Elements as a reusable component as defined in Base Requirement 6.

### Requirement 3: Schema Versioning and Forward Compatibility

**User Story:** As a user who shares boards through source control, I want older builds to open newer boards safely, so that an older build never breaks component links or layout.

#### Acceptance Criteria

1. WHEN the Serializer serializes a Board_Document that contains no Schema_V2_Feature, THE Serializer SHALL write Schema_Version 1.
2. WHEN the Serializer serializes a Board_Document that contains at least one Schema_V2_Feature, THE Serializer SHALL write Schema_Version 2.
3. THE Serializer SHALL write Schema_Version 1 or Schema_Version 2, whichever is the lowest value that can represent the Board_Document, which supersedes the rule of Base Requirement 11.9 that the Serializer writes the current version after a migration.
4. THE OpenBoard SHALL define the current Schema_Version as 2 starting with the first release that ships a Schema_V2_Feature.
5. WHEN the Parser opens a Board_File with Schema_Version 1, THE Parser SHALL migrate the content to Schema_Version 2 in memory with an identity migration that fills defaults for absent Schema_V2_Feature fields, without changing any existing property name or value, and the Serializer SHALL omit those default-filled fields on save, so that a Board_Document with no Schema_V2_Feature is saved as Schema_Version 1.
6. WHEN the Parser opens a Board_File with Schema_Version 1 that contains a Schema_V2_Feature, THE Parser SHALL accept the Board_File without error and treat the Schema_V2_Feature as present, and the Serializer SHALL write Schema_Version 2 on the next save.
7. IF a build that predates this feature opens a Board_File with Schema_Version 2, THEN THE build SHALL open the Board_File as read-only, show a message that the file was created by a newer version, and reject save attempts without modifying the file on disk, as defined in Base Requirement 11.10, so that no older build can save a file that breaks component links or layout.
8. WHEN a build that predates this feature opens and saves a Board_File with Schema_Version 1 that contains Phase 1 Mockup_Fields, THE build SHALL write those fields back with unchanged names and values, as defined in Base Requirement 11.11.
9. THE OpenBoard SHALL publish an updated JSON Schema for the Board_File that accepts a document with Schema_Version 1 or Schema_Version 2, rejects a document with any other Schema_Version value, and SHALL register it for `.openboard` files.
10. FOR ALL valid Board_Documents that use any combination of Mockup_Fields, parsing the output of the Serializer SHALL produce a Board_Document equal to the original in every Element, Asset, Mockup_Field, and property value (round-trip property).
11. FOR ALL valid Board_Documents, serializing, parsing, and serializing again SHALL produce byte-identical output, with object keys in alphabetical order as defined in Base Requirement 11.3.

### Requirement 4: Parsing, Validation, and Preservation of New Fields

**User Story:** As a maintainer, I want every new field recognized consistently across the file format, so that no field is silently hidden or dropped.

#### Acceptance Criteria

1. THE Parser SHALL treat each Mockup_Field as a known property, so that no Mockup_Field is stored in an extra-properties bag of an Element, style, or Board_Document.
2. IF a Mockup_Field has a value of the wrong type or outside its allowed range, THEN THE Parser SHALL reject the Board_Document and return an error that names the full path of at least the first offending property, as defined in Base Requirement 11.8.
3. WHEN the Parser rejects a Board_Document because of an invalid Mockup_Field, THE OpenBoard SHALL leave the file on disk byte-for-byte unmodified.
4. WHEN the Parser encounters a property that this build does not define at any nesting depth inside a Mockup_Field structure such as `layout`, `overrides`, or `tokens`, THE Parser SHALL preserve that property, and THE Serializer SHALL write it back with unchanged name and value, so that parsing then serializing then parsing yields an equal Board_Document.
5. THE Board_Document schema, the TypeScript Element types, the element-tools property normalization, and the ElementPatch type SHALL each accept exactly the same set of Mockup_Fields, so that a Mockup_Field accepted by one is accepted by all and a Mockup_Field rejected by one is rejected by all.
6. WHEN an Element is created or updated through any client, THE OpenBoard SHALL validate every Mockup_Field of the Element against the same schema that the Parser uses before the change is applied.
7. IF a Mockup_Field is set on an Element type that does not support it, THEN THE Tool_Registry SHALL reject the input with an error that names the property path and the Element type, and SHALL leave the Board_Document unchanged.
8. IF validation of a created or updated Element fails because a Mockup_Field has a value of the wrong type or outside its allowed range, THEN THE OpenBoard SHALL reject the whole create or update operation with an error that names the offending property path, and SHALL leave the Board_Document unchanged, with no partial application of the Element's other properties.

### Requirement 5: Single-Source Rendering and Render Cache Correctness

**User Story:** As a user, I want the Canvas and every export to look the same, so that what I design is what I export.

#### Acceptance Criteria

1. THE Renderer SHALL be the only implementation that converts Elements to visual output for the Canvas, the SVG export, the PNG export, the JPEG export, the WebP export, and the PDF export, such that no other module produces visual output from Elements for any of these targets.
2. THE Renderer SHALL render every Mockup_Field using data embedded in the output itself, with no reference to any resource outside the output and no `foreignObject` element.
3. THE Renderer SHALL render Mockup_Fields so that, at 1x scale, the position of every Element edge and every text line in an export differs from its position on the Canvas by no more than 1 pixel, and the resolved color value of every Element fill and stroke in an export is identical to the resolved color value on the Canvas, as defined in Base Requirement 12.14.
4. THE Render_Cache SHALL include in its per-Element key every value that affects the rendered output of the Element, including the Mockup_Fields of the Element, the resolved value of every Token_Reference used by the Element, and the content of the Asset referenced by an Image_Fill, so that a change to any of these values results in a cache miss for that Element.
5. WHEN a Token value changes, THE Canvas SHALL re-render every Element that uses that Token within 500 ms of the change being applied, for a Board of up to 1,000 Elements, and SHALL display no Element with the pre-change resolved value after those 500 ms.
6. WHEN an Override or a Component_Master change alters an Instance_Child, THE Canvas SHALL re-render that Instance_Child within 500 ms of the change being applied, for a Board of up to 1,000 Elements, and SHALL display no Instance_Child with the pre-change output after those 500 ms.
7. IF a Token_Reference used by an Element cannot be resolved to a Token value, THEN THE Renderer SHALL render the Element with the referencing property treated as unset, SHALL continue rendering all other Elements, and SHALL leave the stored Element data unchanged.
8. IF the Asset referenced by an Image_Fill is missing or cannot be decoded, THEN THE Renderer SHALL render the Element without that Image_Fill, SHALL continue rendering all other Elements, and SHALL complete any export in progress without aborting it.

### Requirement 6: Per-Corner Radius (Phase 1)

**User Story:** As a designer, I want a different radius on each corner, so that I can draw cards, sheets, and tabs with rounded tops only.

#### Acceptance Criteria

1. THE Board_Document SHALL store an optional `style.cornerRadii` as a list of exactly four finite numbers, each greater than or equal to 0, in the order top-left, top-right, bottom-right, bottom-left.
2. WHERE an Element has `cornerRadii`, THE Renderer SHALL draw each corner with its own radius and SHALL ignore `cornerRadius` for that Element.
3. THE Renderer SHALL apply `cornerRadii` to every Element type for which the Renderer applies `cornerRadius` today.
4. IF a value entered in a corner field or in the linked field of the Properties_Panel is negative, is not a finite number, or is greater than half of the shorter side of the Element, THEN THE Properties_Panel SHALL reject the value, retain the previous value in the Board_Document, and display an error indication on that field, as defined in Base Requirement 6.7.
5. IF an Agent_Tool input contains `cornerRadii` with a length other than four, or with a value that is negative, is not a finite number, or is greater than half of the shorter side of the target Element, THEN THE Tool_Registry SHALL return an error that names the property path of the offending value and SHALL leave the Board_Document unchanged.
6. THE Properties_Panel SHALL show four corner fields, in the order top-left, top-right, bottom-right, bottom-left, and one linked field that sets all four corners to the same value.
7. WHEN the user enters a valid value in the linked field, THE Board_Editor SHALL write that value to `cornerRadius`, remove `cornerRadii`, and record the change as one Undo_History entry.
8. WHEN multiple Elements are selected with differing values for a corner field or for the linked field, THE Properties_Panel SHALL display that field as mixed, as defined in Base Requirement 6.8.
9. WHEN an Element is resized, THE Board_Editor SHALL keep each value of `cornerRadii` unchanged, except that THE Board_Editor SHALL clamp any value greater than half of the new shorter side to half of the new shorter side, and SHALL record the clamp in the same Undo_History entry as the resize.
10. WHEN the Renderer exports an Element with valid `cornerRadii` to SVG, THE Renderer SHALL output a single closed path in which each corner with a radius greater than 0 is an arc of that stored radius and each corner with a radius of 0 is a square corner.
11. WHEN the user enters a valid value in one corner field of an Element that has no `cornerRadii`, THE Board_Editor SHALL write `cornerRadii` with the entered value at that corner and the Element's current `cornerRadius` (or 0 if none) at the other three corners, and SHALL record the change as one Undo_History entry.
12. WHEN the user enters a valid value in one corner field of an Element that has `cornerRadii`, THE Board_Editor SHALL change only that corner's value and SHALL record the change as one Undo_History entry.

### Requirement 7: Text Weight and Text Color (Phase 1)

**User Story:** As a designer, I want to set text weight and text color separately from the stroke, so that text styling matches real UI design.

#### Acceptance Criteria

1. THE Board_Document SHALL store an optional `fontWeight` on each Text_Bearing_Element as an integer from 100 to 900 in steps of 100.
2. IF a Text_Bearing_Element has a valid `fontWeight`, THEN THE Renderer SHALL render all text of that Element at that weight, except runs governed by criterion 3.
3. IF a text run has the bold style, THEN THE Renderer SHALL render the run at the greater of weight 700 and the `fontWeight` of the Element, using weight 400 as the `fontWeight` when the Element has none.
4. THE Board_Document SHALL store an optional `textColor` on each Text_Bearing_Element, using the same color value forms as `fill` and `stroke`.
5. IF a Text_Bearing_Element has `textColor`, THEN THE Renderer SHALL render all text of the Element with that color.
6. WHEN the user changes the text color in the Properties_Panel, THE Board_Editor SHALL write `textColor` and SHALL leave the stroke color unchanged.
7. WHEN the user changes the stroke color in the Properties_Panel of a Text_Bearing_Element that has `textColor`, THE Board_Editor SHALL leave the text color unchanged.
8. IF the user enters a `fontWeight` that is not an integer from 100 to 900 in steps of 100 (including an empty, non-numeric, or decimal entry), THEN THE Properties_Panel SHALL reject the value, retain the previous `fontWeight` in the Board_Document and in the input field, and display an error indication on the field.
9. THE Theme_Adapter SHALL provide a default text color for new Text_Bearing_Elements that meets a contrast ratio of at least 4.5:1 against the Canvas background in light, dark, and high-contrast themes, as defined in Base Requirement 4.4.
10. WHEN the theme kind changes, THE Theme_Adapter SHALL, within 500 ms of the change, remap a `textColor` whose value is "theme default" to the default text color of the new theme kind and SHALL leave an explicit `textColor` unchanged, as defined in Base Requirement 4.5.
11. IF a Text_Bearing_Element has no `fontWeight`, THEN THE Renderer SHALL render the text of the Element at weight 400.
12. THE Renderer SHALL draw the stroke of a Text_Bearing_Element with the stroke color only, regardless of whether the Element has `textColor`.

### Requirement 8: Text Measurement and Wrapping (Phase 1)

**User Story:** As a designer, I want text to wrap inside its box, so that labels, paragraphs, and buttons look right without manual line breaks.

#### Acceptance Criteria

1. THE Board_Document SHALL store an optional `textWrap` on each Text_Bearing_Element with the values `none` and `wrap`, and THE Renderer SHALL treat a Text_Bearing_Element with no `textWrap` value as `none`.
2. THE Text_Measurer SHALL be a pure function in the core module that depends on no DOM, canvas, or installed font, and SHALL return the same output for the same input in the webview, the Extension_Host, and the code-mode sandbox.
3. WHEN the Text_Measurer receives text, font family, font size, font weight, and an available width, THE Text_Measurer SHALL return the wrapped lines, the width of the widest line, and the total text height, and SHALL start a new line at every explicit newline character in the text.
4. WHERE `textWrap` is `wrap`, THE Renderer SHALL break lines at whitespace so that no line is wider than the Element width less its text padding, as measured by the Text_Measurer.
5. IF a single word is wider than the available width, THEN THE Renderer SHALL break the word between characters so that no line exceeds the available width, except that IF the available width is narrower than one character, THEN THE Renderer SHALL place exactly one character on each line.
6. WHERE `textWrap` is `wrap`, THE Renderer SHALL render every line of the wrapped text without clipping, including lines that extend below the Element bottom edge.
7. WHEN the Text_Measurer receives text of 10,000 characters, THE Text_Measurer SHALL return its result within 20 ms on the reference machine.
8. WHILE the user edits text inline in a Text_Bearing_Element with `textWrap` of `wrap`, THE Board_Editor SHALL break lines in the editing overlay at the same character positions as the Renderer breaks them for the same text, font, and width.
9. WHEN the user changes the text, font family, font size, or font weight of a Text_Bearing_Element with `textWrap` of `wrap`, THE Canvas SHALL complete re-rendering the wrapped text within 100 ms of the change for text of up to 10,000 characters.
10. FOR ALL text, fonts, and widths, THE Text_Measurer SHALL return a result in which the concatenation of the wrapped lines, after removing all whitespace characters from both the concatenation and the original text, equals the original text with all whitespace characters removed (round-trip property).
11. FOR ALL text and fonts, THE Text_Measurer SHALL return a line count that does not increase when the available width increases (metamorphic property).
12. WHERE `textWrap` is `none`, THE Renderer SHALL break lines only at explicit newline characters in the text and SHALL NOT break lines based on the Element width.
13. IF the Text_Measurer receives a font size that is not a finite number greater than 0, or an available width that is not a finite number, THEN THE Text_Measurer SHALL return an error indicating invalid input and SHALL NOT return wrapped lines, a widest-line width, or a text height.

### Requirement 9: Image Fill (Phase 1)

**User Story:** As a designer, I want an image as the fill of any shape, so that I can make avatars, cards with photos, and rounded thumbnails.

#### Acceptance Criteria

1. THE Board_Document SHALL store at most one optional `imageFill` on each Fillable_Element, consisting of exactly one Asset id and exactly one fit mode, where the fit mode is one of `cover`, `contain`, or `stretch`.
2. WHERE a Fillable_Element has `imageFill`, THE Renderer SHALL paint the image over the fill color and clip it to the exact outline of the Element, including its corner radii or ellipse outline, so that no image pixel is painted outside that outline.
3. WHERE the fit mode is `cover`, THE Renderer SHALL scale the image uniformly by the smallest factor at which the image width is at least the Element width and the image height is at least the Element height, SHALL center the image on the Element, and SHALL clip any overflow to the Element outline.
4. WHERE the fit mode is `contain`, THE Renderer SHALL scale the image uniformly by the largest factor at which the image width is at most the Element width and the image height is at most the Element height, SHALL center the image on the Element, and SHALL show the fill color in any area of the Element that the image does not cover.
5. WHERE the fit mode is `stretch`, THE Renderer SHALL scale the image non-uniformly so that the image width equals the Element width and the image height equals the Element height.
6. WHEN the user applies an image fill from a file, a drop, or the clipboard, THE Board_Editor SHALL accept only the image types, size limit, and decoding rules defined in Base Requirement 7, and SHALL set `imageFill` with the new Asset id and the fit mode `cover`.
7. IF the file, drop, or clipboard content for an image fill violates the image types, size limit, or decoding rules in Base Requirement 7, THEN THE Board_Editor SHALL reject it with the message defined there and SHALL leave the Element's existing `imageFill` and fill color unchanged.
8. THE Serializer SHALL store each Asset once regardless of how many Elements reference it through `imageFill` or an image Element, and SHALL omit an Asset that no Element references, as defined in Base Requirements 7.10 and 7.11.
9. IF an `imageFill` references an Asset id that does not exist in the Board_Document, THEN THE Renderer SHALL paint the fill color only, THE Parser SHALL load the Board_Document without an error, and THE Serializer SHALL write the same Asset id and fit mode back unchanged.
10. IF the Asset referenced by an `imageFill` cannot be decoded for rendering, THEN THE Renderer SHALL paint the fill color only and SHALL leave the `imageFill` in the Board_Document unchanged.
11. WHEN an SVG Asset is used as an `imageFill`, THE Renderer SHALL render it as an image resource, SHALL execute no script contained in it, and SHALL load no remote resource that it references, as defined in Base Requirement 16.4.
12. WHEN the user removes the image fill, THE Board_Editor SHALL remove `imageFill` from the Element and THE Renderer SHALL paint the fill color only.

### Requirement 10: Frame Clipping (Phase 1)

**User Story:** As a designer, I want a Frame to clip its content, so that screens, scroll areas, and rounded cards hide overflow like real UI.

#### Acceptance Criteria

1. THE Board_Document SHALL store an optional boolean `clipContent` flag on each Frame, with a default value of false when the flag is absent.
2. WHERE a Frame has `clipContent` set to true, THE Renderer SHALL render each descendant of the Frame only within the Frame shape, including the Frame corner radii, and SHALL render no descendant pixel outside the Frame shape.
3. WHERE a Frame has `clipContent` set to true, THE Canvas SHALL ignore pointer hits on any part of a descendant that lies outside the Frame shape, and SHALL deliver pointer hits at the same location to the next visible Element beneath the clipped part, or to the board background if none exists.
4. WHEN a board is exported to SVG, PNG, JPEG, WebP, or PDF, THE Renderer SHALL apply the same clip region to each clipped descendant as the Canvas applies, so that no descendant content appears outside the Frame shape in the exported output.
5. WHEN a Frame with `clipContent` set to true is nested inside another Frame with `clipContent` set to true, THE Renderer SHALL clip the descendants of the inner Frame to the intersection of the inner Frame shape and the outer Frame shape.
6. THE Renderer SHALL draw Edges without clipping, so that an Edge attached to a clipped Element remains fully visible, including the part of the Edge that lies outside the Frame shape.
7. WHEN the user changes the `clipContent` value of a Frame, THE Board_Editor SHALL record the change as exactly one Undo_History entry, and WHEN the user undoes that entry, THE Board_Editor SHALL restore the previous `clipContent` value.
8. IF a Frame has `clipContent` set to false or absent, THEN THE Renderer SHALL render and hit-test the descendants of the Frame without clipping, on the Canvas and in all export formats.

### Requirement 11: Design Tokens (Phase 2)

**User Story:** As a designer, I want named colors and fonts, so that I can restyle a whole board by changing one value.

#### Acceptance Criteria

1. THE Board_Document SHALL store an optional top-level `tokens` collection with the categories colors, fonts, and numbers, where each Token has a name of 1 to 64 characters from letters, digits, hyphen, underscore, and period, and each category holds at most 500 Tokens.
2. THE Board_Document SHALL keep Token names unique within each category, comparing names case-sensitively.
3. THE Board_Document SHALL store a literal value for each Token, where a colors Token value is a literal color value accepted by the color fields, a fonts Token value is a font family string of 1 to 200 characters, and a numbers Token value is a finite number, and SHALL NOT allow a Token value to be a Token_Reference, so that Token_Resolution cannot form a cycle.
4. WHERE a color field (`fill`, `stroke`, or `textColor`) holds a Token_Reference to a Token in the colors category, THE Renderer SHALL render the Token value in that field.
5. WHERE `fontFamily` holds a Token_Reference to a Token in the fonts category, THE Renderer SHALL render the Token value as the font family.
6. WHEN the Exporter writes SVG, PNG, or PDF output, THE Exporter SHALL write the resolved literal value for every Token_Reference, using the default color or default font family for a Token_Reference to a missing Token, and SHALL write no Token_Reference into the exported visual content.
7. WHEN the user or an Agent_Tool changes a Token value to a valid value, THE Board_Editor SHALL apply the change to every Element that references the Token, SHALL update the rendered canvas within 1 second, and SHALL record the change as one Undo_History entry.
8. WHEN the user or an Agent_Tool renames a Token to a valid, unused name in the same category, THE Board_Editor SHALL update every Token_Reference to the old name in Elements, Overrides, and Library entries and SHALL record the rename as one Undo_History entry.
9. IF a Token_Reference names a Token that does not exist in the category required by the field, THEN THE Renderer SHALL use the default color of the field role for the current theme kind or the default font family, THE Properties_Panel SHALL mark the field as referencing a missing Token, and THE Board_Editor SHALL remain usable without an error.
10. IF the user or an Agent_Tool deletes a Token that Elements, Overrides, or Library entries still reference, THEN THE Board_Editor SHALL reject the deletion, report the total number of Token_References to that Token, and leave the Board_Document unchanged.
11. IF the user or an Agent_Tool creates or renames a Token with a name that is invalid or already exists in the same category, or creates or changes a Token with a value that is invalid for its category, THEN THE Board_Editor SHALL reject the operation, state the reason, and leave the Board_Document unchanged.
12. WHEN the user applies a Token to a color field or a font field in the Properties_Panel, THE Board_Editor SHALL store a Token_Reference to that Token in the field, where the Token is from the colors category for a color field and from the fonts category for a font field.
13. WHEN the user inserts a Library component whose Elements reference Tokens that the target Board_Document does not define, THE Board_Editor SHALL add those Tokens with the values recorded in the Library entry as part of the same Undo_History entry as the insertion, and SHALL keep the existing value for any Token name that the target Board_Document already defines.
14. IF a Board_Document contains at least one Token or one Token_Reference when it is serialized, THEN THE Serializer SHALL write Schema_Version 2.
15. WHERE number Tokens are enabled, THE Properties_Panel SHALL accept a Token_Reference to a number Token in layout gap, layout padding, corner radius, and font size fields, and THE Renderer SHALL use the Token value for that field. (Optional, later)
16. FOR ALL Board_Documents with Tokens, parsing then serializing then parsing SHALL produce a `tokens` collection with the same categories, names, and values, and Token_References with the same field and Token name, as the first parse.
17. WHEN the user detaches a Token from a color field or a font field in the Properties_Panel, THE Board_Editor SHALL replace the Token_Reference with the resolved literal value, or with the default color or default font family if the Token does not exist, and SHALL record the detach as one Undo_History entry.
18. IF the user or an Agent_Tool supplies a Token_Reference as a Token value, THEN THE Board_Editor SHALL reject the value, state that a Token value must be a literal, and leave the Board_Document unchanged.

### Requirement 12: Token Modes (Phase 2, Optional, Later)

**User Story:** As a designer, I want light and dark values for a color Token, so that I can preview both appearances of a screen.

#### Acceptance Criteria

1. WHERE token modes are enabled, THE Board_Document SHALL store for each color Token either exactly one literal value or exactly two literal values, one for the mode `light` and one for the mode `dark`.
2. WHERE token modes are enabled, THE Board_Document SHALL store exactly one active mode with a value of `light`, `dark`, or `auto`, and THE Board_Document SHALL treat a document with no stored active mode as having the active mode `auto`.
3. WHERE token modes are enabled, WHEN the user changes the active mode, THE Canvas SHALL re-render every Element that references a color Token with two values using the value for the resolved mode within 500 ms, for a board containing up to 1,000 Elements.
4. WHERE a color Token has one literal value, THE Renderer SHALL render that value in every mode.
5. WHERE token modes are enabled, THE Exporter SHALL provide an option that selects the export mode as `light`, `dark`, or the active mode, with a default of the active mode, and THE Exporter SHALL leave the stored active mode and the Undo_History unchanged by the export.
6. WHERE token modes are enabled, WHEN the user changes the active mode, THE Board_Editor SHALL record exactly one Undo_History entry for the change, and WHEN the user undoes that entry, THE Board_Editor SHALL restore the previous active mode and THE Canvas SHALL re-render affected Elements within 500 ms.
7. WHERE token modes are enabled, WHILE the active mode is `auto`, WHEN the IDE theme kind changes, THE Canvas SHALL resolve the mode as `dark` for the IDE theme kinds Dark and High Contrast, or as `light` for the IDE theme kinds Light and High Contrast Light, and SHALL re-render every Element that references a color Token with two values within 500 ms without recording an Undo_History entry.

### Requirement 13: Component Masters on the Canvas (Phase 3)

**User Story:** As a designer, I want to mark a Frame as a reusable component, so that I can build a design system on the Canvas next to my screens.

#### Acceptance Criteria

1. WHEN the user runs "Create Component" with exactly one Frame selected and no other Element selected, and provides a component name of 1 to 100 characters after leading and trailing whitespace is trimmed, THE Board_Editor SHALL mark the Frame as a Component_Master with the trimmed name, as one Undo_History entry.
2. WHEN the user runs "Create Component" with one or more non-Frame Elements selected and no Frame selected, and provides a component name of 1 to 100 characters after leading and trailing whitespace is trimmed, THE Board_Editor SHALL create a Frame whose bounds equal the union of the bounds of the selected Elements with zero padding, make the selected Elements children of that Frame, and mark the Frame as a Component_Master with the trimmed name, as one Undo_History entry.
3. IF the user runs "Create Component" with a name that is empty or whitespace-only, with a name longer than 100 characters after trimming, or with no Element selected, THEN THE Board_Editor SHALL reject the action, display an error message indicating the reason, and leave the Board_Document and the Undo_History unchanged.
4. IF the user runs "Create Component" on a Frame that has `instanceOf`, THEN THE Board_Editor SHALL reject the action, display an error message indicating that a Component_Instance cannot be a Component_Master, and leave the Board_Document and the Undo_History unchanged.
5. THE Canvas SHALL display each Component_Master as a visible Frame with a component indicator that distinguishes it from a non-master Frame at every zoom level, and THE Board_Editor SHALL omit the component indicator from every export output.
6. THE Board_Editor SHALL list every Component_Master of the Board_Document in a component panel in ascending alphabetical order by name, showing its name and a "Go to master" action, and SHALL update the list within 500 ms after a Component_Master is created, removed, deleted, or renamed. WHEN the user runs "Go to master", THE Board_Editor SHALL set the viewport so that the full bounds of that master are visible, without adding an Undo_History entry. WHILE the Board_Document contains no Component_Master, THE Board_Editor SHALL display an empty-state indication in the component panel.
7. WHEN the user runs "Remove Component" on a single selected Component_Master, THE Board_Editor SHALL remove the component marker, keep the Frame and its descendants as an ordinary Frame, detach every Component_Instance of that master as defined in Requirement 15, and record the change as one Undo_History entry.
8. WHEN the user deletes a Component_Master, THE Board_Editor SHALL detach every Component_Instance of that master as defined in Requirement 15, delete the master and its descendants, and record the change as one Undo_History entry.
9. WHEN the user duplicates a Component_Master or pastes a copied Component_Master, THE Board_Editor SHALL create a new Component_Master with a new id for the master and for each of its descendants, and with a name that is unique within the target Board_Document by comparing names case-sensitively. IF the original name is already in use, THEN THE Board_Editor SHALL append a space and the smallest integer greater than or equal to 2 that makes the name unique, truncating the original name as needed to keep the total length at or below 100 characters. THE Board_Editor SHALL leave existing Component_Instances linked to the original master.
10. WHEN a Component_Master and Component_Instances of that master are included in the same copy operation and pasted together, THE Board_Editor SHALL make each pasted Component_Instance refer to the pasted Component_Master instead of the original master.
11. WHEN the Serializer writes a Board_Document that contains at least one Component_Master, THE Serializer SHALL write Schema_Version 2.
12. IF the user runs "Remove Component" with no Element selected, with more than one Element selected, or with a selected Element that is not a Component_Master, THEN THE Board_Editor SHALL reject the action, display an error message indicating the reason, and leave the Board_Document and the Undo_History unchanged.
13. IF the user runs "Create Component" with a selection that contains more than one Frame, contains both a Frame and a non-Frame Element, or contains a Frame that is already a Component_Master, THEN THE Board_Editor SHALL reject the action, display an error message indicating the reason, and leave the Board_Document and the Undo_History unchanged.
14. IF the user runs "Create Component" with a name that equals the name of an existing Component_Master in the Board_Document by case-sensitive comparison after trimming, THEN THE Board_Editor SHALL reject the action, display an error message indicating that the name is already in use, and leave the Board_Document and the Undo_History unchanged.

### Requirement 14: Component Instances and Overrides (Phase 3)

**User Story:** As a designer, I want instances of a component with local changes, so that I can reuse a button with different text and colors.

#### Acceptance Criteria

1. WHEN the user inserts an instance of a Component_Master, THE Board_Editor SHALL create a Frame whose `instanceOf` is the master id, with the size of the master, and with one Instance_Child for each descendant of the master, as one Undo_History entry.
2. THE Board_Editor SHALL give each Instance_Child the id `<instanceId>::<masterChildId>`, so that the id of an Instance_Child is a deterministic function of the instance id and the master Element id.
3. THE Board_Editor SHALL give each Instance_Child the same type, size, style, and text as the corresponding master Element, with positions offset by the difference between the instance origin and the master origin, and with the parent set to the Instance_Child that corresponds to the master parent, or to the Component_Instance when the master parent is the Component_Master.
4. WHEN the user, an Agent_Tool, or a code-mode script edits an Overridable_Property of an Instance_Child, THE Board_Editor SHALL store an Override in the Component_Instance for that property, SHALL display the overridden value on the Instance_Child, and SHALL record the change as one Undo_History entry.
5. WHEN the user, an Agent_Tool, or a code-mode script edits the width or height of a Component_Instance, THE Board_Editor SHALL store an Override for the instance root size and SHALL record the change as one Undo_History entry.
6. IF the user, an Agent_Tool, or a code-mode script moves, resizes, deletes, reparents, or changes the shape of an Instance_Child, or edits a property of an Instance_Child that is not an Overridable_Property, THEN THE Board_Editor SHALL reject the edit, return an error that states that the Instance_Child belongs to a Component_Instance and that the instance must be detached to edit it, leave the Board_Document unchanged, and add no Undo_History entry.
7. WHEN the user moves a Component_Instance, THE Board_Editor SHALL move all Instance_Children and User_Children of that instance by the same offset as the instance, as one Undo_History entry.
8. WHEN the user runs "Reset Overrides" on a property, an Instance_Child, or a Component_Instance, THE Board_Editor SHALL remove the matching Overrides, restore the master values, and record the change as one Undo_History entry, and, IF no matching Override exists, THEN THE Board_Editor SHALL leave the Board_Document unchanged and add no Undo_History entry.
9. WHILE an Instance_Child has an Override on a property, THE Properties_Panel SHALL show an Override indicator on that property of the Instance_Child.
10. WHEN the Sync_Pass runs, THE Board_Editor SHALL leave the position, size, parent, and content of every User_Child of every Component_Instance unchanged.
11. IF a Component_Instance has an `instanceOf` that references no Component_Master, THEN THE Board_Editor SHALL treat the Frame as an ordinary Frame, SHALL keep `instanceOf`, `overrides`, and all children unchanged, and SHALL show a "master missing" indication in the Properties_Panel.
12. IF an action would make a Component_Master contain, directly or through other masters, a Component_Instance of that same master, THEN THE Board_Editor SHALL reject the action, return an error that states that the action would create a component cycle, leave the Board_Document unchanged, and add no Undo_History entry.
13. IF an action would create a chain of nested Component_Instances longer than 8 levels from the outermost instance to the innermost instance, THEN THE Board_Editor SHALL reject the action, return an error that states the limit of 8 levels, leave the Board_Document unchanged, and add no Undo_History entry.
14. WHEN a Component_Instance is copied and pasted in the same Board_Document, THE Board_Editor SHALL create a new Component_Instance with a new id, the same `instanceOf`, the same Overrides, and copies of its User_Children, with Instance_Children whose ids are derived from the new instance id as `<newInstanceId>::<masterChildId>`, as one Undo_History entry.
15. WHEN a Component_Instance is pasted into a Board_Document that does not contain its Component_Master and the clipboard does not contain that master, THE Board_Editor SHALL paste the Frame as an ordinary Frame with no `instanceOf` and no `overrides`, with new ids for the Frame and its children, and with each former Instance_Child converted to an ordinary Element that keeps its displayed values, as one Undo_History entry.
16. WHEN a Board_Document uses `instanceOf` or `overrides`, THE Serializer SHALL write Schema_Version 2.
17. WHILE a Component_Instance has no Override for the instance root size, THE Board_Editor SHALL keep the width and height of the instance equal to the width and height of its Component_Master.
18. WHEN the user edits a Frame property of a Component_Instance that is not derived from the master, THE Board_Editor SHALL apply the edit to the Component_Instance and SHALL record the change as one Undo_History entry.
19. WHEN the user runs the "Go to master" action on a Component_Instance whose Component_Master exists, THE Properties_Panel SHALL select the Component_Master and scroll the canvas so that the Component_Master is visible.

### Requirement 15: Instance Sync and Detach (Phase 3)

**User Story:** As a designer, I want every instance to update when I change the master, so that a design change spreads across all screens.

#### Acceptance Criteria

1. WHEN a transaction changes a Component_Master, a descendant of a Component_Master, or the `instanceOf`, `overrides`, or size of a Component_Instance, THE Sync_Pass SHALL regenerate the Instance_Children of every Component_Instance that refers to a changed Component_Master and of every Component_Instance whose own `instanceOf`, `overrides`, or size changed, in the same transaction and before the invariant check.
2. THE Sync_Pass SHALL create an Instance_Child for each master descendant that the Component_Instance lacks, delete each Instance_Child whose master Element no longer exists, and, for each remaining Instance_Child, set every property that has no Override to the value of the corresponding master Element, with positions offset by the difference between the instance origin and the master origin.
3. THE Sync_Pass SHALL keep the id of every Instance_Child whose master Element still exists, so that Edges attached to the Instance_Child remain attached.
4. WHEN the Sync_Pass deletes an Instance_Child, THE Sync_Pass SHALL delete every Edge that has the Instance_Child as its source or target in the same transaction, as defined in Base Requirement 8.6.
5. THE Sync_Pass SHALL keep the relative stacking order of the Instance_Children of a Component_Instance equal to the relative stacking order of the corresponding master Elements.
6. THE Sync_Pass SHALL be idempotent, so that running the Sync_Pass on its own output changes no property, id, parent, or stacking position of any Element.
7. IF a Board_Document contains a component cycle, meaning a chain of `instanceOf` references that leads from a Component_Master, through a Component_Instance inside that master, back to the same Component_Master (including a master that contains an instance of itself), THEN THE Sync_Pass SHALL terminate, fail the transaction, display an error indication that names every Component_Master in the cycle, and leave the Board_Document unchanged with no Undo_History entry recorded.
8. WHEN the user runs "Detach Instance" on a Component_Instance, THE Board_Editor SHALL remove `instanceOf` and `overrides` from that Component_Instance, keep every child with its current id, properties, parent, and position, and record the change as one Undo_History entry.
9. WHEN a Component_Instance is detached, THE Board_Editor SHALL keep every Edge attached to its children attached to the same child ids.
10. WHEN a Board_Document is loaded and at least one Component_Instance has a missing Instance_Child, an extra Instance_Child, or an Instance_Child property that differs from the expansion of its Component_Master and Overrides, THE Board_Editor SHALL apply the Sync_Pass and mark the Board_Document as modified.
11. WHEN a Board_Document is loaded and no Component_Instance has a missing Instance_Child, an extra Instance_Child, or an Instance_Child property that differs from its expansion, THE Board_Editor SHALL leave the Board_Document unmodified.
12. IF the user runs "Detach Instance" on an Element that has no `instanceOf`, THEN THE Board_Editor SHALL reject the action, display an error indication stating that the Element is not a Component_Instance, and leave the Board_Document unchanged.
13. IF the Sync_Pass fails on load because of a component cycle, THEN THE Board_Editor SHALL open the Board_Document without applying the Sync_Pass, display an error indication that names every Component_Master in the cycle, and leave the Board_Document unmodified.
14. WHEN the Sync_Pass regenerates the Instance_Children of a Component_Instance, THE Sync_Pass SHALL leave every User_Child of that Component_Instance unchanged in id, properties, and position.

### Requirement 16: Library Integration and Built-in UI Kit (Phase 3)

**User Story:** As a designer, I want the component library to create real masters, so that library components stay linked and editable.

#### Acceptance Criteria

1. WHEN the user inserts a Library component that was saved from a Component_Master and the Board_Document has no master created from that Library component, THE Board_Editor SHALL create the Component_Master with its bounds at least 100 canvas units away from the bounds of every existing Element, and create a Component_Instance whose center is at the viewport center, as one Undo_History entry.
2. WHEN the user inserts a Library component and the Board_Document already contains a Component_Master created from that Library component, THE Board_Editor SHALL create one new Component_Instance of the existing master at the viewport center and SHALL NOT create another Component_Master, as one Undo_History entry.
3. WHEN the user saves a Component_Master to the Library, THE Board_Editor SHALL store the master, every master that its nested instances depend on, and the Tokens that its Elements reference, in one Library entry, using the name rules of Base Requirement 6.15 and 6.16.
4. WHEN the user inserts a Library component that was saved from plain Elements, THE Board_Editor SHALL insert plain Elements, as defined in Base Requirement 6.
5. THE Library SHALL include built-in components named button, input field, card, and navigation bar, each defined as a Component_Master.
6. WHEN the user inserts a built-in component, THE Board_Editor SHALL create the Component_Master and one Component_Instance, as defined in criterion 1, or only the Component_Instance, as defined in criterion 2.
7. THE Library SHALL define every color and font of the built-in components by reference to Tokens.
8. WHEN the user changes the value of a Token referenced by a built-in component, THE Board_Editor SHALL render every instance of that component with the new value within 500 ms.
9. WHERE Auto_Layout is available, THE Library SHALL define the built-in components with Auto_Layout.
10. WHERE Auto_Layout is available, WHEN the user changes the text of a built-in component instance, THE Board_Editor SHALL resize that instance to fit the new text according to its Auto_Layout settings, without changing the position of the instance's other properties set by the user, as one Undo_History entry.
11. WHERE the built-in kit is extended, THE Library SHALL include the additional components checkbox, toggle, avatar, and badge, each defined as a Component_Master. (Optional, later)
12. WHEN a Library component has been inserted and its Library entry is later modified or deleted, THE Board_Editor SHALL leave the inserted Component_Master and its Component_Instances unchanged, so that no live link exists between a Component_Master and the Library entry after insertion.
13. IF inserting a Library component fails because the Library entry is missing, unreadable, or references a master or Token that it does not contain, THEN THE Board_Editor SHALL leave the Board_Document unchanged, add no Undo_History entry, and show an error message indicating that the insertion failed.
14. IF saving a Component_Master to the Library fails, THEN THE Board_Editor SHALL leave the Library without a partial entry, leave the Board_Document unchanged, and show an error message indicating that the save failed.

### Requirement 17: Master Visibility in Exports (Phase 3, Optional)

**User Story:** As a designer, I want to leave component masters out of exports, so that exported screens do not include my design-system workspace.

#### Acceptance Criteria

1. WHEN the user initiates an export and the document contains at least one Component_Master, THE Exporter SHALL present an option "Exclude component masters" that is disabled by default on every export initiation.
2. WHERE the option "Exclude component masters" is enabled, THE Exporter SHALL omit every Component_Master, every descendant of a Component_Master (including a Component_Instance nested inside a Component_Master), and every connector with an endpoint on an omitted Element from the output. THE Exporter SHALL keep every other Component_Instance with its position, size, and appearance unchanged. THE Exporter SHALL compute the export bounds from the remaining Elements only. THE Exporter SHALL leave the source document unmodified.
3. WHERE the option "Exclude component masters" is enabled and the export scope is all Frames, THE Exporter SHALL produce exactly one file for each Frame that is not a Component_Master and SHALL produce no file for any Frame that is a Component_Master.
4. IF the option "Exclude component masters" is enabled and the export scope contains zero Elements after omission, THEN THE Exporter SHALL abort without writing any file, SHALL show the message that there is nothing to export as defined in Base Requirement 12.12, and SHALL leave the source document unmodified.

### Requirement 18: Derived Geometry Pass in Every Transaction (Phase 3 and 4)

**User Story:** As an agent author and as a user, I want instance sync and layout to land in the same undo step as my edit, so that one undo restores everything and clients always see consistent geometry.

#### Acceptance Criteria

1. WHEN `BoardModel.transact` finishes the edit callback, THE BoardModel SHALL run the Derived_Geometry_Pass before it runs the invariant check.
2. THE Derived_Geometry_Pass SHALL run the Sync_Pass first and the Layout_Pass second, and the Layout_Pass SHALL operate on the Board_Document state produced by the Sync_Pass.
3. WHEN a transaction commits, THE BoardModel SHALL record the edit and all changes made by the Derived_Geometry_Pass as exactly one Undo_History entry, so that one Undo restores the Board_Document to its state before the edit.
4. WHEN a transaction is committed from the webview, from an MCP tool call, or from a code-mode script, THE BoardModel SHALL run the Derived_Geometry_Pass for that transaction, because all three use the same BoardModel transaction.
5. THE Derived_Geometry_Pass SHALL be idempotent, so that running the pass a second time on its own output produces zero patches.
6. THE Derived_Geometry_Pass SHALL terminate for every Board_Document, including a Board_Document with cyclic Component_Instance references or cyclic Layout_Frame nesting, within at most 10 combined Sync_Pass and Layout_Pass iterations.
7. IF the Derived_Geometry_Pass throws an error, exceeds the 10-iteration limit, or does not reach a stable result, THEN THE BoardModel SHALL abort the transaction, leave the Board_Document content and the Undo_History unchanged, emit no change notification to subscribers, and return an error indicating the failure reason, as defined in Base Requirement 10.7.
8. WHILE a Board_Document contains no Component_Instance and no Layout_Frame, THE Derived_Geometry_Pass SHALL produce zero patches, add zero Undo_History entries, and complete within 5 ms for 1,000 Elements on the reference machine.
9. WHEN an atomic Agent_Tool batch or a code-mode script reads an Element after an earlier operation of the same batch or script, THE Tool_Registry SHALL return geometry that includes the effect of the Derived_Geometry_Pass for the earlier operations.
10. WHEN an Agent_Tool completes, THE Tool_Registry SHALL report the total count of Elements whose geometry differs from its value before the Agent_Tool ran because of the Derived_Geometry_Pass, and the ids of up to 500 of those Elements in ascending id order, and the count SHALL be 0 with an empty id list if no Element changed.
11. IF more than 500 Elements changed geometry because of the Derived_Geometry_Pass, THEN THE Tool_Registry SHALL report the first 500 ids in ascending id order, the full total count, and an indication that the id list is truncated.
12. WHEN the Undo_History applies an Undo or a Redo, THE BoardModel SHALL apply the stored patches and SHALL NOT run the Derived_Geometry_Pass again.
13. WHEN the Undo_History applies a Redo, THE BoardModel SHALL reapply both the edit and the changes made by the Derived_Geometry_Pass, so that the resulting Board_Document equals the state after the original transaction.
14. WHEN the Derived_Geometry_Pass runs, THE Derived_Geometry_Pass SHALL update the geometry of locked Elements in the same way as unlocked Elements, so that the lock only prevents direct user edits.

### Requirement 19: Auto Layout on Frames (Phase 4)

**User Story:** As a designer, I want a Frame to arrange its children in a row or column with gap and padding, so that content reflows when text changes.

#### Acceptance Criteria

1. THE Board_Document SHALL store an optional `layout` on each Frame with: a direction of `horizontal` or `vertical`, a gap from 0 to 1,000 canvas units, padding for top, right, bottom, and left from 0 to 1,000 canvas units each, a main-axis alignment of `start`, `center`, `end`, or `spaceBetween`, and a cross-axis alignment of `start`, `center`, or `end`.
2. THE Layout_Pass SHALL order the direct children of a Layout_Frame, excluding children with `ignoreLayout` set to true, by the center of each child along the main axis in ascending order, with the stored order of the children as the tie-break.
3. THE Layout_Pass SHALL place the first child at the padding offset of the Layout_Frame, and SHALL place each next child after the previous child plus the gap, adjusted by the main-axis alignment as follows: for `start`, the first child begins at the start padding edge; for `center`, the run of children including gaps is centered within the Layout_Frame's inner area (the frame size minus padding); for `end`, the last child ends at the end padding edge; for `spaceBetween`, the first child begins at the start padding edge, the last child ends at the end padding edge, and the free space is divided equally between adjacent children in place of the gap (a single child is placed as for `start`).
4. THE Layout_Pass SHALL align each child on the cross axis according to the cross-axis alignment: for `start`, the child's near edge is at the near padding edge; for `center`, the child is centered within the inner area; for `end`, the child's far edge is at the far padding edge.
5. THE Layout_Pass SHALL write the computed positions and sizes to `x`, `y`, `width`, and `height` of the children in absolute document coordinates, rounded to 2 decimal places.
6. THE Layout_Pass SHALL compute layout from the unrotated bounds of each child.
7. WHEN the Layout_Pass changes the geometry of an Element, THE Canvas SHALL re-route all Edges attached to that Element, as defined in Base Requirement 8.4.
8. WHEN the user enables Auto_Layout on a Frame, THE Board_Editor SHALL store a `layout` with direction `horizontal`, gap 0, padding 0 on all four sides, main-axis alignment `start`, and cross-axis alignment `start`, unless the user specifies other valid values, SHALL arrange any children by the Layout_Pass, and SHALL record the change as one Undo_History entry (including when the Frame has no children).
9. WHEN the user disables Auto_Layout on a Layout_Frame, THE Board_Editor SHALL remove `layout`, keep every child at its current position and size, and record the change as one Undo_History entry.
10. IF the user or an Agent_Tool sets a `layout` value that is outside its allowed range, is not one of the allowed alignment or direction values, or is not a finite number where a number is required, THEN THE Properties_Panel or THE Tool_Registry SHALL reject the value with an error that names the property path, and the Board_Document SHALL remain unchanged.
11. WHEN the user drags a child of a Layout_Frame and releases the pointer, THE Layout_Pass SHALL reorder the child according to its new position along the main axis, SHALL place every child at its computed position (including when the order is unchanged), and SHALL record the move and the reflow as one Undo_History entry.
12. WHEN a Board_Document uses `layout`, THE Serializer SHALL write Schema_Version 2.
13. THE Layout_Pass SHALL complete within 50 ms for a Layout_Frame with 200 children on the reference machine.
14. WHERE a child has `ignoreLayout` set to true, THE Layout_Pass SHALL leave the position and size of that child unchanged and exclude it from the arrangement of the other children. (Optional, later)
15. WHEN a child is added to or removed from a Layout_Frame, the width or height of a child of a Layout_Frame changes (including through a text edit), or a `layout` value of a Layout_Frame changes, THE Layout_Pass SHALL re-arrange the children of that Layout_Frame, and THE Board_Editor SHALL record the re-arrangement in the same Undo_History entry as the triggering change.
16. IF the total size of the arranged children along the main axis, including gaps, exceeds the inner area of the Layout_Frame, THEN THE Layout_Pass SHALL place the children from the start padding edge with the configured gap, SHALL leave the width and height of the Layout_Frame unchanged, and SHALL allow children to extend beyond the far edge of the Layout_Frame.

### Requirement 20: Child Sizing Modes (Phase 4)

**User Story:** As a designer, I want elements that hug their content or fill the available space, so that buttons grow with their label and rows share width.

#### Acceptance Criteria

1. THE Board_Document SHALL store an optional `sizing` on each Element that holds one Sizing_Mode of `fixed`, `hug`, or `fill` for the width and one Sizing_Mode of `fixed`, `hug`, or `fill` for the height, and THE Layout_Pass SHALL treat an Element with no `sizing` as `fixed` on both axes.
2. WHERE the Sizing_Mode of an Element is `fixed` on an axis, THE Layout_Pass SHALL keep that dimension of the Element equal to its stored value.
3. WHERE the Sizing_Mode of a Layout_Frame is `hug` on an axis, THE Layout_Pass SHALL set that dimension to the content size on that axis plus the padding of that axis, with a minimum of 1 canvas unit, where the content size on the main axis is the sum of the child dimensions plus the gaps between children, and the content size on the cross axis is the largest child dimension (0 if the Layout_Frame has no children).
4. WHERE the Sizing_Mode of a Text_Bearing_Element is `hug` on an axis, THE Layout_Pass SHALL set that dimension from the Text_Measurer result for the text, with a minimum of 1 canvas unit.
5. WHERE the Sizing_Mode of a child on the main axis of its Layout_Frame is `fill`, THE Layout_Pass SHALL set the dimension of each such child to the space left after padding, gaps, and the fixed and hug children, divided by the number of `fill` children on that axis, with a minimum of 1 canvas unit per child, even if the children then exceed the inner size of the Layout_Frame.
6. WHERE the Sizing_Mode of a child on the cross axis is `fill`, THE Layout_Pass SHALL set that dimension to the inner size of the Layout_Frame on the cross axis (the Layout_Frame dimension minus the padding of that axis), with a minimum of 1 canvas unit.
7. IF the Sizing_Mode `fill` is set on an Element whose parent is not a Layout_Frame, THEN THE Layout_Pass SHALL size that Element as `fixed` on that axis and keep the stored `sizing` value unchanged.
8. IF a Layout_Frame is `hug` on an axis and a child is `fill` on that same axis, THEN THE Layout_Pass SHALL size the child as `hug` on that axis, so that no circular sizing occurs, and keep the stored `sizing` value of the child unchanged.
9. THE Layout_Pass SHALL resolve `hug` sizes from the innermost Layout_Frame outward and SHALL resolve `fill` sizes and positions from the outermost Layout_Frame inward.
10. WHEN the user resizes a Layout_Frame on an axis in which it is `hug`, THE Board_Editor SHALL set the dimension on that axis to the size the user chose, change the Sizing_Mode of that axis to `fixed`, and leave the Sizing_Mode of the other axis unchanged.
11. WHEN the user changes the Sizing_Mode of an Element, THE Board_Editor SHALL record the change and all resulting dimension and position changes from the reflow as one Undo_History entry, so that a single undo restores the previous Sizing_Mode and the previous dimensions and positions.
12. THE Layout_Pass SHALL leave the position and size of an Element unchanged when the Element is outside a Layout_Frame and its Sizing_Mode is `fixed` or absent on both axes.
13. IF the Sizing_Mode `hug` is set on an axis of an Element that is neither a Layout_Frame nor a Text_Bearing_Element, THEN THE Layout_Pass SHALL size that Element as `fixed` on that axis and keep the stored `sizing` value unchanged.
14. IF the Text_Measurer fails to return a result for a Text_Bearing_Element that is `hug` on an axis, THEN THE Layout_Pass SHALL keep the current dimension of that Element on that axis and continue the layout of the remaining Elements.

### Requirement 21: Nested Frames (Phase 4)

**User Story:** As a designer, I want Frames inside Frames, so that I can build screens from sections, rows, and components.

#### Acceptance Criteria

1. THE Board_Editor SHALL allow a Frame to be a child of another Frame, where each child `parentId` references an existing Frame and the nesting depth is at most 16, with a Frame that has no Frame parent having a nesting depth of 1 and each Frame level below it adding 1.
2. WHEN the user runs "Move into Frame" for a selection and a target Frame, THE Board_Editor SHALL set the target Frame as `parentId` of each selected Element, including Frames, except Elements whose ancestor Frame is also selected, which keep their current `parentId`, and SHALL record the change as one Undo_History entry.
3. WHEN the user runs "Move out of Frame" for a selection, THE Board_Editor SHALL set `parentId` of each selected Element that has a parent Frame to the `parentId` of that parent Frame, or clear `parentId` if the parent Frame has no parent, leave Elements without a parent unchanged, and record the change as one Undo_History entry.
4. WHEN the user drops a selection on a Layout_Frame, THE Board_Editor SHALL set that Layout_Frame as `parentId` of each dropped Element, including Frames, and record the drop as one Undo_History entry, and the Layout_Pass SHALL arrange the dropped Elements within that Layout_Frame.
5. WHEN an Agent_Tool sets `parentId` of an Element of any type, including a Frame, to an existing Frame, THE Tool_Registry SHALL accept the change unless criterion 6 applies.
6. IF an edit, made by the user or by an Agent_Tool, would make a Frame an ancestor of itself, would give any Frame a nesting depth above 16 (including the Frames nested below a moved Frame), or would set `parentId` to an Element that is not an existing Frame, THEN THE Board_Editor SHALL reject the whole edit, show or return an error indicating the reason, and leave the Board_Document and Undo_History unchanged.
7. WHEN the user moves a Frame, THE Board_Editor SHALL move all descendants of the Frame, at every nesting level, by the same offset as the Frame, as defined in Base Requirement 6.12.
8. WHEN the user deletes a Frame that has nested Frames, THE Board_Editor SHALL remove only the deleted Frame, clear `parentId` of each direct child of the deleted Frame, keep those children on the board at their positions, leave the `parentId` of every deeper descendant unchanged, and record the deletion as one Undo_History entry.
9. WHEN the export scope is all Frames, THE Exporter SHALL produce one file for each Frame that has no Frame parent, and WHEN the export scope is a single Frame, THE Exporter SHALL allow selection of any Frame, including a nested Frame.
10. THE Board_Editor SHALL keep the creation-time adoption of Base Requirement 6.12 unchanged, so that creating a Frame makes only non-Frame Elements fully inside its bounds children of that Frame and does not change the `parentId` of any existing Frame.

### Requirement 22: Frame Resize and Layout Reflow (Phase 4)

**User Story:** As a designer, I want resizing a screen or container to reflow its content, so that I can test layouts at different sizes.

#### Acceptance Criteria

1. WHEN the user resizes a Layout_Frame, THE Layout_Pass SHALL recompute the size and position of every child, including `fill` children, and SHALL cascade through every nested Layout_Frame, in the same Undo_History entry as the resize.
2. WHEN the size of a child of a Layout_Frame changes, THE Layout_Pass SHALL recompute that Layout_Frame and, for each ancestor Layout_Frame up to the root whose Sizing_Mode is `hug` on the affected axis, SHALL update the ancestor's size on that axis in the same Undo_History entry as the change.
3. WHEN the text of a Text_Bearing_Element with Sizing_Mode `hug` changes, THE Layout_Pass SHALL recompute the layout of every ancestor Layout_Frame up to the root in the same Undo_History entry as the text change.
4. WHEN the user resizes a Frame that has no `layout`, THE Board_Editor SHALL apply the new size to the Frame and leave the size and position of each of its children unchanged.
5. WHEN a Component_Instance of a master with Auto_Layout has an Override that changes the size of an Instance_Child, THE Layout_Pass SHALL recompute the instance layout in the same Undo_History entry as the Override and SHALL leave the master unchanged.
6. THE Layout_Pass SHALL produce identical x, y, width, and height values for every element of the same Board_Document on every platform and in every host, with no dependence on the DOM or installed fonts.
7. FOR ALL Board_Documents, running the Layout_Pass twice SHALL produce a Board_Document whose serialized form is identical to the one produced by running it once (idempotence property).
8. FOR ALL Layout_Frames with `fixed` sizing, no child in the Layout_Pass output SHALL extend beyond the inner bounds of the Layout_Frame, unless the sum of the sizes of the fixed children, gaps, and padding exceeds the Layout_Frame size. In that case, THE Layout_Pass SHALL keep each fixed child at its specified size, place children in order from the inner start edge, and set the size of every `fill` child to 1 canvas unit, consistent with Requirement 20 criterion 5.
9. WHEN the user resizes a Layout_Frame whose subtree contains up to 500 elements, THE Layout_Pass SHALL complete the recomputation within 100 milliseconds.
10. IF the Layout_Pass fails during a resize, a child size change, a text change, or an Override, THEN THE Board_Editor SHALL discard the triggering change, leave the Board_Document and Undo_History unchanged, and show an error notification indicating that the layout could not be computed.

### Requirement 23: Icons from a Curated Lucide Subset (Phase 5)

**User Story:** As a designer, I want vector icons that I can recolor and resize, so that my screens look like real apps.

#### Acceptance Criteria

1. THE Board_Document SHALL support an Element type `icon` with a `name` of 1 to 64 characters, using the Element position, size, rotation, opacity, stroke color, and stroke width.
2. THE OpenBoard SHALL embed an Icon_Set of at least 100 icons from the Lucide icon set as vector path data, with the list of included icon names documented in the project documentation, and with an increase of no more than 150 KB (153,600 bytes) in the size of the built extension bundle compared to a build without the Icon_Set.
3. WHEN the user selects an icon in the icon picker and then clicks the canvas with the Icon tool active, or WHEN an Agent_Tool creates an Icon, THE Board_Editor SHALL create the Icon with a default size of 24 by 24 canvas units, a default stroke width of 2 canvas units, and the default stroke color that the Board_Editor applies to new Elements for the current theme kind, unless the Agent_Tool call specifies a size, stroke width, or stroke color; for a click-created Icon, THE Board_Editor SHALL center the Icon on the click position.
4. THE Renderer SHALL render an Icon as vector paths scaled to fit the Element width and height, drawn with the stroke color and stroke width of the Element, with the stroke width measured in canvas units and unchanged by the Element size, with no external reference and no `foreignObject` element.
5. WHEN the Exporter writes SVG, PNG, JPEG, WebP, or PDF, THE Exporter SHALL include every Icon within the export scope in the output with the same position, size, rotation, opacity, stroke color, and stroke width as in the Renderer.
6. IF an Icon `name` is not in the Icon_Set, THEN THE Renderer SHALL render a placeholder glyph within the Element bounds, drawn with the Element stroke color and stroke width, and SHALL NOT display an error to the user.
7. WHEN the user types in the icon picker filter field in the Properties_Panel, THE Properties_Panel SHALL display only the icons of the Icon_Set whose name or keyword contains the entered text, ignoring letter case, within 100 ms of each keystroke, and SHALL display an indication that no icons match if the result is empty.
8. WHEN the user activates the Icon tool in the Tool_Palette, THE Tool_Palette SHALL open the icon picker.
9. WHEN an Icon is part of a Component_Master, THE Board_Editor SHALL allow the user to set the Icon `name` as an Override in each Component_Instance, leaving the Component_Master and all other Component_Instances unchanged.
10. WHEN an Agent_Tool calls the icon name search of the Tool_Registry with a keyword of 1 to 64 characters, THE Tool_Registry SHALL return the names of the Icon_Set icons whose name or keyword contains the keyword, ignoring letter case, ordered alphabetically by name, with at most 50 results per call and an empty list if no icon matches.
11. WHEN the `.vsix` is packaged, THE OpenBoard SHALL include in the `.vsix` the license text and attribution notices that the Lucide license requires.
12. WHEN the Serializer writes a Board_Document that contains at least one Icon, THE Serializer SHALL write Schema_Version 2.
13. IF a create or update of an Icon, by the user or by an Agent_Tool, specifies a `name` that is empty or longer than 64 characters, THEN THE Board_Editor SHALL reject the operation, leave the Board_Document unchanged, and return an error indicating the allowed name length of 1 to 64 characters.
14. IF a Board_Document contains an Icon whose `name` is not in the Icon_Set, THEN THE Parser SHALL keep the `name` unchanged and SHALL NOT report a validation error for the `name`.
15. IF a Board_Document contains an Icon whose `name` is not in the Icon_Set, THEN THE Serializer SHALL write the `name` back unchanged.

### Requirement 24: Device Frame Presets (Phase 5)

**User Story:** As a designer, I want phone, tablet, and browser frames, so that I can present screens in a realistic device.

#### Acceptance Criteria

1. THE OpenBoard SHALL provide exactly three Device_Frame_Presets, one phone, one tablet, and one browser window, each defined as a separate Component_Master in the built-in Library.
2. THE OpenBoard SHALL size the phone preset at 390 canvas units wide by 844 canvas units high, the tablet preset at 820 canvas units wide by 1180 canvas units high, and the browser preset at 1440 canvas units wide by 900 canvas units high.
3. THE Device_Frame_Presets SHALL set `clipContent` to true on the root Element of each preset.
4. THE Device_Frame_Presets SHALL use Corner_Radii greater than 0 on all four corners of the device outline for the phone and tablet presets, and on at least the two top corners of the device outline for the browser preset.
5. THE Device_Frame_Presets SHALL use Icons, and no other Element type, for status glyphs in the phone and tablet presets and for toolbar glyphs in the browser preset.
6. WHEN the user inserts a Device_Frame_Preset, THE Board_Editor SHALL create the Component_Master and a Component_Instance as defined in Requirement 16, with the Component_Instance sized at the preset dimensions defined in criterion 2.
7. WHEN the user adds an Element inside a Component_Instance of a Device_Frame_Preset, THE Board_Editor SHALL store that Element as a User_Child of the Component_Instance.
8. WHILE an Element that is a User_Child of a Component_Instance of a Device_Frame_Preset extends beyond the device screen shape, THE Renderer SHALL draw only the portion of that Element inside the device screen shape and SHALL leave the Element's stored geometry unchanged.
9. IF inserting a Device_Frame_Preset fails, THEN THE Board_Editor SHALL show an error message indicating that the insertion failed and SHALL leave the document unchanged, with no Component_Master or Component_Instance added.
10. THE Library SHALL keep the existing device outline component as defined in Base Requirement 6.14 and the existing Frame size presets as defined in Base Requirement 6.13 available and unchanged after the Device_Frame_Presets are added.

### Requirement 25: Agent and Code-Mode Reachability

**User Story:** As an agent author, I want every new capability available to agents, so that agents can build mockups as well as users can.

#### Acceptance Criteria

1. WHEN an Agent_Tool creates or updates an Element, THE Tool_Registry SHALL accept every Mockup_Field in the polymorphic element create and update input and SHALL validate each Mockup_Field with the same schemas as in Requirement 4.
2. THE Tool_Registry SHALL provide Agent_Tool actions to create, update, rename, delete, and list Tokens.
3. THE Tool_Registry SHALL provide Agent_Tool actions to create a Component_Master, list Component_Masters, create a Component_Instance, set an Override, reset an Override, detach a Component_Instance, and insert a Library component.
4. THE code-mode `ob` API SHALL expose one callable function for each Agent_Tool action of criteria 1 to 3, accepting the same inputs, applying the same validation, and returning the same results and errors as the corresponding Agent_Tool action.
5. WHEN the schema Agent_Tool is invoked for an Element type, THE Tool_Registry SHALL return every Mockup_Field applicable to that Element type, each with its value type and a non-empty description.
6. THE Tool_Registry SHALL support query and filter on each of `instanceOf`, the component marker, `parentId`, and Token references, SHALL return only Elements whose value for the filtered field equals the supplied value (for Token references, Elements that reference the supplied Token in at least one Mockup_Field), and SHALL return only Elements that match all filters when multiple filters are supplied.
7. THE OpenBoard SHALL keep the Agent_Surface at exactly five top-level tools and SHALL register every new action through the Tool_Registry without per-tool registration code, as defined in Base Requirement 13.13.
8. THE Agent_Surface SHALL stay within the size budget that the existing `surfaceSize` test asserts, and any budget increase SHALL be made only through an explicit change to that test.
9. THE OpenBoard SHALL update the agent skill documentation so that each Mockup_Field, each new action, and the Derived_Geometry_Pass is described with at least one example.
10. WHEN an Agent_Tool creates or edits Elements with Mockup_Fields, THE Tool_Registry SHALL apply the same validation and the same handlers as the user interface, as defined in Base Requirement 13.12.
11. THE Tool_Registry SHALL provide for each new Agent_Tool an input schema and an output schema, and SHALL satisfy Base Requirements 13.9, 13.10, and 13.11.
12. IF an Agent_Tool or `ob` API call supplies a Mockup_Field value that fails validation, THEN THE Tool_Registry SHALL reject the entire call with an error that identifies the invalid Mockup_Field and the violated constraint, and SHALL leave the document unchanged.
13. IF an Agent_Tool or `ob` API call references a Token, Component_Master, Component_Instance, Element, or Library component that does not exist, THEN THE Tool_Registry SHALL reject the call with an error that identifies the missing item and its supplied identifier, and SHALL leave the document unchanged.

### Requirement 26: Webview Properties Panel and Palette Reachability

**User Story:** As a user, I want every new capability available in the interface, so that I can design without writing code.

#### Acceptance Criteria

1. WHILE one or more Elements are selected, THE Properties_Panel SHALL display one control for each applicable new property: Corner_Radii, font weight, text color, text wrap, image fill, clip content, Token application, Auto_Layout, Sizing_Mode, and `ignoreLayout`.
2. THE Tool_Palette SHALL provide one control that activates the Icon tool and one control that opens the component panel, and SHALL keep exactly one tool active at any time.
3. THE Board_Editor SHALL provide every new control with an accessible name that is non-empty, unique within its panel, and exposed to assistive technologies, and SHALL make every new control reachable and operable by keyboard alone, as defined in Base Requirement 5.14.
4. THE OpenBoard SHALL provide every new user-visible string through the IDE localization mechanism, as defined in Base Requirement 18.9.
5. THE Board_Editor SHALL derive the colors of every new control and indicator from VS Code theme CSS variables, as defined in Base Requirement 4.1.
6. WHEN the user commits a valid value in a new control, THE Board_Editor SHALL apply that value to the selected Elements, using the same validation rules as the corresponding Agent_Tool.
7. WHEN multiple Elements are selected with differing values for a new property, THE Properties_Panel SHALL display that property as mixed, and WHEN the user commits a new value for it, THE Properties_Panel SHALL apply that value to all selected Elements and leave every property the user did not edit unchanged, as defined in Base Requirement 6.8.
8. THE Board_Editor SHALL provide each new action as an Agent_Tool, as defined in Base Requirement 13.2.
9. WHILE the selection is a single Component_Master or a single Component_Instance, THE Properties_Panel SHALL display a component name control, and WHILE the selection is a single Component_Instance, THE Properties_Panel SHALL also display "Detach Instance", "Reset Overrides", and "Go to master" controls.
10. IF a value committed in a new control fails the validation rules of the corresponding Agent_Tool, THEN THE Board_Editor SHALL reject the value, SHALL retain the property's previous value on all selected Elements, and SHALL show an error indicating the reason adjacent to the control, as defined in Base Requirement 6.7.
11. WHEN the user opens the context menu on a selection to which a new action applies, THE Board_Editor SHALL list that action in the context menu, as defined in Base Requirement 13.2.

### Requirement 27: Performance

**User Story:** As a user, I want boards with many components and layouts to stay responsive, so that mockup features do not slow down my work.

#### Acceptance Criteria

1. WHEN an edit to a Component_Master that has 100 Component_Instances with 20 Instance_Children each is committed, THE BoardModel SHALL complete the Sync_Pass and the Layout_Pass within 250 ms on the reference machine, measured from the commit to the completion of the Layout_Pass as the median of 5 runs.
2. WHEN the user opens a Board_File that contains up to 5,000 Elements and uses Mockup_Fields, THE Board_Editor SHALL display the Canvas within 3 seconds on the reference machine, measured from the open action to the first completed frame, as defined in Base Requirement 17.1.
3. WHEN the user drags a selection of up to 200 Elements that include Layout_Frames, Component_Instances, or clipped Frames, THE Canvas SHALL update at no less than 30 frames per second on the reference machine, measured as the average over the duration of the drag, as defined in Base Requirement 17.3.
4. THE Renderer SHALL resolve a Token_Reference without adding more than 1 ms to the rendering of 1,000 Elements on the reference machine, measured as the difference between the median render time of 5 runs of 1,000 Elements that use Token_References and the median render time of 5 runs of the same 1,000 Elements with literal values.
5. WHILE the Canvas is displayed, THE Canvas SHALL render only Elements whose bounding boxes intersect the viewport expanded by 256 pixels on each side, and SHALL apply this rule equally to clipped Elements, Layout_Frames, Component_Instances, and Instance_Children, as defined in Base Requirement 17.2.
6. IF a Board_File that uses Mockup_Fields contains more than 5,000 Elements, THEN THE Board_Editor SHALL open the Board_File, display the Canvas, and display a notice indicating that performance targets are not guaranteed for boards of that size, as defined in Base Requirement 17.6.

### Requirement 28: Testability and Quality

**User Story:** As a maintainer, I want automated tests for the new behavior, so that format, layout, and component behavior stay correct as OpenBoard evolves.

#### Acceptance Criteria

1. THE OpenBoard SHALL include automated tests that extend the round-trip tests of Base Requirement 19.1 so that each test run generates at least 100 random Board_Documents, each containing at least one value for every Mockup_Field, and asserts that parsing the serialized output of each document yields a Board_Document deeply equal to the original, with no field added, removed, or changed.
2. THE OpenBoard SHALL include an automated test that asserts, for each Mockup_Field, that the field is absent from every extra-properties bag in a Board_Document after parsing a Board_File that contains that field.
3. THE OpenBoard SHALL include property-based tests that, for each of the Sync_Pass, the Layout_Pass, and the Derived_Geometry_Pass, run on at least 100 generated Board_Documents per test run and assert both of the following: (a) idempotence, meaning that running the pass a second time on its own output leaves the Board_Document deeply equal to the output of the first run; (b) termination, meaning that the pass completes within 5 seconds per document. The generated documents SHALL include documents with instance nesting depth of at least 3, Frame nesting depth of at least 3, and at least one component cycle.
4. THE OpenBoard SHALL include automated tests that apply an edit that triggers the Derived_Geometry_Pass, perform one Undo, and then perform one Redo, and assert that the Board_Document after Undo is deeply equal to the Board_Document before the edit and that the Board_Document after Redo is deeply equal to the Board_Document after the edit.
5. THE OpenBoard SHALL include automated tests that apply the same edit through the webview path, through an MCP tool call, and through a code-mode script, and assert that the three resulting Board_Documents are deeply equal and that each path adds exactly 1 Undo_History entry.
6. THE OpenBoard SHALL include automated tests that assert, for at least 3 stored fixture Board_Files that contain no Mockup_Field, that the Serializer output and the SVG output are byte-identical to the stored expected output for each fixture.
7. THE OpenBoard SHALL include automated tests that, for each new Agent_Tool, validate at least 1 generated valid input and 1 generated invalid input against the input schema, and at least 1 generated valid output and 1 generated invalid output against the output schema, and assert that each valid sample is accepted and each invalid sample is rejected, as defined in Base Requirement 19.2.
8. THE OpenBoard SHALL include automated tests that run the Text_Measurer and the Layout_Pass on at least 100 generated inputs in each of the webview bundle, the Extension_Host bundle, and the code-mode sandbox, and assert that the numeric results for each input are identical across all three environments.
9. THE OpenBoard SHALL include migration tests that open a stored Schema_Version 1 fixture and assert that the Board_Document is at the current Schema_Version in memory, and that saving a document without Schema_V2_Features writes a Board_File with Schema_Version 1.
10. THE OpenBoard SHALL include an automated test that simulates a build with a lower current Schema_Version, opens a Schema_Version 2 fixture, and asserts that the Board_Document opens as read-only, that a save attempt is rejected with an error indication, and that the fixture file content is unchanged after the save attempt.
11. THE OpenBoard SHALL include automated tests that assert, for each export format, that the output of a Board_Document containing Icons, Image_Fills, Corner_Radii, clipping, and Token colors contains a rendering of each of those five features.
12. IF any automated test required by criteria 1 to 11 fails, THEN THE OpenBoard SHALL report the test run as failed with a non-zero exit status, identify each failing test by name, and, for each failing property-based test, report the random seed and the generated input that caused the failure.
