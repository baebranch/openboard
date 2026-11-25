import type { FlowNodePreset } from '../model/types';

/** Outline used to compute where an edge meets a node. */
export type AnchorShape = 'rect' | 'ellipse' | 'diamond';

export interface FlowNodePresetInfo {
  preset: FlowNodePreset;
  label: string;
  width: number;
  height: number;
  anchorShape: AnchorShape;
  cornerRadius: number;
}

/** Exactly seven Flow_Node presets (Req 8.1). */
export const FLOW_NODE_PRESETS: readonly FlowNodePresetInfo[] = [
  { preset: 'startEnd', label: 'Start / End', width: 160, height: 60, anchorShape: 'rect', cornerRadius: 30 },
  { preset: 'process', label: 'Process', width: 160, height: 80, anchorShape: 'rect', cornerRadius: 4 },
  { preset: 'decision', label: 'Decision', width: 160, height: 120, anchorShape: 'diamond', cornerRadius: 0 },
  { preset: 'inputOutput', label: 'Input / Output', width: 160, height: 80, anchorShape: 'rect', cornerRadius: 0 },
  { preset: 'database', label: 'Database', width: 120, height: 100, anchorShape: 'rect', cornerRadius: 0 },
  { preset: 'document', label: 'Document', width: 160, height: 100, anchorShape: 'rect', cornerRadius: 0 },
  { preset: 'annotation', label: 'Annotation', width: 160, height: 60, anchorShape: 'rect', cornerRadius: 0 },
];

export function getFlowNodePreset(preset: FlowNodePreset): FlowNodePresetInfo {
  const info = FLOW_NODE_PRESETS.find((p) => p.preset === preset);
  if (!info) throw new Error(`Unknown flow node preset: ${String(preset)}`);
  return info;
}
