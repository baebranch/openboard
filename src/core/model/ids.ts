/** Generate a collision-resistant identifier (UUID v4). No cross-window counter (Req 15.9). */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
