/** Error carrying a structured tool error `code` (the registry maps `code` into the result). */
export class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
