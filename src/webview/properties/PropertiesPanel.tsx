import { useMemo } from 'react';
import type { Element } from '../../core/model';
import { dispatchOp } from '../ops';
import { store as defaultStore, useWebviewState, type WebviewStore } from '../store';
import { useUiState } from '../uiState';
import type { UpdateOp } from './model';
import { PropertiesPanelView } from './PropertiesPanelView';

/** Properties_Panel bound to the webview store and selection (Req 6.6-6.9). */
export function PropertiesPanel({ store = defaultStore }: { store?: WebviewStore }) {
  const { doc, readOnly } = useWebviewState(store);
  const { selection } = useUiState();
  const elements = useMemo<Element[]>(() => {
    if (!doc) return [];
    const want = new Set(selection);
    return doc.elements.filter((e) => want.has(e.id));
  }, [doc, selection]);
  const onUpdate = (op: UpdateOp): void => {
    dispatchOp(op.tool, op.input);
  };
  return <PropertiesPanelView elements={elements} readOnly={readOnly} onUpdate={onUpdate} />;
}
