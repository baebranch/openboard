/** Webview entry point (bundled to dist/webview.js and dist/webview.css). */
import { createRoot } from 'react-dom/client';
import { validateHostToWebview, validateWebviewToHost } from 'openboard-validators';
import { App } from './App';
import { emitHostViewport, emitViewCommand } from './canvas/viewportBus';
import { createRenderRequestHandler } from './export/host';
import { receiveFonts, setFontRequestSender } from './fonts';
import { createMessaging, type VsCodeApi } from './messaging';
import { initL10n } from './i18n/t';
import { setOpSender } from './ops';
import { store } from './store';
import { getThemeAdapter } from './theme';
import './app.css';

declare function acquireVsCodeApi(): VsCodeApi;

initL10n();
getThemeAdapter();
const api = acquireVsCodeApi();
const messaging = createMessaging(
  api,
  { validateHostToWebview, validateWebviewToHost },
  store,
  {
    onViewport: emitHostViewport,
    onViewCommand: emitViewCommand,
    onRenderRequest: createRenderRequestHandler((m) => api.postMessage(m), store),
    onFonts: receiveFonts,
  },
  (message) => api.postMessage({ type: 'log', level: 'warn', message }),
);

setOpSender((m) => messaging.send(m));
setFontRequestSender(() => messaging.send({ type: 'fonts:request' }));
window.addEventListener('message', (e: MessageEvent) => messaging.receive(e.data));

const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);

messaging.ready();
