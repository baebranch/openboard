/**
 * Mapping between registry tool names (dotted, e.g. `openboard.element.create`) and language model
 * tool ids. VS Code only accepts LM tool ids matching /^[\w-]+$/, so dots become underscores.
 * Registry, API and command keep the dotted names.
 */
export function toLmToolName(name: string): string {
  return name.replace(/\./g, '_');
}

/** Reverse lookup: the registry name whose LM name is `lmName`, or undefined. */
export function fromLmToolName(registry: { list(): string[] }, lmName: string): string | undefined {
  return registry.list().find((n) => toLmToolName(n) === lmName);
}
