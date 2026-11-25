/** "Go to master": select the master Frame and bring it into view. No document edit, no history entry. */
import type { FrameElement } from '../../core/model';
import { emitFocusBounds } from '../canvas/viewportBus';

export function goToMaster(master: FrameElement, setSelection: (ids: string[]) => void): void {
  setSelection([master.id]);
  emitFocusBounds({ x: master.x, y: master.y, width: master.width, height: master.height });
}
