/**
 * Board sidebar: Layers, Slides and Components. `BoardPanelButtons` sits at the bottom of the tool
 * palette (below a divider) and opens one panel at a time; its fourth button shows or hides the
 * sidebar, reopening the last panel. `BoardSidebar` renders the open panel, anchored to the top of
 * the window so results stay at the top while a list shrinks or grows. Escape inside a panel closes
 * it and returns focus to its button.
 */
import { useMemo, useState } from 'react';
import { listMasters, type MasterEntry } from '../../core/components/masters';
import { slideFrames } from '../../core/export/slides';
import type { FrameElement } from '../../core/model/types';
import { emitFocusBounds } from '../canvas/viewportBus';
import { t } from '../i18n/t';
import { Icon, type IconName } from '../icons';
import { dispatchOp } from '../ops';
import { startPresentation } from '../presentation';
import { store as defaultStore, useWebviewState, type WebviewStore } from '../store';
import { useThemePalette } from '../theme/useThemePalette';
import { uiState as defaultUi, useUiState, type UiStateStore } from '../uiState';
import { ComponentPanel } from './ComponentPanel';
import { LayersPanel } from './LayersPanel';
import { PANEL_BUTTON_ATTR, panelState as defaultPanels, usePanelState, type PanelId, type PanelStateStore } from './panelState';
import { SlidesPanel } from './SlidesPanel';
import { frameImage } from './thumbnails';

const BUTTONS: readonly { id: PanelId; icon: IconName; label: () => string }[] = [
  { id: 'layers', icon: 'layers', label: () => t('Layers') },
  { id: 'slides', icon: 'slides', label: () => t('Slides') },
  { id: 'components', icon: 'components', label: () => t('Components') },
];

const panelDomId = (p: PanelId): string => `ob-board-panel-${p}`;

/** Exports every slide, in panel order, as one multi-page PDF; the host asks where to save it. */
export function buildSlidesPdfOp(slides: readonly FrameElement[]): { tool: string; input: Record<string, unknown> } {
  return { tool: 'openboard.export', input: { format: 'pdf', scope: 'frames', frameIds: slides.map((s) => s.id), scale: 2, background: 'white' } };
}

/** The four sidebar buttons, rendered inside the tool palette. */
export function BoardPanelButtons({ panels = defaultPanels }: { panels?: PanelStateStore }) {
  const { open } = usePanelState(panels);
  const toggleLabel = open ? t('Hide sidebar') : t('Show sidebar');
  return (
    <div role="group" aria-label={t('Board panels')} className="ob-panel-buttons">
      {BUTTONS.map((b) => (
        <button
          key={b.id}
          type="button"
          {...{ [PANEL_BUTTON_ATTR]: b.id }}
          aria-label={b.label()}
          title={b.label()}
          aria-expanded={open === b.id}
          aria-controls={open === b.id ? panelDomId(b.id) : undefined}
          onClick={() => panels.toggle(b.id)}
        >
          <Icon name={b.icon} />
        </button>
      ))}
      <button
        type="button"
        {...{ [PANEL_BUTTON_ATTR]: 'sidebar' }}
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-expanded={open !== undefined}
        aria-controls={open ? panelDomId(open) : undefined}
        onClick={() => panels.toggleSidebar()}
      >
        <Icon name="sidebar" />
      </button>
    </div>
  );
}

/** The open sidebar panel, if any. */
export function BoardSidebar({
  store = defaultStore,
  ui = defaultUi,
  panels = defaultPanels,
}: {
  store?: WebviewStore;
  ui?: UiStateStore;
  panels?: PanelStateStore;
}) {
  const { doc, readOnly } = useWebviewState(store);
  const { selection } = useUiState(ui);
  const { open } = usePanelState(panels);
  const palette = useThemePalette();

  // Kept while the sidebar is mounted, so reopening the Slides panel remembers the choice.
  const [includeComponents, setIncludeComponents] = useState(false);
  const masters = useMemo(() => (doc ? listMasters(doc) : []), [doc]);
  const slides = useMemo(() => (doc ? slideFrames(doc.elements, { includeMasters: includeComponents }) : []), [doc, includeComponents]);
  // Previews are drawn only for the open panel.
  const previews = useMemo(() => {
    const out = new Map<string, string | undefined>();
    if (!doc || (open !== 'slides' && open !== 'components')) return out;
    const byId = new Map(doc.elements.map((e) => [e.id, e]));
    const frames = open === 'slides' ? slides : masters.map((m) => byId.get(m.id)).filter((e) => e !== undefined);
    for (const f of frames) out.set(f.id, frameImage(doc, f, palette));
    return out;
  }, [doc, open, slides, masters, palette]);

  const focusOn = (b: { x: number; y: number; width: number; height: number }, id: string): void => {
    ui.setSelection([id]);
    emitFocusBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  };
  const close = (): void => {
    const was = open;
    panels.close();
    if (was) document.querySelector<HTMLElement>(`[${PANEL_BUTTON_ATTR}="${was}"]`)?.focus();
  };

  if (open === 'components') {
    return (
      <ComponentPanel id={panelDomId('components')} masters={masters} previews={previews} onGoToMaster={(m: MasterEntry) => focusOn(m, m.id)} onClose={close} />
    );
  }
  if (open === 'layers' && doc) {
    return <LayersPanel id={panelDomId('layers')} doc={doc} selection={selection} onSelect={(ids) => ui.setSelection(ids)} onClose={close} />;
  }
  if (open === 'slides') {
    return (
      <SlidesPanel
        id={panelDomId('slides')}
        slides={slides}
        previews={previews}
        selection={selection}
        readOnly={readOnly}
        includeComponents={includeComponents}
        onIncludeComponentsChange={setIncludeComponents}
        onGoTo={(f) => focusOn(f, f.id)}
        onPresent={(i) => startPresentation(slides.map((s) => s.id), i)}
        onExportPdf={() => {
          const op = buildSlidesPdfOp(slides);
          dispatchOp(op.tool, op.input);
        }}
        onClose={close}
      />
    );
  }
  return null;
}

/** Buttons and sidebar together (for tests and embedding without the tool palette). */
export function BoardPanelsToolbar(props: { store?: WebviewStore; ui?: UiStateStore; panels?: PanelStateStore }) {
  return (
    <>
      <BoardPanelButtons {...(props.panels ? { panels: props.panels } : {})} />
      <BoardSidebar {...props} />
    </>
  );
}
