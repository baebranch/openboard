import { Canvas } from './canvas/Canvas';
import { PropertiesPanel } from './properties/PropertiesPanel';
import { useWebviewState, type WebviewStore } from './store';
import { store as defaultStore } from './store';
import { ToolPalette } from './palette/ToolPalette';
import { ExportButtons } from './export/ExportButtons';
import { BoardPanelButtons, BoardSidebar } from './panel/BoardPanels';
import { Presentation } from './panel/Presentation';
import { usePresentation } from './presentation';

/** Webview shell: full-screen canvas with floating palette, export buttons, properties and notices. */
export function App({ store = defaultStore }: { store?: WebviewStore }) {
  const { doc, notices, readOnly } = useWebviewState(store);
  // Presenting hides every toolbar and panel (they stay mounted, so the canvas keeps its view).
  const presenting = usePresentation() !== undefined;
  if (!doc) return <p role="status">Loading board…</p>;
  const title = doc.meta.title && doc.meta.title.length > 0 ? doc.meta.title : 'Untitled board';
  return (
    <main className={`ob-app${presenting ? ' ob-presenting' : ''}`} aria-label={`${title}${readOnly ? ' (read-only)' : ''}`}>
      <div className="ob-canvas-host">
        <Canvas />
      </div>
      <ToolPalette store={store} footer={<BoardPanelButtons />} />
      <BoardSidebar store={store} />
      <Presentation store={store} />
      <ExportButtons store={store} />
      <ul className="ob-notices" aria-live="polite">
        {notices.map((n) => (
          <li key={n.id} data-level={n.level}>
            {n.message}{' '}
            <button type="button" onClick={() => store.dismissNotice(n.id)}>
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      <PropertiesPanel store={store} />
    </main>
  );
}
