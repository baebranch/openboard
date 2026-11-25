/** Core model types. Pure TypeScript: no vscode or DOM imports. */

export type ElementId = string;
export type AssetId = string;

export const ELEMENT_TYPES = [
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'freehand',
  'text',
  'image',
  'frame',
  'sticky',
  'flowNode',
  'edge',
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export type Color = 'theme:default' | `#${string}`;
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type TextAlign = 'left' | 'center' | 'right';
export type ArrowHead = 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond' | 'bar';
export type EdgeRouting = 'straight' | 'curved' | 'orthogonal';
export type FlowNodePreset =
  | 'startEnd'
  | 'process'
  | 'decision'
  | 'inputOutput'
  | 'database'
  | 'document'
  | 'annotation';
export type AssetMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml';
export type ZOrderMode = 'front' | 'back' | 'forward' | 'backward';

/** Unknown properties preserved by the parser and re-emitted by the serializer. */
export type ExtraBag = Record<string, unknown>;

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  extra?: ExtraBag;
}

export interface ElementStyle {
  fill: Color;
  stroke: Color;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  cornerRadius: number;
  extra?: ExtraBag;
}

export interface ElementBase {
  id: ElementId;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  parentId?: ElementId;
  locked?: boolean;
  groupId?: string;
  style: ElementStyle;
  extra?: ExtraBag;
}

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  extra?: ExtraBag;
}

export interface TextProps {
  runs: TextRun[];
  fontFamily: string;
  fontSize: number;
  align: TextAlign;
}

export interface ImageProps {
  assetId: AssetId;
  crop?: { x: number; y: number; w: number; h: number; extra?: ExtraBag };
  alt?: string;
}

export interface FreehandPoint extends Point {
  p?: number;
  extra?: ExtraBag;
}

export interface FreehandProps {
  points: FreehandPoint[];
  baseWidth: number;
}

export interface FlowNodeProps extends TextProps {
  preset: FlowNodePreset;
}

export interface FrameProps {
  name: string;
  preset?: string;
}

export interface EdgeProps {
  sourceId: ElementId;
  targetId: ElementId;
  routing: EdgeRouting;
  sourceArrow: ArrowHead;
  targetArrow: ArrowHead;
  label?: string;
}

export type ShapeElement = ElementBase & { type: 'rectangle' | 'ellipse' | 'diamond' | 'line' | 'arrow' };
export type FreehandElement = ElementBase & FreehandProps & { type: 'freehand' };
export type TextElement = ElementBase & TextProps & { type: 'text' };
export type StickyElement = ElementBase & TextProps & { type: 'sticky' };
export type ImageElement = ElementBase & ImageProps & { type: 'image' };
export type FrameElement = ElementBase & FrameProps & { type: 'frame' };
export type FlowNodeElement = ElementBase & FlowNodeProps & { type: 'flowNode' };
export type EdgeElement = ElementBase & EdgeProps & { type: 'edge' };

export type Element =
  | ShapeElement
  | FreehandElement
  | TextElement
  | StickyElement
  | ImageElement
  | FrameElement
  | FlowNodeElement
  | EdgeElement;

export interface Asset {
  id: AssetId;
  mime: AssetMime;
  /** SHA-256 hex of the decoded bytes. */
  hash: string;
  width: number;
  height: number;
  /** Base64 payload. */
  data: string;
  extra?: ExtraBag;
}

export interface LibraryComponent {
  id: string;
  /** 1..100 characters. */
  name: string;
  elements: Element[];
  builtin?: boolean;
  extra?: ExtraBag;
}

export interface BoardMeta {
  id: string;
  title?: string;
  createdAt?: string;
  modifiedAt?: string;
  generator?: string;
  extra?: ExtraBag;
}

export interface BoardSettings {
  grid?: { enabled: boolean; spacing: number; extra?: ExtraBag };
  minimap?: boolean;
  extra?: ExtraBag;
}

export interface BoardDocument {
  schemaVersion: number;
  meta: BoardMeta;
  viewport: Viewport;
  /** Order is z-order, back to front. */
  elements: Element[];
  assets: Asset[];
  library: LibraryComponent[];
  settings?: BoardSettings;
  extra?: ExtraBag;
}
