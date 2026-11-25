/** Build-time standalone validators (dist/validators.js, produced by scripts/build-schemas.mjs). */
declare module 'openboard-validators' {
  import type { MessageValidators } from '../shared/messages';
  export const validateWebviewToHost: MessageValidators['validateWebviewToHost'];
  export const validateHostToWebview: MessageValidators['validateHostToWebview'];
}

declare module '*.css';
