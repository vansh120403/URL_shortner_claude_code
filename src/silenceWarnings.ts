// Suppress ONLY the node:sqlite "experimental feature" warning, so startup
// logs stay clean. All other process warnings pass through unchanged.
// Imported for its side effect before any node:sqlite use.

const originalEmitWarning = process.emitWarning.bind(process);

function emitWarningFiltered(warning: string | Error, ...rest: unknown[]): void {
  const message = typeof warning === 'string' ? warning : warning.message;
  const typeArg = rest[0];
  const type =
    typeof typeArg === 'string'
      ? typeArg
      : typeArg && typeof typeArg === 'object' && 'type' in typeArg
        ? (typeArg as { type?: string }).type
        : undefined;
  if (type === 'ExperimentalWarning' && /SQLite/i.test(message)) return;
  (originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest);
}

process.emitWarning = emitWarningFiltered as typeof process.emitWarning;
