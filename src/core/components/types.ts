/** Component data model types. Pure TypeScript: no vscode or DOM imports. */
import type { AssetId, Color } from '../model/types';

/** Key under which an instance's root size override is stored. */
export const ROOT_OVERRIDE_KEY = '';

/** Stored per-element property values on a Component_Instance (Overridable_Property values). */
export interface Override {
  text?: string;
  fill?: Color;
  stroke?: Color;
  textColor?: Color;
  fontWeight?: number;
  imageFill?: { assetId: AssetId; fit: 'cover' | 'contain' | 'stretch' };
  /** Icon name. */
  icon?: string;
  opacity?: number;
  /** `false` hides the child and everything beneath it (state variants such as a checkmark). Children only. */
  visible?: boolean;
  /** Only meaningful under the key `''` (instance root). */
  width?: number;
  /** Only meaningful under the key `''` (instance root). */
  height?: number;
}

/** Names of the Overridable_Properties, in a stable order. */
export const OVERRIDABLE_PROPERTIES = [
  'text',
  'fill',
  'stroke',
  'textColor',
  'fontWeight',
  'imageFill',
  'icon',
  'opacity',
  'visible',
  'width',
  'height',
] as const;

export const COMPONENT_NAME_MAX = 100;
