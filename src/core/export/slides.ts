/**
 * Slides: every top-level Frame of the board is one slide, so presenting needs no separate layout.
 * Component_Masters are design parts, not slides, and are left out. Pure: no DOM or vscode.
 */
import type { BoardDocument, Bounds, Element, ElementId, FrameElement } from '../model/types';
import { inFrame, topLevelFrames } from './scope';
import { renderToSvg, type RenderSvgOptions, type SvgOutput } from './svg';
import type { ExportResult } from './scope';

const isFrame = (e: Element): e is FrameElement => e.type === 'frame';

export interface SlideOptions {
  /**
   * Also make each top-level Component_Master a slide. Off by default: a master on its own is a
   * design part; frames that use it already show its instances.
   */
  includeMasters?: boolean;
}

/**
 * Slide frames in reading order: rows top to bottom, each row left to right. A frame joins the
 * current row while its top edge is above the middle of the row's first frame, so frames laid out
 * in a loose grid number the way they read. Ties keep document order.
 */
export function slideFrames(elements: readonly Element[], options: SlideOptions = {}): FrameElement[] {
  const frames = topLevelFrames(elements).filter(
    (e): e is FrameElement => isFrame(e) && (options.includeMasters === true || e.component === undefined),
  );
  const byTop = frames.map((f, i) => ({ f, i })).sort((a, b) => a.f.y - b.f.y || a.i - b.i);
  const rows: { f: FrameElement; i: number }[][] = [];
  let rowLimit = -Infinity;
  for (const item of byTop) {
    const row = rows[rows.length - 1];
    if (row && item.f.y < rowLimit) row.push(item);
    else {
      rows.push([item]);
      rowLimit = item.f.y + item.f.height / 2;
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.f.x - b.f.x || a.i - b.i).map((r) => r.f));
}

/** The board region a slide shows: its frame's box. */
export function slideBounds(frame: Element): Bounds {
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
}

/** Renders one frame (with its descendants and anything drawn over it), cut to the frame's box. */
export function renderFrameSvg(
  doc: Pick<BoardDocument, 'assets' | 'elements' | 'tokens'> & Partial<Pick<BoardDocument, 'settings'>>,
  frame: Element,
  options: Omit<RenderSvgOptions, 'crop' | 'padding'> = {},
): ExportResult<SvgOutput> {
  return renderToSvg(doc, inFrame(doc.elements, frame), { ...options, crop: slideBounds(frame) });
}

/** Slide frames for `ids` in the given order; unknown or non-slide ids are reported. */
export function framesById(elements: readonly Element[], ids: readonly ElementId[]): { frames: FrameElement[]; missing: ElementId[] } {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const frames: FrameElement[] = [];
  const missing: ElementId[] = [];
  for (const id of ids) {
    const e = byId.get(id);
    if (e && e.type === 'frame') frames.push(e);
    else missing.push(id);
  }
  return { frames, missing };
}
