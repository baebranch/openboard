/** Core model types. Pure TypeScript: no vscode or DOM imports. */
import type { Override } from '../components/types';
import type { LayoutSpec, Sizing } from '../layout/types';
import type { TokenCollection } from '../tokens/types';

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
  'icon',
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export type Color = 'theme:default' | `#${string}` | `token:${string}`;
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
  /** Per-corner radii in top-left, top-right, bottom-right, bottom-left order; overrides `cornerRadius`. */
  cornerRadii?: readonly [number, number, number, number];
  /** Image drawn over the fill color. A dangling asset id is valid (renders the fill only). */
  imageFill?: { assetId: AssetId; fit: 'cover' | 'contain' | 'stretch' };
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
  /** Width and height sizing modes; absent means both `fixed`. */
  sizing?: Sizing;
  /** When true, a Layout_Frame parent does not arrange this element. */
  ignoreLayout?: boolean;
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
  /** CSS font weight: integer 100 to 900 in steps of 100. */
  fontWeight?: number;
  /** Text color; same forms as `style.fill`. */
  textColor?: string;
  /** 'wrap' breaks lines at the element width; 'none' (default) breaks only at explicit newlines. */
  textWrap?: 'none' | 'wrap';
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
  /** When true, descendants of this frame are clipped to its outline. */
  clipContent?: boolean;
  /** Presence makes this Frame a Layout_Frame that arranges its direct children. */
  /** Gap and padding may reference number Tokens (Req 11.15); the Layout_Pass resolves them. */
  layout?: LayoutSpec;
  /** 1..100 characters, trimmed. Presence marks this Frame a Component_Master. */
  component?: string;
  /** Id of a Component_Master Frame. Presence marks this Frame a Component_Instance. */
  instanceOf?: ElementId;
  /** Per-element overrides keyed by master child id; `''` is the instance root (size and style). */
  overrides?: Record<string, Override>;
}

export interface IconProps {
  /** 1..64 characters; a name outside the Icon_Set is valid and preserved. */
  name: string;
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
export type IconElement = ElementBase & IconProps & { type: 'icon' };

export type Element =
  | ShapeElement
  | FreehandElement
  | TextElement
  | StickyElement
  | ImageElement
  | FrameElement
  | FlowNodeElement
  | EdgeElement
  | IconElement;

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
  /** Token values recorded when the entry was saved, for every Token it references (Req 11.13). */
  tokens?: TokenCollection;
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
  /** Token mode (schema version 2). Absent means `auto`. */
  activeMode?: 'light' | 'dark' | 'auto';
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
  /** Design tokens (schema version 2). Values are literals, never Token_References. */
  tokens?: TokenCollection;
  extra?: ExtraBag;
}
