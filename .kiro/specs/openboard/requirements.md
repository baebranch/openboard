# Requirements Document

## Introduction

OpenBoard is a VS Code and Open VSX compatible extension that provides an infinite whiteboard, flow chart, and UI/UX mockup editor inside the IDE. Boards are stored in `.openboard` files (versioned JSON) and edited through a custom editor. The canvas is built on ReactFlow, takes its colors from the active IDE theme, and offers a tool palette, properties panel, and interaction model inspired by Excalidraw, Miro, pen.dev, and pencil.dev.

Every user action is also available to IDE agents through a single schema-driven tool registry. The registry is exposed through the VS Code Language Model Tools API, commands, and the extension's exported API. OpenBoard does not run a standalone, global, or MCP server. All state is scoped to the extension host of a single IDE window and to individual documents, so several IDE windows never interfere with each other.

## Glossary

- **OpenBoard**: The VS Code extension that is the subject of this document.
- **Board_Editor**: The custom editor that opens `.openboard` files in a webview.
- **Canvas**: The ReactFlow-based infinite, pannable and zoomable drawing surface inside the Board_Editor.
- **Board_Document**: The in-memory model of one open `.openboard` file.
- **Board_File**: The `.openboard` file on disk, containing a Board_Document serialized as JSON.
- **Element**: Any object on the Canvas, including shapes, text, images, freehand strokes, flow nodes, edges, and frames.
- **Flow_Node**: An Element that represents a step in a flow diagram and can be connected by Edges.
- **Edge**: A connector between two Flow_Nodes or Elements, with optional label, arrowheads, and routing style.
- **Freehand_Stroke**: An Element created by drawing directly on the Canvas with a pointer.
- **Frame**: An Element that groups other Elements and represents a screen, artboard, or export region.
- **Tool_Palette**: The UI control set from which the user selects a drawing or editing tool.
- **Properties_Panel**: The UI panel that shows and edits properties of the selected Elements.
- **Theme_Adapter**: The OpenBoard component that maps VS Code theme CSS variables to Canvas and UI colors.
- **Tool_Registry**: The single schema-driven registry that defines every OpenBoard action, with a name, description, JSON input schema, and handler.
- **Agent_Tool**: An entry of the Tool_Registry exposed to IDE agents.
- **LM_Tool_Bridge**: The OpenBoard component that registers Tool_Registry entries with the VS Code Language Model Tools API.
- **Exporter**: The OpenBoard component that renders a Board_Document or part of it into an image or document format.
- **Serializer**: The OpenBoard component that converts a Board_Document to Board_File content.
- **Parser**: The OpenBoard component that converts Board_File content to a Board_Document.
- **Schema_Version**: An integer in every Board_File that identifies the file format revision.
- **Extension_Host**: The VS Code process that runs OpenBoard code for one IDE window.
- **Asset**: A binary resource, such as an image, referenced by an Element.
- **Undo_History**: The ordered list of reversible edits for one Board_Document.

## Requirements

### Requirement 1: Extension Packaging and Compatibility

**User Story:** As a developer, I want to install OpenBoard from either the VS Code Marketplace or Open VSX, so that I can use it in VS Code and compatible IDEs.

#### Acceptance Criteria

1. THE OpenBoard SHALL be packaged as a single `.vsix` file that installs without error and activates in VS Code and in Open VSX-compatible IDEs.
2. THE OpenBoard SHALL declare a minimum VS Code engine version in its manifest and use only APIs available at that version.
3. WHILE the host machine has no network connectivity, THE OpenBoard SHALL perform all of its features, including install from a local `.vsix` file, activation, and Board_Editor use, with zero outbound network requests.
4. WHERE the host IDE does not provide the Language Model Tools API, THE OpenBoard SHALL activate without error and keep the Board_Editor, commands, and exported API functional, and SHALL skip registering language model tools.
5. THE OpenBoard SHALL install, activate, and run the Board_Editor, commands, and exported API on Windows, macOS, and Linux.
6. IF the host IDE version is lower than the declared minimum engine version, THEN THE OpenBoard SHALL remain uninstalled or inactive, and the host IDE SHALL show an incompatibility indication, with no changes made to existing user data.
7. WHEN THE OpenBoard activates in a host IDE, THE OpenBoard SHALL complete activation within 2000 milliseconds on a machine with a 4-core CPU and 8 GB RAM.

### Requirement 2: Custom Editor for Board Files

**User Story:** As a user, I want `.openboard` files to open in a visual editor, so that I can work on boards like any other file in the IDE.

#### Acceptance Criteria

1. WHEN the user opens a file with the `.openboard` extension, THE Board_Editor SHALL display the Board_Document on the Canvas within 2 seconds for a Board_File of up to 5 MB.
2. WHEN the user runs the "OpenBoard: New Board" command, THE OpenBoard SHALL create an empty Board_Document containing zero elements and open it in the Board_Editor as an unsaved, untitled board.
3. WHEN the user makes an edit in the Board_Editor that changes the Board_Document, THE Board_Editor SHALL mark the editor tab as modified within 500 milliseconds.
4. WHEN the user saves the Board_Document, THE Board_Editor SHALL clear the modified indicator on the editor tab and write the Board_Document to the Board_File.
5. WHEN the user opens the same Board_File in two editor tabs of one window, THE OpenBoard SHALL keep both tabs in sync with one shared Board_Document, so that an edit made in one tab appears in the other within 500 milliseconds.
6. WHEN the user runs "Reopen Editor With" and selects the text editor, THE OpenBoard SHALL show the Board_File content as JSON text.
7. WHEN the Board_File changes on disk outside the Board_Editor and the Board_Document has no unsaved edits, THE Board_Editor SHALL reload the Board_Document and display the new content within 2 seconds.
8. IF the Board_File changes on disk outside the Board_Editor while the Board_Document has unsaved edits, THEN THE Board_Editor SHALL keep the unsaved edits in the Board_Document and show a notification indicating that the file changed on disk.
9. IF the Board_File content cannot be parsed as a valid Board_Document, THEN THE Board_Editor SHALL show an error indication stating that the file is invalid, leave the Board_File on disk unmodified, and not display a Canvas for that file.
10. WHILE the Board_Editor tab is hidden, THE Board_Editor SHALL retain the Canvas viewport position and zoom level, so that after the tab becomes visible again both values equal those from before it was hidden.

### Requirement 3: Infinite Canvas Navigation

**User Story:** As a user, I want an infinite pannable and zoomable canvas, so that I can lay out large boards without boundaries.

#### Acceptance Criteria

1. THE Canvas SHALL render Elements at any position within a coordinate range of -1,000,000 to +1,000,000 units on each axis, inclusive.
2. WHEN the user scrolls the mouse wheel with the zoom modifier held, THE Canvas SHALL zoom so that the board point under the pointer remains within 1 pixel of the same screen position before and after the zoom step.
3. WHEN the user drags with the middle mouse button or with the Space key held, THE Canvas SHALL pan so that the viewport offset changes by the pointer movement distance, within 1 pixel, in the same direction as the drag.
4. THE Canvas SHALL limit the zoom level to a range of 2% to 800%, inclusive.
5. IF a zoom action would result in a zoom level below 2% or above 800%, THEN THE Canvas SHALL clamp the zoom level to the nearest limit and leave the viewport center unchanged.
6. WHEN the user triggers "Zoom to Fit" and the Board_Document contains at least 1 Element, THE Canvas SHALL set the viewport so that all Elements are fully visible with a margin of at least 32 pixels on each side, using the highest zoom level within 2% to 800% that satisfies this condition.
7. IF the user triggers "Zoom to Fit" and the Board_Document contains 0 Elements, THEN THE Canvas SHALL leave the viewport unchanged.
8. IF the bounds of all Elements cannot be fit within the viewport at the 2% minimum zoom level, THEN THE Canvas SHALL set the zoom level to 2% and center the viewport on the center of the Elements' combined bounds.
9. WHEN the user triggers "Zoom to Selection" and at least 1 Element is selected, THE Canvas SHALL set the viewport so that all selected Elements are fully visible with a margin of at least 32 pixels on each side, using the highest zoom level within 2% to 800% that satisfies this condition.
10. IF the user triggers "Zoom to Selection" and 0 Elements are selected, THEN THE Canvas SHALL leave the viewport unchanged.
11. WHERE the user enables the grid, THE Canvas SHALL display a background grid and, WHEN the user releases a moved Element, THE Canvas SHALL snap the Element's position to the nearest multiple of the grid spacing.
12. THE Canvas SHALL display a minimap showing the extents of all Elements and the current viewport, and SHALL display the current zoom percentage rounded to the nearest whole percent.
13. WHILE the Board_Document contains 1,000 Elements, THE Canvas SHALL sustain at least 30 frames per second, measured as the average over a 10-second continuous pan or zoom interaction, on a reference machine defined in the test plan.

### Requirement 4: IDE Theme Alignment

**User Story:** As a user, I want the board to match my IDE theme, so that the editor feels native and is readable in light, dark, and high-contrast modes.

#### Acceptance Criteria

1. THE Theme_Adapter SHALL derive all Board_Editor UI colors, including toolbar, panels, menus, and Canvas background, from VS Code theme CSS variables.
2. WHEN the user changes the IDE color theme, THE Theme_Adapter SHALL update all Board_Editor UI colors within 500 milliseconds, without reloading the Board_Document and without discarding unsaved edits, selection, or viewport position.
3. WHILE the IDE uses a high-contrast theme, THE Board_Editor SHALL render every toolbar button, panel, menu, and input control with a visible border using the theme's high-contrast border color and text using the theme's high-contrast foreground color.
4. THE Theme_Adapter SHALL provide a default Element stroke color and default text color that each meet a contrast ratio of at least 4.5:1 against the Canvas background in light, dark, and high-contrast themes.
5. WHEN the theme kind changes between light and dark, THE Theme_Adapter SHALL, within 500 milliseconds, remap every Element that uses the "theme default" color to the new default color, AND leave every Element with an explicitly assigned color unchanged.
6. THE Board_Editor SHALL use the IDE editor font family and font size settings for UI text.
7. WHEN the user creates a new text Element, THE Board_Editor SHALL assign the default Element font family to that text Element.
8. WHEN the user exports with the "Match theme" option disabled, THE Exporter SHALL render the output with a white background and the default light-theme colors, regardless of the current IDE theme.
9. IF a required VS Code theme CSS variable is undefined or empty, THEN THE Theme_Adapter SHALL use the built-in default color for the current theme kind for that variable, AND THE Board_Editor SHALL remain usable without displaying an error.

### Requirement 5: Tool Palette and Interaction Model

**User Story:** As a user, I want a familiar whiteboard toolbar and shortcuts, so that I can draw and edit quickly like in Excalidraw, Miro, or pen.dev.

#### Acceptance Criteria

1. THE Tool_Palette SHALL provide the tools: Select, Hand, Rectangle, Ellipse, Diamond, Line, Arrow, Freehand, Text, Image, Frame, Sticky_Note, and Eraser, with exactly one tool active at any time.
2. WHEN the user presses the keyboard shortcut of a tool while focus is not in a text input or text-editing Element, THE Tool_Palette SHALL activate that tool within 100 ms, highlight it, and remove the highlight from the previously active tool.
3. WHEN the user presses the Escape key, THE Tool_Palette SHALL activate the Select tool, discard any in-progress Element creation without adding an Element to the board, and preserve all existing Elements and the current selection state.
4. WHEN the user releases the pointer after drawing a marquee with the Select tool, THE Board_Editor SHALL select all unlocked Elements whose bounds intersect the marquee by at least 1 pixel and deselect all previously selected Elements, unless the Shift key is held, in which case THE Board_Editor SHALL add them to the existing selection.
5. WHEN the user selects one or more Elements, THE Board_Editor SHALL display 8 resize handles and 1 rotation handle around the selection bounds, and SHALL remove them within 100 ms when the selection becomes empty.
6. WHEN the user invokes copy, cut, paste, duplicate, delete, select-all, group, or ungroup, THE Board_Editor SHALL apply the operation to the selected Elements (or to all Elements for select-all) and SHALL make the operation reversible with a single undo action.
7. IF the user invokes an operation from criterion 6 that requires a selection (copy, cut, duplicate, delete, group, ungroup) while no Elements are selected, or paste while the clipboard contains no Elements, or group with fewer than 2 Elements selected, THEN THE Board_Editor SHALL leave the board unchanged and not add an undo entry.
8. WHEN the user invokes an align operation (left, center, right, top, middle, bottom) on 2 or more selected Elements, THE Board_Editor SHALL align the Elements to the corresponding edge or center of the selection bounds.
9. WHEN the user invokes a distribute operation (horizontal, vertical) on 3 or more selected Elements, THE Board_Editor SHALL set equal spacing between adjacent Elements along the chosen axis while keeping the two outermost Elements in place.
10. WHEN the user invokes a z-order operation (bring to front, send to back, forward, backward) on selected Elements, THE Board_Editor SHALL reorder the Elements in the stacking order, with forward and backward moving each selected Element by one position, and preserve the relative order among the selected Elements.
11. WHEN the user drags an Element and its edge or center comes within 8 screen pixels of the edge or center of another Element, THE Canvas SHALL display an alignment guide line and snap the dragged Element so the aligned edges or centers coincide, and SHALL remove the guide when the pointer is released or the distance exceeds 8 screen pixels.
12. WHEN the user opens the context menu by right-clicking or pressing the Shift+F10 or Menu key, THE Board_Editor SHALL display a menu listing only the actions applicable to the Element under the pointer (or the current selection when it contains that Element), or the canvas-level actions when no Element is under the pointer.
13. THE Board_Editor SHALL allow the user to perform tool selection, selection traversal to the next and previous Element (Tab and Shift+Tab), nudging selected Elements by 1 pixel (or 10 pixels with Shift) using arrow keys, and deletion of selected Elements using the Delete or Backspace key, without using a pointing device.
14. THE Board_Editor SHALL provide each toolbar control with an accessible name that is non-empty, unique within the toolbar, and exposed to assistive technologies, and SHALL make each toolbar control reachable and operable by keyboard.

### Requirement 6: Shapes, Text, and Styling

**User Story:** As a user, I want to place shapes and text and style them, so that I can build mockups and diagrams.

#### Acceptance Criteria

1. WHEN the user drags with a shape tool on the Canvas and releases the pointer, THE Board_Editor SHALL create a shape Element whose bounds match the dragged region to within 1 canvas unit and SHALL select the new Element.
2. IF the user releases the pointer after dragging with a shape tool and the dragged region is smaller than 4 canvas units in width or height, THEN THE Board_Editor SHALL create a shape Element with a default size of 100 by 100 canvas units centered on the release point.
3. WHEN the user clicks the Canvas with the Text tool, THE Board_Editor SHALL create an empty text Element at the click position and enter inline edit mode with the text caret in that Element.
4. IF the user exits inline edit mode of a text Element that contains no characters, THEN THE Board_Editor SHALL delete that text Element.
5. WHEN the user double-clicks a shape or Flow_Node, THE Board_Editor SHALL enter inline text edit mode for that Element within 100 milliseconds and preserve any existing text.
6. THE Properties_Panel SHALL edit the following properties of selected Elements: fill color, stroke color, stroke width (0 to 100 canvas units), stroke style (solid, dashed, dotted), opacity (0 to 100 percent), corner radius (0 to half of the shorter Element side), font family, font size (1 to 999 points), text alignment (left, center, right), and rotation (-360 to 360 degrees).
7. IF the user enters a property value outside its allowed range or a non-numeric value for a numeric property, THEN THE Properties_Panel SHALL reject the value, retain the previous property value, and display an error indication on the field.
8. WHEN multiple Elements are selected with differing values for a property, THE Properties_Panel SHALL display that property as mixed and apply any newly entered value to all selected Elements.
9. THE Properties_Panel SHALL edit the x position, y position, width, and height of a selected Element in canvas units with a precision of 2 decimal places, where width and height are at least 1 canvas unit.
10. WHILE the user holds the Shift key during a resize, THE Board_Editor SHALL preserve the aspect ratio of the Element within 1 percent of the original ratio.
11. THE Board_Editor SHALL support applying bold, italic, and underline styling to any selected character range within a text Element, and SHALL retain the styling when the Board_Document is saved and reopened.
12. WHEN the user creates a Frame, THE Board_Editor SHALL make each Element fully inside the Frame bounds a child of that Frame, so that moving the Frame moves its children by the same offset.
13. THE Board_Editor SHALL provide preset Frame sizes for at least 5 common device screens (including phone, tablet, and desktop) and at least 3 social post formats.
14. THE Board_Editor SHALL provide a library of reusable UI mockup components including button, input field, card, navigation bar, and device outline.
15. WHEN the user saves selected Elements as a reusable component with a name of 1 to 100 characters, THE Board_Editor SHALL store the component in the current Board_Document library and list it in the component library.
16. IF the user saves a reusable component with an empty name or no Elements selected, THEN THE Board_Editor SHALL reject the save, display an error indication, and leave the library unchanged.

### Requirement 7: Image and Asset Handling

**User Story:** As a user, I want to add photos and screenshots to the board, so that I can mock up UI/UX designs and social posts.

#### Acceptance Criteria

1. WHEN the user pastes an image from the clipboard, drops an image file onto the Canvas, or selects an image through the Image tool, THE Board_Editor SHALL create an image Element centered at the drop position for a drop, or at the viewport center for a paste or Image tool selection.
2. THE Board_Editor SHALL accept PNG, JPEG, GIF, WebP, and SVG image files as Assets, determined by file content type.
3. IF the user adds a file whose type is not PNG, JPEG, GIF, WebP, or SVG, THEN THE Board_Editor SHALL reject the file, show a message naming the accepted types, and leave the Board unchanged.
4. IF the user adds an image larger than 25 MB (26,214,400 bytes), THEN THE Board_Editor SHALL reject the file, show a message stating the 25 MB limit, and leave the Board unchanged. An image of exactly 25 MB SHALL be accepted.
5. WHEN an image Element is created, THE Board_Editor SHALL size the Element to the image's natural dimensions. IF the longer side exceeds 1,024 units, THEN THE Board_Editor SHALL scale the Element down proportionally so the longer side equals 1,024 units, preserving aspect ratio.
6. IF the image file cannot be decoded, THEN THE Board_Editor SHALL reject the file, show a message stating the image could not be read, and leave the Board unchanged.
7. WHEN the user drops or selects multiple image files at once, THE Board_Editor SHALL process each file independently, create an Element for each valid file, and show a rejection message for each invalid file.
8. THE Board_Editor SHALL support cropping, replacing the image source, rounded corners with a corner radius from 0 to 50% of the shorter side, and opacity from 0% to 100% for image Elements.
9. WHEN the user replaces the image source of an image Element with a valid file, THE Board_Editor SHALL keep the Element's position, rotation, and width, and adjust its height to match the new image's aspect ratio. IF the replacement file is rejected, THEN THE Board_Editor SHALL keep the original image source.
10. THE Serializer SHALL store each Asset once in the Board_File regardless of how many Elements reference that Asset.
11. WHEN the Serializer writes a Board_File and no Element references an Asset, THE Serializer SHALL omit that Asset from the Board_File.
12. THE Board_Editor SHALL support alt text of up to 500 characters on image Elements.

### Requirement 8: Flow Diagram Authoring

**User Story:** As a user, I want to build flow diagrams with connected nodes, so that I can document processes and architectures.

#### Acceptance Criteria

1. THE Tool_Palette SHALL provide exactly seven Flow_Node presets: start/end, process, decision, input/output, database, document, and annotation.
2. WHEN the user drags from a connection handle of a Flow_Node and releases on another Element, THE Board_Editor SHALL create one Edge whose source is the originating Flow_Node and whose target is the Element under the pointer.
3. WHEN the user drags from a connection handle and releases on an empty Canvas position, THE Board_Editor SHALL create one new Flow_Node of the process preset, centered at the release position, and one Edge from the originating Flow_Node to the new Flow_Node.
4. WHEN the user moves a connected Element, THE Canvas SHALL re-route all attached Edges so that each Edge endpoint remains attached to the moved Element, and SHALL complete the re-route within 100 ms of each pointer-move update for a board of up to 500 Elements.
5. THE Properties_Panel SHALL edit the following Edge properties: routing style (straight, curved, or orthogonal), arrowhead at the source end and at the target end, stroke style, and label text of 0 to 200 characters.
6. WHEN the user deletes an Element, THE Board_Editor SHALL delete all Edges attached to that Element as part of the same undoable operation.
7. WHEN the user creates an Edge whose source and target are the same Element, THE Board_Editor SHALL create a self-loop Edge that starts and ends on that Element and is visible outside the Element bounds.
8. WHEN the user triggers "Auto Layout" with a direction of top-to-bottom, bottom-to-top, left-to-right, or right-to-left, THE Board_Editor SHALL arrange the selected Flow_Nodes in a layered layout in that direction, such that no two Flow_Node bounds overlap and each Edge between selected Flow_Nodes points in the chosen direction, except for Edges that close a cycle.
9. WHEN the user triggers "Auto Layout", THE Board_Editor SHALL apply the result as a single undoable operation, such that one undo restores all selected Flow_Nodes to their pre-layout positions.
10. IF the user triggers "Auto Layout" with fewer than two Flow_Nodes selected, THEN THE Board_Editor SHALL leave all Element positions unchanged and show a message indicating that at least two Flow_Nodes must be selected.
11. WHEN the user pastes Mermaid flowchart text that parses without error, THE Board_Editor SHALL create one Flow_Node for each Mermaid node and one Edge for each Mermaid link, preserving node labels, link labels, and link direction.
12. IF the pasted Mermaid text cannot be parsed, THEN THE Board_Editor SHALL show an error message that includes the line number of the first error, create no Elements, and leave the Board_Document unchanged.

### Requirement 9: Freehand Drawing

**User Story:** As a user, I want to draw directly on the whiteboard, so that I can sketch and annotate.

#### Acceptance Criteria

1. WHILE the Freehand tool is active and a pointer is pressed, THE Canvas SHALL render the stroke progressively, with the newest sampled point drawn within 100 ms of the pointer movement event that produced it.
2. WHEN the pointer is released after a stroke containing at least 2 sampled points, THE Board_Editor SHALL create exactly one Freehand_Stroke Element containing the sampled points, and SHALL add that creation as a single undoable action.
3. IF the pointer is released after a press with fewer than 2 sampled points, THEN THE Board_Editor SHALL create a single-dot Freehand_Stroke Element at the press position, using the current stroke width and color.
4. WHERE the input device reports pressure, THE Canvas SHALL vary the stroke width in proportion to the reported pressure, between 25% and 200% of the Freehand_Stroke base width.
5. WHEN a Freehand_Stroke is created, THE Board_Editor SHALL smooth the stroke path so that no point on the smoothed path deviates more than 2 screen pixels from the input path.
6. WHEN the user drags with the Eraser tool over a Freehand_Stroke or any other Element, THE Board_Editor SHALL delete every Element whose rendered bounds intersect the pointer path, and SHALL record the deletion as a single undoable action per pointer drag.
7. WHEN the user edits Freehand_Stroke color, width, or opacity in the Properties_Panel, THE Board_Editor SHALL apply the change to all selected Freehand_Stroke Elements, with width limited to 1 to 100 pixels and opacity limited to 0 to 100 percent.
8. IF the user enters a width or opacity value outside the allowed range in the Properties_Panel, THEN THE Properties_Panel SHALL reject the value, retain the previous value, and display an error indication.
9. WHILE the user holds Shift during Freehand_Stroke drawing, THE Board_Editor SHALL constrain the stroke to a straight line from the press position to the pointer position, snapped to the nearest multiple of 15 degrees.

### Requirement 10: Undo, Redo, and History

**User Story:** As a user, I want reliable undo and redo, so that I can experiment without losing work.

#### Acceptance Criteria

1. WHEN the user performs an edit, THE Board_Document SHALL record exactly one entry in the Undo_History and mark the Board_Document as modified.
2. WHEN the user triggers Undo and the Undo_History contains at least one entry, THE Board_Document SHALL revert the most recent entry, restore the Board_Document content to its state before that edit, and make the reverted entry available for Redo.
3. WHEN the user triggers Redo and at least one entry is available for Redo, THE Board_Document SHALL reapply the most recently reverted entry and move it back to the Undo_History.
4. WHEN the user performs a new edit after an Undo, THE Board_Document SHALL discard all entries available for Redo.
5. WHEN the user completes a continuous drag, resize, or freehand stroke, THE Board_Document SHALL record the whole gesture, from pointer-down to pointer-up, as one Undo_History entry.
6. WHEN an Agent_Tool invocation completes, THE Board_Document SHALL record all changes made by that invocation as one Undo_History entry.
7. IF an Agent_Tool invocation fails before completion, THEN THE Board_Document SHALL leave the Board_Document content and the Undo_History unchanged by that invocation.
8. THE Undo_History SHALL retain at least 200 entries per open Board_Document and, WHEN the count exceeds the retained limit, discard the oldest entry first.
9. IF the user triggers Undo while the Undo_History is empty, or Redo while no entry is available for Redo, THEN THE Board_Editor SHALL leave the Board_Document unchanged and show no error.
10. THE Board_Editor SHALL route Undo and Redo through the IDE Undo and Redo commands, including their keyboard shortcuts and menu items.

### Requirement 11: Save, Load, and File Format

**User Story:** As a user, I want boards saved as a versioned JSON file, so that I can store designs in source control and open them later.

#### Acceptance Criteria

1. WHEN the user saves a Board_Document, THE Serializer SHALL write Board_File content as UTF-8 JSON that includes a Schema_Version, document metadata, the Element list, the Asset list, the component library, and the viewport.
2. WHEN the user saves, THE OpenBoard SHALL write the Board_File through the IDE workspace file system API.
3. WHEN the user saves an unchanged Board_Document more than once, THE Serializer SHALL produce byte-identical output on every save, ordering object keys alphabetically and Elements by their stored z-order.
4. THE Serializer SHALL write each Element with an identifier that is unique within the Board_Document and unchanged across save and load cycles.
5. WHEN a Board_File is opened, THE Parser SHALL parse the Board_File content into a Board_Document.
6. FOR ALL valid Board_Documents, parsing the output of the Serializer SHALL produce a Board_Document equivalent to the original (round-trip property).
7. IF the Board_File content is not valid JSON, THEN THE Parser SHALL return an error that includes the 1-based line number and column number of the failure, THE Board_Editor SHALL offer to open the file in the text editor, and THE OpenBoard SHALL leave the file on disk unmodified.
8. IF the Board_File content is valid JSON that does not conform to the schema, THEN THE Parser SHALL return an error that names the offending property path, and THE OpenBoard SHALL leave the file on disk unmodified.
9. IF the Board_File has a Schema_Version lower than the current version, THEN THE Parser SHALL migrate the content to the current version in memory, and THE Serializer SHALL write the current version on the next save.
10. IF the Board_File has a Schema_Version higher than the current version, THEN THE OpenBoard SHALL open the Board_File as read-only, show a message that the file was created by a newer version, and reject save attempts without modifying the file on disk.
11. WHEN the Parser encounters properties not defined in the schema, THE Parser SHALL preserve those properties, and THE Serializer SHALL write them back with unchanged names and values.
12. WHEN a zero-byte `.openboard` file is opened, THE Parser SHALL produce an empty Board_Document containing zero Elements and zero Assets, with the current Schema_Version.
13. THE OpenBoard SHALL support the IDE Save, Save As, and auto-save behaviors for Board_Files.
14. THE OpenBoard SHALL support IDE backup and hot-exit for unsaved Board_Documents.
15. THE OpenBoard SHALL publish a JSON Schema for the Board_File and register it for `.openboard` files.
16. IF the IDE workspace file system API fails to write the Board_File, THEN THE OpenBoard SHALL show an error message indicating the save failed, keep the Board_Document marked as unsaved, and retain all in-memory content.

### Requirement 12: Export

**User Story:** As a user, I want to export boards to common image formats, so that I can use the results in documentation, issues, and design reviews.

#### Acceptance Criteria

1. WHEN the user requests an export, THE Exporter SHALL produce output in the selected format, where the selectable formats are PNG, SVG, JPEG, WebP, and PDF.
2. WHEN the user requests an export, THE Exporter SHALL allow selection of exactly one scope from: the entire board, the current selection, a single Frame, or all Frames, where the all-Frames scope produces one separate file per Frame.
3. WHERE the format is PNG or WebP, THE Exporter SHALL provide a transparent background option that, when enabled, produces output with an alpha value of 0 in every pixel not covered by an Element.
4. WHERE the format is PNG, WebP, or JPEG, THE Exporter SHALL provide scale factor options of 1x, 2x, 3x, and 4x, with 1x as the default.
5. THE Exporter SHALL provide a padding option accepting whole-number values from 0 to 256 canvas units, with a default of 0, and SHALL add that padding on all four sides of the exported content bounds.
6. IF the padding value entered is not a whole number from 0 to 256, THEN THE Exporter SHALL reject the value, show a message stating the allowed range, and retain the previous valid value.
7. WHERE the format is SVG, THE Exporter SHALL embed all Assets used by exported Elements in the output so that the file contains no references to external resources.
8. WHERE the format is PNG, THE Exporter SHALL provide an option to embed the Board_Document in the PNG metadata so that importing the exported PNG into OpenBoard recreates the exported Elements.
9. WHEN the user confirms an export, THE OpenBoard SHALL prompt for a destination through the IDE save dialog and write the output through the IDE workspace file system API.
10. IF the user cancels the save dialog or the write fails, THEN THE OpenBoard SHALL create no output file (removing any partial file), show a message indicating that the export was not completed, and leave the Board_Document unchanged.
11. WHEN the user chooses "Copy as PNG", THE Exporter SHALL place the rendered PNG on the system clipboard, and IF the clipboard write fails, THEN THE Exporter SHALL show a message indicating the copy failed.
12. IF the export scope contains no Elements, THEN THE Exporter SHALL abort without producing output and show a message that there is nothing to export.
13. IF the requested raster output exceeds 16,384 pixels on either width or height after applying scale factor and padding, THEN THE Exporter SHALL abort without producing output and show a message stating the 16,384 pixel limit.
14. THE Exporter SHALL render exported output so that Element geometry positions, colors, and text layout differ from the Canvas appearance by no more than 1 pixel at 1x scale.
15. WHEN the user exports a selection or a Frame, THE Exporter SHALL include only Elements whose bounds intersect that scope, and SHALL exclude all other Elements.

### Requirement 13: Agent Tool Registry

**User Story:** As an IDE agent author, I want one schema-driven registry of every OpenBoard action, so that agents can automate everything a user can do through a consistent interface.

#### Acceptance Criteria

1. THE Tool_Registry SHALL define each Agent_Tool with a unique name of 1 to 64 characters, a natural-language description of 1 to 1,000 characters, a JSON input schema, a JSON output schema, and a handler.
2. THE Tool_Registry SHALL cover every user-facing action of the Board_Editor, including creating, reading, updating, deleting, styling, grouping, aligning, connecting, laying out, importing, exporting, and viewport control, such that each user-facing action has at least one Agent_Tool that produces the same Board_Document change.
3. THE Tool_Registry SHALL be the single source of truth for the LM_Tool_Bridge, the exported extension API, and the command-driven invocation path, such that each of the three paths lists exactly the same set of Agent_Tool names.
4. THE Tool_Registry SHALL provide a polymorphic element-creation Agent_Tool that accepts an Element type discriminator and a type-specific property object, covering every Element type.
5. THE Tool_Registry SHALL provide polymorphic update, query, and delete Agent_Tools that operate on 1 to 1,000 Elements per invocation, selected by identifier, type, or property filter.
6. THE Tool_Registry SHALL provide an Agent_Tool that accepts an ordered list of 1 to 500 operations and applies them atomically, so that either all operations succeed or the Board_Document remains unchanged.
7. IF any operation in an atomic Agent_Tool invocation fails, THEN THE Tool_Registry SHALL return an error that identifies the zero-based index of the failing operation and the reason, and leave the Board_Document unchanged.
8. THE Tool_Registry SHALL provide an Agent_Tool that returns the JSON schema of every Element type and every Agent_Tool.
9. WHEN an Agent_Tool is invoked, THE Tool_Registry SHALL validate the input against the input schema before running the handler.
10. IF the input of an Agent_Tool invocation fails validation, THEN THE Tool_Registry SHALL not run the handler, SHALL return an error that lists each invalid property path and the reason, and SHALL leave the Board_Document unchanged.
11. WHEN an Agent_Tool succeeds, THE Tool_Registry SHALL return a result that validates against the output schema of that Agent_Tool.
12. THE Tool_Registry SHALL apply the same validation and the same handlers to edits made by user interface actions and edits made by Agent_Tools, so that both produce identical Board_Document changes for equivalent input.
13. WHEN a new Agent_Tool is added to the Tool_Registry, THE LM_Tool_Bridge SHALL expose that Agent_Tool, with its name, description, and input schema, without per-tool registration code.
14. THE Tool_Registry SHALL provide Agent_Tools to read a board summary, list Elements with pagination of 1 to 500 Elements per page, and render a PNG preview of a region so that an agent can inspect the board.
15. WHERE a tool result includes a rendered image, THE Tool_Registry SHALL return it as base64-encoded image data with its MIME type.
16. THE Tool_Registry SHALL provide Agent_Tools to list open boards, open a board by path, create a board, save a board, and close a board.
17. IF an Agent_Tool invocation references a board, Element, or path that does not exist, THEN THE Tool_Registry SHALL return an error that identifies the missing reference and leave the Board_Document unchanged.

### Requirement 14: Agent Exposure Without a Global Server

**User Story:** As a user who runs several IDE windows, I want agent tools exposed without a separate MCP server, so that tools stay reliable and do not conflict between windows.

#### Acceptance Criteria

1. WHEN the Extension_Host activates OpenBoard, THE LM_Tool_Bridge SHALL register every Agent_Tool in the Tool_Registry with the VS Code Language Model Tools API within the same Extension_Host, with zero Agent_Tools left unregistered.
2. THE OpenBoard SHALL declare each Agent_Tool in the extension manifest so that the IDE agent can discover the tool before the extension activates and without starting a server.
3. THE OpenBoard SHALL expose the Tool_Registry through the object returned by the extension's activate function, providing exactly three operations: list (returns all Agent_Tool names), describe (returns the description and input schema of one named Agent_Tool), and invoke (runs one named Agent_Tool with a JSON input and returns its JSON result).
4. WHEN the command "openboard.invokeTool" is executed with a tool name and a JSON input, THE OpenBoard SHALL run the named Agent_Tool and return the JSON result.
5. IF the command "openboard.invokeTool" receives an unknown tool name or an input that is not valid JSON, THEN THE OpenBoard SHALL return an error that identifies the invalid argument and SHALL leave every Board_Document unchanged.
6. THE OpenBoard SHALL operate without starting any MCP server, HTTP server, WebSocket server, named pipe, or listening network socket.
7. THE OpenBoard SHALL operate without writing any lock file, port file, or registry entry outside the extension's own storage locations.
8. WHERE a user wants an MCP-based workflow, THE OpenBoard SHALL document that an external MCP adapter can call the exported extension API or the command "openboard.invokeTool", without OpenBoard shipping that adapter.
9. WHEN an Agent_Tool invocation specifies a board path, THE Tool_Registry SHALL act on the Board_Document for that path within the current Extension_Host.
10. WHEN an Agent_Tool invocation omits the board path and a Board_Editor is active, THE Tool_Registry SHALL act on the active Board_Editor of the current window.
11. IF an Agent_Tool invocation omits the board path and no Board_Editor is active, THEN THE Tool_Registry SHALL return an error that states there is no active board and lists the paths of all open boards, and SHALL leave every Board_Document unchanged.
12. IF an Agent_Tool invocation specifies a path to an existing Board_File that is not open, THEN THE Tool_Registry SHALL open the Board_File in the background without showing an editor tab and apply the operation.
13. IF an Agent_Tool invocation specifies a board path that does not exist and the tool is not a create operation, THEN THE Tool_Registry SHALL return a not-found error that includes the path, and SHALL NOT create a file.
14. WHEN the Tool_Registry runs an edit Agent_Tool on a Board_Document displayed in a Board_Editor, THE Board_Editor SHALL display the result on the Canvas within 1 second of the tool completing, without requiring user interaction.
15. WHEN an Agent_Tool changes a Board_Document, THE Board_Editor SHALL mark the Board_Document as modified so that the user can save or revert it, and SHALL NOT write the Board_File to disk until the user saves.
16. WHEN multiple Agent_Tool invocations target the same Board_Document concurrently, THE Tool_Registry SHALL execute them one at a time in the order received, and each invocation SHALL observe the result of the previous one.
17. WHERE a destructive Agent_Tool is invoked through the Language Model Tools API, THE LM_Tool_Bridge SHALL provide a confirmation message of at most 300 characters that names the Agent_Tool, the target board path, and the effect, so that the IDE can prompt the user before execution.

### Requirement 15: Multi-Window Isolation

**User Story:** As a user with multiple IDE windows open, I want each window's OpenBoard instance to be independent, so that windows never interfere with each other.

#### Acceptance Criteria

1. THE OpenBoard SHALL keep all runtime state, including open Board_Documents, Undo_History, selections, and viewports, within the Extension_Host of its own window, such that an edit, undo, selection change, or viewport change in one window causes zero changes to the in-memory state of any other window.
2. THE OpenBoard SHALL keep Board_Document state for each file path independent of the state in any other IDE window's Extension_Host, such that unsaved edits in one window are not visible in another window until saved to the Board_File.
3. THE OpenBoard SHALL use only VS Code-provided per-window and per-workspace storage locations for any persisted settings or caches.
4. WHEN two IDE windows open the same Board_File, THE OpenBoard SHALL read and write the file through the IDE file system API and rely on the IDE file-change events to detect changes made by the other window.
5. WHEN the Board_File is modified on disk by another window while the local Board_Document has no unsaved edits, THE Board_Editor SHALL reload the content without prompting within 2 seconds of receiving the IDE file-change event, and SHALL preserve the local viewport.
6. WHEN the Board_File is modified on disk by another window while the local Board_Document has unsaved edits, THE Board_Editor SHALL show a conflict notification offering exactly three choices: keep the local version, load the disk version, or compare the two as JSON text, and SHALL leave the local Board_Document unchanged until the user selects a choice.
7. WHEN an IDE window closes, THE OpenBoard SHALL release all processes, network ports, and lock or temporary files that it created for that window, leaving none that affect other windows.
8. IF a window's Extension_Host crashes or restarts, THEN THE OpenBoard SHALL keep the Board_Editors and Agent_Tools of all other windows functional, with no loss of their unsaved edits and no error notification caused by the crash.
9. THE OpenBoard SHALL generate Element identifiers that are unique across windows and sessions without coordination between windows, such that generating 1,000,000 identifiers across concurrent windows produces zero collisions.
10. THE OpenBoard SHALL write Board_Files through a write-to-temporary-then-rename sequence, so that an interrupted save leaves the previous Board_File intact and byte-identical to its pre-save content.
11. IF writing the temporary file or renaming it to the Board_File fails, THEN THE OpenBoard SHALL keep the previous Board_File unchanged, SHALL delete the temporary file, SHALL keep the local Board_Document's unsaved edits, and SHALL show an error notification indicating that the save failed.

### Requirement 16: Webview Security and Reliability

**User Story:** As a user, I want the editor to be safe and stable, so that opening a board file cannot compromise my machine or lose my work.

#### Acceptance Criteria

1. THE Board_Editor SHALL apply a Content Security Policy that blocks inline scripts, scripts from remote origins, and network requests to remote origins.
2. THE Board_Editor SHALL load all scripts, styles, fonts, and icons from the extension's bundled local resources.
3. THE Board_Editor SHALL render Element text as plain text or sanitized rich text, with all script content, event-handler attributes, and `javascript:` URLs removed, and SHALL NOT execute any script contained in a Board_File.
4. WHEN an SVG Asset is rendered, THE Board_Editor SHALL render it as an image resource and SHALL NOT execute any script contained in the SVG, and SHALL NOT load any remote resource referenced by the SVG.
5. IF a message between the webview and the Extension_Host fails validation against the message schema, THEN THE OpenBoard SHALL discard the message, SHALL NOT change the Board_Document as a result of it, and SHALL record the rejection in the extension's output channel.
6. IF the webview process terminates unexpectedly, THEN THE OpenBoard SHALL restore the Board_Editor from the Board_Document held in the Extension_Host within 5 seconds, with all edits made before termination that had been acknowledged by the Extension_Host retained.
7. IF a Board_File exceeds 200 MB (209,715,200 bytes), THEN THE OpenBoard SHALL decline to open it in the Board_Editor, leave the file unmodified, and show a message stating the 200 MB size limit and the file's actual size.
8. THE OpenBoard SHALL declare in its extension manifest, for Restricted Mode support, the set of features that are limited when the workspace is untrusted.
9. WHILE the workspace is untrusted, THE OpenBoard SHALL permit viewing Board_Files and SHALL reject any Agent_Tool operation that writes to a file other than the active Board_File, returning an error indicating that workspace trust is required.
10. IF the webview sends an edit that has not been acknowledged by the Extension_Host when the webview terminates, THEN THE OpenBoard SHALL keep the Board_Document in its last acknowledged state and show a notification that the most recent edit was not applied.

### Requirement 17: Performance and Scalability

**User Story:** As a user, I want large boards to stay responsive, so that I can work on complex designs.

#### Acceptance Criteria

1. WHEN the user opens a Board_File containing up to 5,000 Elements, THE Board_Editor SHALL display the Canvas with all Elements within the viewport rendered within 3 seconds, measured from the open action to the first completed frame, on the reference machine.
2. WHILE the Canvas is displayed, THE Canvas SHALL render only Elements whose bounding boxes intersect the viewport expanded by a margin of 256 pixels on each side.
3. WHEN the user drags a selection of up to 200 Elements, THE Canvas SHALL update at no less than 30 frames per second, measured as the average over the duration of the drag, on the reference machine.
4. WHEN an Agent_Tool applies a batch of up to 1,000 Element creations, THE Tool_Registry SHALL complete the batch within 5 seconds, measured from the start of the batch to the last Element being created, on the reference machine.
5. WHILE an image Asset is being decoded or rendered, THE Board_Editor SHALL process pointer input events on the Canvas with a delay of no more than 100 milliseconds from event to visible response.
6. IF a Board_File contains more than 5,000 Elements, THEN THE Board_Editor SHALL open the Board_File, display the Canvas, and display a notice indicating that performance targets are not guaranteed for boards of that size.
7. IF a batch of Element creations by an Agent_Tool exceeds 5 seconds, THEN THE Tool_Registry SHALL continue processing the batch to completion and SHALL report to the caller that the batch exceeded the time target, without discarding any created Elements.

### Requirement 18: Commands, Settings, and Menus

**User Story:** As a user, I want OpenBoard integrated with IDE commands and settings, so that I can configure and discover features in the usual places.

#### Acceptance Criteria

1. THE OpenBoard SHALL register exactly six commands in the IDE Command Palette: new board, export, zoom to fit, toggle grid, toggle minimap, and open as text.
2. WHEN the user invokes the zoom to fit, toggle grid, toggle minimap, open as text, or export command, and no Board_Editor is active, THE OpenBoard SHALL leave all board state unchanged and display a notification indicating that an active board is required.
3. THE OpenBoard SHALL contribute a settings section with five options: default export scale (number, allowed values 1, 2, 3, 4; default 2), default export background (allowed values "transparent", "white", "theme"; default "theme"), grid spacing (integer, 4 to 200 pixels; default 20), default font family (non-empty string, maximum 100 characters; default the IDE editor font family), and auto layout direction (allowed values "horizontal", "vertical"; default "horizontal").
4. WHEN the user changes an OpenBoard setting, THE OpenBoard SHALL apply the new value to all open Board_Editors within 500 milliseconds without requiring an editor or window reload.
5. IF a setting value is outside its allowed values or range, THEN THE OpenBoard SHALL use the default value for that setting and preserve the invalid value in the user's settings file unchanged.
6. THE OpenBoard SHALL contribute an Explorer context menu entry "New OpenBoard File" that is shown only when the selected item is a folder.
7. THE OpenBoard SHALL contribute an Explorer context menu entry "Export OpenBoard" that is shown only when the selected item has the `.openboard` extension.
8. THE OpenBoard SHALL contribute a file icon displayed for every file with the `.openboard` extension in the Explorer and editor tabs.
9. THE OpenBoard SHALL provide every user-visible string, including command titles, setting names and descriptions, menu entries, and notifications, through the IDE localization mechanism, and SHALL display the English string when no translation exists for the active IDE locale.

### Requirement 19: Testability and Quality

**User Story:** As a maintainer, I want automated tests covering core logic, so that format and tool behavior stays correct as the product evolves.

#### Acceptance Criteria

1. THE OpenBoard SHALL include automated tests for the Serializer and Parser that, for at least 100 randomly generated Board_Documents per test run containing 0 to 500 Elements each, assert that parsing the serialized output yields a Board_Document equal to the original.
2. THE OpenBoard SHALL include automated tests that, for every Agent_Tool, validate at least 1 generated valid input and at least 1 generated invalid input against the input schema, and at least 1 generated valid output and at least 1 generated invalid output against the output schema, asserting that valid samples are accepted and invalid samples are rejected.
3. THE OpenBoard SHALL include automated tests that execute a batch operation of 2 to 50 operations in which exactly 1 operation fails, and assert that the Board_Document after the batch is equal to the Board_Document before the batch.
4. THE OpenBoard SHALL include automated tests that apply a sequence of 1 to 20 edits, perform Undo followed by Redo, and assert that the resulting Board_Document is equal to the Board_Document that existed immediately before the Undo.
5. THE OpenBoard SHALL include automated tests that, for every Element type, create an Element, update at least 1 of its properties, serialize and parse the Board_Document, and export it, asserting that each step completes without error and that the parsed Element equals the updated Element.
6. THE OpenBoard SHALL include an automated test that activates the extension, performs its core operations, and asserts that the extension holds 0 listening network sockets.
7. THE OpenBoard SHALL include migration tests that, for each prior Schema_Version, open a stored fixture Board_File and assert that it loads without error and that the resulting Board_Document is at the current Schema_Version.
8. IF any automated test required by criteria 1 to 7 fails, THEN THE OpenBoard SHALL report the test run as failed with a non-zero exit status and identify each failing test by name.
