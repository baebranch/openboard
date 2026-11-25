/** Export entry points mounted in App: "Export…" (dialog) and "Copy as PNG". */
import { useState } from 'react';
import { dispatchOp } from '../ops';
import { store as defaultStore, useWebviewState, type WebviewStore } from '../store';
import { getSelection } from '../uiState';
import { copyAsPng, writePngToClipboard } from './actions';
import { ExportDialog } from './ExportDialog';
import { Icon } from '../icons';
import { rasterize } from './rasterizer';

export function ExportButtons({ store = defaultStore }: { store?: WebviewStore }) {
  const [open, setOpen] = useState(false);
  const { doc } = useWebviewState(store);
  if (!doc) return null;
  const copy = (): void => {
    void copyAsPng(
      {
        notify: (level, message) => store.addNotice(level, message),
        rasterize,
        writeClipboard: writePngToClipboard,
      },
      doc,
      getSelection(),
    );
  };
  return (
    <div className="ob-export" role="group" aria-label="Export">
      <button type="button" aria-label="Export…" title="Export…" onClick={() => setOpen(true)}>
        <Icon name="export" />
      </button>
      <button type="button" aria-label="Copy as PNG" title="Copy as PNG" onClick={copy}>
        <Icon name="copyImage" />
      </button>
      {open && (
        <ExportDialog
          doc={doc}
          selection={getSelection()}
          onClose={() => setOpen(false)}
          onExport={(input) => dispatchOp('openboard.export', input)}
        />
      )}
    </div>
  );
}
