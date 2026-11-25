import { useMemo } from 'react';
import type { Element } from '../../core/model';
import { IMAGE_UNREADABLE_MESSAGE } from '../../core/image';
import { decodeImage } from '../editing/EditingLayer';
import { planImageFill, rejectionMessages, type RawImageFile } from '../editing/media';
import { dispatchOp } from '../ops';
import { store as defaultStore, useWebviewState, type WebviewStore } from '../store';
import { emitFocusBounds } from '../canvas/viewportBus';
import { setSelection, useUiState } from '../uiState';
import type { ComponentOp } from './component-model';
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
  const onImageFill = async (file: File, ids: string[]): Promise<string | undefined> => {
    let raw: RawImageFile;
    try {
      raw = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), size: file.size };
    } catch {
      return IMAGE_UNREADABLE_MESSAGE;
    }
    const plan = await planImageFill(ids, raw, decodeImage);
    if (!plan.op) return rejectionMessages(plan.rejected ? [plan.rejected] : [])[0] ?? IMAGE_UNREADABLE_MESSAGE;
    dispatchOp(plan.op.tool, plan.op.input);
    return undefined;
  };
  const onComponentOp = (op: ComponentOp): void => {
    dispatchOp(op.tool, op.input);
  };
  // Select the master and bring it into view; neither adds an Undo_History entry (Req 14.19).
  const onGoToMaster = (id: string): void => {
    const master = doc?.elements.find((e) => e.id === id);
    if (!master) return;
    setSelection([id]);
    emitFocusBounds({ x: master.x, y: master.y, width: master.width, height: master.height });
  };
  return (
    <PropertiesPanelView
      elements={elements}
      readOnly={readOnly}
      onUpdate={onUpdate}
      onImageFill={onImageFill}
      tokens={doc?.tokens}
      allElements={doc?.elements}
      onComponentOp={onComponentOp}
      onOp={onComponentOp}
      onGoToMaster={onGoToMaster}
    />
  );
}
