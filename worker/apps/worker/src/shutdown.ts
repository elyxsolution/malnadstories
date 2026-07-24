/**
 * SIGNAL HANDLING for graceful shutdown. Registers SIGINT + SIGTERM handlers that invoke a callback
 * ONCE (a second signal is ignored while draining). Returns a disposer that removes the handlers —
 * used by tests so they never leave process listeners behind.
 */
export function installSignalHandlers(onSignal: (signal: NodeJS.Signals) => void): () => void {
  let fired = false;
  const handle = (signal: NodeJS.Signals): void => {
    if (fired) return;
    fired = true;
    onSignal(signal);
  };
  const sigint = (): void => handle('SIGINT');
  const sigterm = (): void => handle('SIGTERM');

  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);

  return (): void => {
    process.off('SIGINT', sigint);
    process.off('SIGTERM', sigterm);
  };
}
