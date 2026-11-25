/**
 * The board Canvas (Req 3.x, 5.5, 8.2, 8.3, 10.5, 17.2). The document in the store is projected into
 * ReactFlow nodes/edges; EVERY edit leaves through `dispatchOp` as exactly one op per gesture. The
 * canvas never mutates the document: gestures only show optimistic previews until the host acks.
 */
import '@xyflow/react/dist/style.css';
import './canvas.css';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { center, rotatedBounds, unionBounds } from '../../core/model/geometry';
import type { BoardDocument, Bounds, ElementId, Point, Viewport } from '../../core/model/types';
import { eraseIntersecting, type StrokePoint } from '../../core/freehand';
import { hitTest, isClippedAt, marqueeBounds, marqueeSelect } from '../../core/selection';
import { snapToAlignment, snapToGrid, type SnapGuide } from '../../core/snap';
import { boardToScreen, screenToBoard, zoomToFit } from '../../core/viewport';
import { viewportForWheel } from './wheel';
import { dispatchOp, postSelection, postViewport } from '../ops';
import { useWebviewState } from '../store';
import { setActiveTool, setSelection, uiState, useUiState, type ToolId } from '../uiState';
import { ElementEdge, ElementNode } from './ElementNode';
import {
  angleDeg,
  connectOp,
  createOp,
  deleteOp,
  DRAG_THRESHOLD_PX,
  dragDistance,
  drawGeometry,
  formatZoomPercent,
  freehandOp,
  iconCreateOp,
  isDrawTool,
  movePatches,
  dropOp,
  findDropTarget,
  resizeBounds,
  resizeOp,
  RESIZE_HANDLES,
  rotateOp,
  rotatePatches,
  scalePatches,
  selectionBounds,
  snapAngle,
  snapMoveDelta,
  type DrawTool,
  type HandleId,
  type Op,
} from './gestures';
import { EditingLayer } from '../editing/EditingLayer';
import { editingStore } from '../editing/editingStore';
import { toReactFlow, type ElementPreview, type ObEdge, type ObNode } from './project';
import { debounce, emitViewCommand, onFocusBounds, onHostViewport, onViewCommand } from './viewportBus';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { isGridEnabled } from '../../core/model/grid';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;
const VIEWPORT_POST_DEBOUNCE_MS = 250;
const PREVIEW_FAILSAFE_MS = 1500;
const DEFAULT_GRID = 20;
/** Most per-element selection outlines drawn at once. */
const MAX_SELECTION_OUTLINES = 500;

const nodeTypes: NodeTypes = { ob: ElementNode };
const edgeTypes: EdgeTypes = { ob: ElementEdge };
const EMPTY_PREVIEWS: ReadonlyMap<string, ElementPreview> = new Map();

type Draft =
  | { kind: 'shape'; tool: DrawTool; a: Point; b: Point; shift: boolean }
  | { kind: 'freehand'; pts: StrokePoint[] }
  | { kind: 'eraser'; pts: StrokePoint[] }
  | { kind: 'marquee'; a: Point; b: Point };

function toPreviews(patches: ReadonlyArray<{ id: ElementId; set: Record<string, unknown> }>): ReadonlyMap<string, ElementPreview> {
  return new Map(patches.map((p) => [p.id, p.set as ElementPreview]));
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function Canvas() {
  const { doc, settings, readOnly } = useWebviewState();
  if (!doc) return null;
  return (
    <ReactFlowProvider>
      <CanvasInner doc={doc} gridSpacing={settings?.gridSpacing} readOnly={readOnly} />
    </ReactFlowProvider>
  );
}

interface InnerProps {
  doc: BoardDocument;
  gridSpacing: number | undefined;
  readOnly: boolean;
}

function CanvasInner({ doc, gridSpacing, readOnly }: InnerProps) {
  const rf = useReactFlow();
  const { activeTool, selection } = useUiState();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const initialViewport = useRef<Viewport>(doc.viewport).current;
  const vpRef = useRef<Viewport>({ x: initialViewport.x, y: initialViewport.y, zoom: initialViewport.zoom });
  const [vp, setVp] = useState<Viewport>(vpRef.current);
  const [previews, setPreviews] = useState<ReadonlyMap<string, ElementPreview>>(EMPTY_PREVIEWS);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const spaceDown = useRef(false);
  const gestureCancel = useRef<(() => void) | undefined>(undefined);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const grid = doc.settings?.grid;
  // The grid state lives in the file (settings.grid, on by default); the host toggles it as an edit.
  // The minimap toggle stays view-only.
  const [minimapOverride, setMinimapOverride] = useState<boolean | undefined>(undefined);
  const gridOn = isGridEnabled(doc);
  const spacing = grid?.spacing ?? gridSpacing ?? DEFAULT_GRID;
  const showMinimap = minimapOverride ?? doc.settings?.minimap !== false;

  // --- viewport -----------------------------------------------------------------------------------
  const restored = useRef<Viewport | undefined>(undefined);
  const postVp = useMemo(
    () =>
      debounce((v: Viewport) => {
        const r = restored.current;
        if (r && r.x === v.x && r.y === v.y && r.zoom === v.zoom) return; // host-restored: do not echo
        postViewport({ x: v.x, y: v.y, zoom: v.zoom });
      }, VIEWPORT_POST_DEBOUNCE_MS),
    [],
  );
  const raf = useRef(0);
  const commitViewport = useCallback((v: Viewport) => {
    vpRef.current = { x: v.x, y: v.y, zoom: v.zoom };
    if (!raf.current) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        setVp(vpRef.current);
      });
    }
  }, []);

  useEffect(() => {
    const off = onHostViewport((v) => {
      restored.current = { x: v.x, y: v.y, zoom: v.zoom };
      void rf.setViewport({ x: v.x, y: v.y, zoom: v.zoom });
      commitViewport(v);
    });
    return () => {
      off();
      postVp.flush();
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [rf, commitViewport, postVp]);

  const applyViewport = useCallback(
    (v: Viewport) => {
      commitViewport(v);
      postVp({ x: v.x, y: v.y, zoom: v.zoom });
    },
    [commitViewport, postVp],
  );

  // Host palette commands: OpenBoard: Toggle Grid / Toggle Minimap / Zoom to Fit.
  const viewState = useRef({ gridOn, showMinimap, elements: doc.elements, size: { width: 1200, height: 800 } });
  viewState.current = { gridOn, showMinimap, elements: doc.elements, size: viewState.current.size };
  useEffect(
    () =>
      onViewCommand((command) => {
        const cur = viewState.current;
        if (command === 'toggleGrid') return; // handled by the host as a document edit
        if (command === 'toggleMinimap') setMinimapOverride(!cur.showMinimap);
        else {
          const boxes = cur.elements.filter((e) => e.type !== 'edge').map((e) => rotatedBounds(e));
          const next = zoomToFit(vpRef.current, boxes, cur.size);
          void rf.setViewport({ x: next.x, y: next.y, zoom: next.zoom });
          applyViewport(next);
        }
      }),
    [rf, applyViewport],
  );

  // Zoom buttons: zoom about the center of the canvas, clamped to the zoom range.
  const zoomTo = useCallback(
    (zoom: number) => {
      const cur = vpRef.current;
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
      const { width, height } = viewState.current.size;
      const cx = width / 2;
      const cy = height / 2;
      const next = { x: cx - ((cx - cur.x) / cur.zoom) * z, y: cy - ((cy - cur.y) / cur.zoom) * z, zoom: z };
      void rf.setViewport(next);
      applyViewport(next);
    },
    [rf, applyViewport],
  );
  const fitAll = useCallback(() => emitViewCommand('zoomToFit'), []);

  // "Go to master" (component panel): fit the given bounds in view; not a document edit.
  useEffect(
    () =>
      onFocusBounds((b) => {
        const next = zoomToFit(vpRef.current, [b], viewState.current.size);
        void rf.setViewport({ x: next.x, y: next.y, zoom: next.zoom });
        applyViewport(next);
      }),
    [rf, applyViewport],
  );

  // Container size (for culling and the minimap).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize({ width: r.width, height: r.height });
        viewState.current.size = { width: r.width, height: r.height };
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl/pinch wheel zooms around the pointer (Req 3.2); plain wheel/trackpad scroll pans.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if ((e.target as Element | null)?.closest('.ob-minimap')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const next = viewportForWheel(vpRef.current, e, pointer, viewState.current.size);
      void rf.setViewport({ x: next.x, y: next.y, zoom: next.zoom });
      applyViewport(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [rf, applyViewport]);

  // --- previews -----------------------------------------------------------------------------------
  // The host's ack/patch replaces the document; optimistic previews are then obsolete.
  useEffect(() => setPreviews(EMPTY_PREVIEWS), [doc]);
  const holdPreviews = useCallback((next: ReadonlyMap<string, ElementPreview>) => {
    setPreviews(next);
    setTimeout(() => setPreviews((cur) => (cur === next ? EMPTY_PREVIEWS : cur)), PREVIEW_FAILSAFE_MS);
  }, []);

  const emit = useCallback(
    (op: Op | undefined): void => {
      if (!op || readOnly) return;
      dispatchOp(op.tool, op.input);
    },
    [readOnly],
  );

  // --- projection ---------------------------------------------------------------------------------
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const byId = useMemo(() => new Map(doc.elements.map((e) => [e.id, e])), [doc.elements]);
  const projection = useMemo(
    () => toReactFlow(doc, { viewport: vp, screen: size }, { selection: selectionSet, previews }),
    [doc, vp, size, selectionSet, previews],
  );

  // Drop selected ids that no longer exist; report the selection to the host.
  useEffect(() => {
    const alive = selection.filter((id) => byId.has(id));
    if (alive.length !== selection.length) setSelection(alive);
  }, [selection, byId]);
  useEffect(() => postSelection([...selection]), [selection]);

  const toBoard = useCallback((clientX: number, clientY: number): Point => {
    const r = containerRef.current?.getBoundingClientRect();
    return screenToBoard(vpRef.current, { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) });
  }, []);

  /** Track a pointer gesture on window until release/cancel. */
  const track = useCallback((onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void, onCancel: () => void) => {
    gestureCancel.current?.();
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      gestureCancel.current = undefined;
    };
    const up = (ev: PointerEvent): void => {
      cleanup();
      onUp(ev);
    };
    const cancel = (): void => {
      cleanup();
      onCancel();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    gestureCancel.current = cancel;
  }, []);

  useEffect(() => () => gestureCancel.current?.(), []);

  // --- keyboard -----------------------------------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (isEditable(e.target)) return;
      if (e.code === 'Space') spaceDown.current = true;
      else if (e.key === 'Escape') {
        gestureCancel.current?.();
        setActiveTool('select');
      }
      // Delete/Backspace is handled once, by the ToolPalette keyboard handler. Handling it here as
      // well sent a second element.delete for ids that were already gone ("not found").
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [emit]);

  // --- node drag (move) ---------------------------------------------------------------------------
  const dragRef = useRef<{ ids: string[]; start: Bounds } | null>(null);

  const onNodeDragStart = useCallback(
    (_e: unknown, node: ObNode) => {
      const cur = selectionRef.current;
      const ids = cur.includes(node.id) ? [...cur] : [node.id];
      if (!cur.includes(node.id)) setSelection(ids);
      const start = selectionBounds(doc.elements, ids);
      dragRef.current = start ? { ids, start } : null;
    },
    [doc.elements],
  );

  const dragDelta = useCallback(
    (node: ObNode, final: boolean) => {
      const d = dragRef.current;
      const el = byId.get(node.id);
      if (!d || !el) return undefined;
      const rawDx = node.position.x - el.x;
      const rawDy = node.position.y - el.y;
      const group = new Set(d.ids);
      const others = doc.elements.filter((e) => e.type !== 'edge' && !group.has(e.id));
      const rect = { x: d.start.x + rawDx, y: d.start.y + rawDy, width: d.start.width, height: d.start.height };
      const snap = snapToAlignment(rect, others, vpRef.current.zoom);
      let dx = snap.x - d.start.x;
      let dy = snap.y - d.start.y;
      if (final && gridOn && snap.guides.length === 0) ({ dx, dy } = snapMoveDelta(d.start, rawDx, rawDy, spacing));
      return { dx, dy, ids: d.ids, guides: snap.guides };
    },
    [byId, doc.elements, gridOn, spacing],
  );

  const onNodeDrag = useCallback(
    (_e: unknown, node: ObNode) => {
      const r = dragDelta(node, false);
      if (!r) return;
      setPreviews(toPreviews(movePatches(doc.elements, r.ids, r.dx, r.dy)));
      setGuides(r.guides);
    },
    [dragDelta, doc.elements],
  );

  const onNodeDragStop = useCallback(
    (e: unknown, node: ObNode) => {
      const r = dragDelta(node, true);
      dragRef.current = null;
      setGuides([]);
      if (!r) return;
      // Drop onto a Frame (Req 21.4): the pointer decides the target; fall back to the moved selection's center.
      const ptr = e as { clientX?: number; clientY?: number } | null;
      const sel = selectionBounds(doc.elements, r.ids);
      const point =
        typeof ptr?.clientX === 'number' && typeof ptr.clientY === 'number'
          ? toBoard(ptr.clientX, ptr.clientY)
          : sel && { x: sel.x + r.dx + sel.width / 2, y: sel.y + r.dy + sel.height / 2 };
      const target = point ? findDropTarget(doc.elements, r.ids, point) : undefined;
      const op = dropOp(doc.elements, r.ids, r.dx, r.dy, target);
      if (!op) {
        setPreviews(EMPTY_PREVIEWS);
        return;
      }
      holdPreviews(toPreviews(movePatches(doc.elements, r.ids, r.dx, r.dy)));
      emit(op); // exactly one op per drag
    },
    [dragDelta, doc.elements, emit, holdPreviews, toBoard],
  );

  // --- connect gestures (Req 8.2, 8.3) --------------------------------------------------------------
  const connectFrom = useRef<{ id: string; x: number; y: number } | null>(null);
  const onConnectStart = useCallback((event: MouseEvent | TouchEvent, params: { nodeId: string | null }) => {
    const pt = 'touches' in event ? event.touches[0] : event;
    connectFrom.current = params.nodeId && pt ? { id: params.nodeId, x: pt.clientX, y: pt.clientY } : null;
  }, []);
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: { toNode?: { id: string } | null }) => {
      const from = connectFrom.current;
      connectFrom.current = null;
      if (!from) return;
      const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!pt) return;
      if (Math.hypot(pt.clientX - from.x, pt.clientY - from.y) < DRAG_THRESHOLD_PX) return; // a click, not a connection
      const drop = toBoard(pt.clientX, pt.clientY);
      const hit = state.toNode?.id ?? hitTest(doc.elements.filter((e) => e.type !== 'edge'), drop);
      if (hit === from.id) return;
      emit(connectOp(from.id, hit, drop));
    },
    [doc.elements, emit, toBoard],
  );

  // --- selection by click ---------------------------------------------------------------------------
  const pick = useCallback((shift: boolean, id: string): void => {
    const cur = selectionRef.current;
    if (shift) setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    else setSelection([id]);
  }, []);
  const clickSelect = useCallback(
    (e: { shiftKey: boolean; clientX?: number; clientY?: number }, id: string) => {
      if (activeTool !== 'select') return;
      // A click on a part of an element clipped away by a clipping Frame falls through (Req 10.3).
      const target = byId.get(id);
      if (target && target.parentId !== undefined && e.clientX !== undefined && e.clientY !== undefined) {
        const pt = toBoard(e.clientX, e.clientY);
        const items = doc.elements.filter((x) => x.type !== 'edge');
        if (isClippedAt(target, new Map(items.map((x) => [x.id, x])), pt)) {
          const next = hitTest(items, pt);
          if (next === undefined) {
            if (!e.shiftKey) setSelection([]);
            return;
          }
          pick(e.shiftKey, next);
          return;
        }
      }
      pick(e.shiftKey, id);
    },
    [activeTool, byId, doc.elements, toBoard, pick],
  );

  // --- pane gestures: marquee and drawing tools --------------------------------------------------
  const onContainerPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || spaceDown.current) return;
    const target = e.target as Element;
    if (target.closest('.ob-selection, .ob-editing, .ob-minimap, .ob-zoom, .react-flow__attribution')) return;
    const tool: ToolId = activeTool;
    const start = toBoard(e.clientX, e.clientY);
    const startScreen = { x: e.clientX, y: e.clientY };
    const moved = (ev: PointerEvent): boolean => Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) >= DRAG_THRESHOLD_PX;

    if (tool === 'select') {
      if (target.closest('.react-flow__node, .react-flow__edge')) return;
      const prev = selectionRef.current;
      track(
        (ev) => {
          if (moved(ev)) setDraft({ kind: 'marquee', a: start, b: toBoard(ev.clientX, ev.clientY) });
        },
        (ev) => {
          setDraft(null);
          if (!moved(ev)) {
            if (!ev.shiftKey) setSelection([]);
            return;
          }
          const m = marqueeBounds(start, toBoard(ev.clientX, ev.clientY));
          setSelection(marqueeSelect(doc.elements.filter((x) => x.type !== 'edge'), m, prev, ev.shiftKey));
        },
        () => setDraft(null),
      );
      return;
    }
    if (readOnly) return;

    if (isDrawTool(tool)) {
      const snap = (p: Point): Point => (gridOn ? { x: snapToGrid(p.x, spacing), y: snapToGrid(p.y, spacing) } : p);
      track(
        (ev) => setDraft({ kind: 'shape', tool, a: snap(start), b: snap(toBoard(ev.clientX, ev.clientY)), shift: ev.shiftKey }),
        (ev) => {
          setDraft(null);
          const click = !moved(ev);
          const a = snap(start);
          const b = snap(toBoard(ev.clientX, ev.clientY));
          const g = drawGeometry(tool, a, b, click, ev.shiftKey);
          // Text tool: create an empty text element, then enter edit mode (Req 6.3).
          emit(tool === 'text' ? editingStore.beginTextCreate(g) : createOp(tool, g));
        },
        () => setDraft(null),
      );
    } else if (tool === 'icon') {
      const name = uiState.getState().iconName;
      if (!name) return; // nothing chosen in the picker yet
      track(
        () => undefined,
        (ev) => {
          const p = toBoard(ev.clientX, ev.clientY);
          emit(iconCreateOp(name, gridOn ? { x: snapToGrid(p.x, spacing), y: snapToGrid(p.y, spacing) } : p));
        },
        () => undefined,
      );
    } else if (tool === 'freehand' || tool === 'eraser') {
      const sample = (ev: { clientX: number; clientY: number; pointerType?: string; pressure?: number }): StrokePoint => {
        const p = toBoard(ev.clientX, ev.clientY);
        return tool === 'freehand' && ev.pointerType !== 'mouse' && ev.pressure ? { ...p, p: ev.pressure } : p;
      };
      const pts: StrokePoint[] = [sample(e)];
      const kind = tool;
      setDraft({ kind, pts });
      track(
        (ev) => {
          pts.push(sample(ev));
          setDraft({ kind, pts });
        },
        (ev) => {
          setDraft(null);
          if (kind === 'freehand') {
            emit(freehandOp(pts, ev.shiftKey));
          } else {
            const targets = doc.elements
              .filter((x) => x.type !== 'edge' && !x.locked)
              .map((x) => ({ id: x.id, bounds: rotatedBounds(x) }));
            emit(deleteOp(eraseIntersecting(pts, targets)));
          }
        },
        () => setDraft(null),
      );
    }
  };

  // --- selection box: resize and rotate ------------------------------------------------------------
  const selBounds = useMemo(() => {
    const boxes: Bounds[] = [];
    for (const id of selection) {
      const el = byId.get(id);
      if (!el || el.type === 'edge') continue;
      const p = previews.get(id);
      boxes.push(p ? { x: p.x ?? el.x, y: p.y ?? el.y, width: p.width ?? el.width, height: p.height ?? el.height } : el);
    }
    return unionBounds(boxes);
  }, [selection, byId, previews]);

  // With several elements selected (e.g. by dragging an area), outline each one so the selection is
  // visible, not just the box around all of them. Capped so huge selections stay fast.
  const selOutlines = useMemo(() => {
    if (selection.length < 2) return [];
    const out: { id: string; x: number; y: number; width: number; height: number; rotation: number }[] = [];
    for (const id of selection) {
      if (out.length >= MAX_SELECTION_OUTLINES) break;
      const el = byId.get(id);
      if (!el || el.type === 'edge') continue;
      const p = previews.get(id);
      out.push({
        id,
        x: p?.x ?? el.x,
        y: p?.y ?? el.y,
        width: p?.width ?? el.width,
        height: p?.height ?? el.height,
        rotation: p?.rotation ?? el.rotation ?? 0,
      });
    }
    return out;
  }, [selection, byId, previews]);

  const startResize = (e: ReactPointerEvent, handle: HandleId): void => {
    e.stopPropagation();
    e.preventDefault();
    if (readOnly || !selBounds) return;
    const from = selBounds;
    const ids = [...selection];
    const origin = { x: e.clientX, y: e.clientY };
    const zoom = vpRef.current.zoom;
    const boundsAt = (ev: PointerEvent): Bounds =>
      resizeBounds(from, handle, (ev.clientX - origin.x) / zoom, (ev.clientY - origin.y) / zoom, ev.shiftKey);
    track(
      (ev) => setPreviews(toPreviews(scalePatches(doc.elements, ids, from, boundsAt(ev)))),
      (ev) => {
        const to = boundsAt(ev);
        const op = resizeOp(doc.elements, ids, from, to);
        if (!op) return setPreviews(EMPTY_PREVIEWS);
        holdPreviews(toPreviews(scalePatches(doc.elements, ids, from, to)));
        emit(op); // exactly one op per resize
      },
      () => setPreviews(EMPTY_PREVIEWS),
    );
  };

  const startRotate = (e: ReactPointerEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    if (readOnly || !selBounds) return;
    const c = center(selBounds);
    const ids = [...selection];
    const a0 = angleDeg(c, toBoard(e.clientX, e.clientY));
    const deltaAt = (ev: PointerEvent): number => {
      const d = angleDeg(c, toBoard(ev.clientX, ev.clientY)) - a0;
      return ev.shiftKey ? snapAngle(d) : d;
    };
    track(
      (ev) => setPreviews(toPreviews(rotatePatches(doc.elements, ids, deltaAt(ev)))),
      (ev) => {
        const d = deltaAt(ev);
        const op = rotateOp(doc.elements, ids, d);
        if (!op) return setPreviews(EMPTY_PREVIEWS);
        holdPreviews(toPreviews(rotatePatches(doc.elements, ids, d)));
        emit(op); // exactly one op per rotation
      },
      () => setPreviews(EMPTY_PREVIEWS),
    );
  };

  const nodesInteractive = activeTool === 'select' && !readOnly;
  const panButtons = activeTool === 'hand' ? [0, 1] : [1];

  return (
    <div
      ref={containerRef}
      className={`ob-canvas ob-tool-${activeTool}`}
      data-tool={activeTool}
      onPointerDown={onContainerPointerDown}
    >
      <ReactFlow<ObNode, ObEdge>
        nodes={projection.nodes}
        edges={projection.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={initialViewport}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onlyRenderVisibleElements
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        panOnDrag={panButtons}
        panActivationKeyCode="Space"
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        deleteKeyCode={null}
        elevateNodesOnSelect={false}
        nodesDraggable={nodesInteractive}
        nodesConnectable={nodesInteractive}
        elementsSelectable={activeTool === 'select'}
        selectNodesOnDrag={false}
        nodeDragThreshold={DRAG_THRESHOLD_PX}
        connectionMode={ConnectionMode.Loose}
        onMove={(_e, v) => applyViewport(v)}
        onNodeClick={(e, n) => clickSelect(e, n.id)}
        onEdgeClick={(e, ed) => clickSelect(e, ed.id)}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        proOptions={{ hideAttribution: false }}
      >
        {gridOn && <Background variant={BackgroundVariant.Dots} gap={spacing} size={1.5} />}
      </ReactFlow>

      <svg className="ob-overlay" width={size.width} height={size.height} aria-hidden="true">
        {guides.map((g, i) => {
          const a = boardToScreen(vp, g.axis === 'vertical' ? { x: g.position, y: g.start } : { x: g.start, y: g.position });
          const b = boardToScreen(vp, g.axis === 'vertical' ? { x: g.position, y: g.end } : { x: g.end, y: g.position });
          return <line key={i} className="ob-guide" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
        {draft && <DraftShape draft={draft} vp={vp} />}
      </svg>

      {activeTool === 'select' && selOutlines.map((o) => (
        <div
          key={o.id}
          className="ob-selection-outline"
          data-testid="selection-outline"
          style={{
            left: boardToScreen(vp, o).x,
            top: boardToScreen(vp, o).y,
            width: o.width * vp.zoom,
            height: o.height * vp.zoom,
            ...(o.rotation ? { transform: `rotate(${o.rotation}deg)` } : {}),
          }}
        />
      ))}
      {activeTool === 'select' && selBounds && (
        <SelectionBox bounds={selBounds} vp={vp} onResize={startResize} onRotate={startRotate} />
      )}

      <EditingLayer doc={doc} vp={vp} readOnly={readOnly} selection={selection} containerRef={containerRef} toBoard={toBoard} />

      {showMinimap && <Minimap doc={doc} vp={vp} size={size} onNavigate={(v) => { void rf.setViewport(v); applyViewport({ ...v }); }} />}
      <ZoomControls zoom={vp.zoom} besideMinimap={showMinimap} onZoom={zoomTo} onFit={fitAll} />
    </div>
  );
}

/** Each zoom button step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP = 1.25;

/** Zoom out, current level (resets to 100%), zoom in, and fit-all, beside the minimap. */
function ZoomControls({
  zoom,
  besideMinimap,
  onZoom,
  onFit,
}: {
  zoom: number;
  besideMinimap: boolean;
  onZoom(zoom: number): void;
  onFit(): void;
}) {
  const pct = formatZoomPercent(zoom);
  return (
    <div className={`ob-zoom${besideMinimap ? ' ob-zoom-beside-minimap' : ''}`} role="group" aria-label={t('Zoom')}>
      <button type="button" aria-label={t('Zoom out')} title={t('Zoom out')} disabled={zoom <= MIN_ZOOM} onClick={() => onZoom(zoom / ZOOM_STEP)}>
        <Icon name="zoomOut" size={16} />
      </button>
      <button type="button" className="ob-zoom-level" aria-label={t('Zoom {0}, reset to 100%', pct)} title={t('Reset to 100%')} onClick={() => onZoom(1)}>
        {pct}
      </button>
      <button type="button" aria-label={t('Zoom in')} title={t('Zoom in')} disabled={zoom >= MAX_ZOOM} onClick={() => onZoom(zoom * ZOOM_STEP)}>
        <Icon name="zoomIn" size={16} />
      </button>
      <button type="button" aria-label={t('Zoom to fit')} title={t('Zoom to fit')} onClick={onFit}>
        <Icon name="fit" size={16} />
      </button>
    </div>
  );
}

function DraftShape({ draft, vp }: { draft: Draft; vp: Viewport }) {
  const s = (p: Point): Point => boardToScreen(vp, p);
  switch (draft.kind) {
    case 'marquee': {
      const a = s(draft.a);
      const b = s(draft.b);
      return <rect className="ob-marquee" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} />;
    }
    case 'freehand':
    case 'eraser': {
      const pts = draft.pts.map((p) => s(p)).map((p) => `${p.x},${p.y}`).join(' ');
      return <polyline className={draft.kind === 'eraser' ? 'ob-draft ob-draft-erase' : 'ob-draft'} points={pts} fill="none" />;
    }
    case 'shape': {
      const a = s(draft.a);
      const b = s(draft.b);
      if (draft.tool === 'line' || draft.tool === 'arrow') return <line className="ob-draft" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(a.x - b.x);
      const h = Math.abs(a.y - b.y);
      if (draft.tool === 'ellipse') return <ellipse className="ob-draft" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />;
      if (draft.tool === 'diamond') {
        return <polygon className="ob-draft" points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} />;
      }
      return <rect className="ob-draft" x={x} y={y} width={w} height={h} />;
    }
  }
}

interface SelectionBoxProps {
  bounds: Bounds;
  vp: Viewport;
  onResize(e: ReactPointerEvent, handle: HandleId): void;
  onRotate(e: ReactPointerEvent): void;
}

/** 8 resize handles and 1 rotation handle; rendered straight from the selection, so it appears and disappears in the same frame (Req 5.5). */
function SelectionBox({ bounds, vp, onResize, onRotate }: SelectionBoxProps) {
  const tl = boardToScreen(vp, bounds);
  return (
    <div
      className="ob-selection"
      data-testid="selection-box"
      style={{ left: tl.x, top: tl.y, width: bounds.width * vp.zoom, height: bounds.height * vp.zoom }}
    >
      {RESIZE_HANDLES.map((h) => (
        <div key={h} className={`ob-resize-handle ob-h-${h}`} data-handle={h} onPointerDown={(e) => onResize(e, h)} />
      ))}
      <div className="ob-rotate-handle" data-handle="rotate" onPointerDown={onRotate} />
      <div className="ob-selection-size" aria-hidden="true">
        {Math.round(bounds.width)} × {Math.round(bounds.height)}
      </div>
    </div>
  );
}

const MINIMAP = { width: 200, height: 140, pad: 40 };

interface MinimapProps {
  doc: BoardDocument;
  vp: Viewport;
  size: { width: number; height: number };
  onNavigate(v: Viewport): void;
}

/** Minimap of ALL elements (not only the rendered ones) with the current viewport outlined (Req 3.12). */
function Minimap({ doc, vp, size, onNavigate }: MinimapProps) {
  const rects = useMemo(() => doc.elements.filter((e) => e.type !== 'edge'), [doc.elements]);
  const view: Bounds = {
    x: -vp.x / vp.zoom,
    y: -vp.y / vp.zoom,
    width: size.width / vp.zoom,
    height: size.height / vp.zoom,
  };
  const all = unionBounds([...rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })), view]) ?? view;
  const vb = { x: all.x - MINIMAP.pad, y: all.y - MINIMAP.pad, width: all.width + 2 * MINIMAP.pad, height: all.height + 2 * MINIMAP.pad };
  const onClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(r.width / vb.width, r.height / vb.height);
    const offX = (r.width - vb.width * scale) / 2;
    const offY = (r.height - vb.height * scale) / 2;
    const bx = vb.x + (e.clientX - r.left - offX) / scale;
    const by = vb.y + (e.clientY - r.top - offY) / scale;
    onNavigate({ x: size.width / 2 - bx * vp.zoom, y: size.height / 2 - by * vp.zoom, zoom: vp.zoom });
  };
  return (
    <svg
      className="ob-minimap"
      width={MINIMAP.width}
      height={MINIMAP.height}
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
      role="img"
      aria-label="Minimap"
      onClick={onClick}
    >
      {rects.map((r) => (
        <rect key={r.id} className="ob-minimap-el" x={r.x} y={r.y} width={r.width} height={r.height} />
      ))}
      <rect className="ob-minimap-view" x={view.x} y={view.y} width={view.width} height={view.height} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
