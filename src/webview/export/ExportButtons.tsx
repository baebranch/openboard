/**
 * Export entry points mounted in App: "Export…" (dialog) and "Copy selection as PNG". Copying is
 * offered only while something is selected (the whole board goes through the dialog), and reports
 * success with a short notice, since a clipboard write is otherwise invisible.
 */
import { useState } from 'react';
import { dispatchOp } from '../ops';
import { store as defaultStore, useWebviewState, type WebviewStore } from '../store';
import { uiState as defaultUi, useUiState, type UiStateStore } from '../uiState';
import { copyAsPng, writePngToClipboard } from './actions';
import { ExportDialog } from './ExportDialog';
import { Icon } from '../icons';
import { rasterize } from './rasterizer';

/** How long the "copied" confirmation stays up. */
const COPIED_NOTICE_MS = 2500;

export function ExportButtons({ store = defaultStore, ui = defaultUi }: { store?: WebviewStore; ui?: UiStateStore }) {
  const [open, setOpen] = useState(false);
  const { doc } = useWebviewState(store);
  const { selection } = useUiState(ui);
  if (!doc) return null;
  const copy = async (): Promise<void> => {
    const ok = await copyAsPng(
      {
        notify: (level, message) => store.addNotice(level, message),
        rasterize,
        writeClipboard: writePngToClipboard,
      },
      doc,
      selection,
    );
    if (!ok) return;
    store.addNotice('info', selection.length === 1 ? 'Copied the selected element as PNG.' : `Copied ${selection.length} elements as PNG.`);
    const id = store.getState().notices.at(-1)?.id;
    if (id !== undefined) setTimeout(() => store.dismissNotice(id), COPIED_NOTICE_MS);
  };
  return (
    <>
      <div className="ob-export" role="group" aria-label="Export">
        <button type="button" aria-label="Export…" title="Export…" onClick={() => setOpen(true)}>
          <Icon name="export" />
        </button>
        {selection.length > 0 ? (
          <button type="button" aria-label="Copy selection as PNG" title="Copy selection as PNG" onClick={() => void copy()}>
            <Icon name="copyImage" />
          </button>
        ) : null}
      </div>
      {/* Outside the icon-button group, so the group's 32px icon-button styles do not reach the dialog. */}
      {open && (
        <ExportDialog
          doc={doc}
          selection={selection}
          onClose={() => setOpen(false)}
          onExport={(input) => dispatchOp('openboard.export', input)}
        />
      )}
    </>
  );
}
