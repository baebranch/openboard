/** Wires host `render:request` messages to the rasterizer (called from main.tsx). */
import type { RenderSpec, WebviewToHost } from '../../shared/messages';
import { handleRenderRequest } from './actions';
import { blobToBase64, rasterize } from './rasterizer';
import type { WebviewStore } from '../store';

export function createRenderRequestHandler(
  send: (m: WebviewToHost) => void,
  store: WebviewStore,
): (requestId: string, spec: RenderSpec) => void {
  return (requestId, spec) => {
    void handleRenderRequest(
      {
        send,
        notify: (level, message) => store.addNotice(level, message),
        rasterize: async (s) => blobToBase64(await rasterize(s)),
      },
      requestId,
      spec,
    );
  };
}
