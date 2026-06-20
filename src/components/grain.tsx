/**
 * Reusable paper-grain overlay (Claude Design Foundations). A fixed, non-interactive
 * fractal-noise wash at low opacity / multiply blend — the texture that makes the cream
 * canvas read like uncoated paper. Rendered once globally in the root layout; harmless
 * over the builder's own dark-stage grain.
 */
export default function Grain() {
  return <div aria-hidden className="paper-grain" />;
}
