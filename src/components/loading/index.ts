/**
 * The ONE loading system. Import from here everywhere:
 *   MalnadLoader   — the raw animation (size/label).
 *   InlineLoader   — small inline variant (buttons, inline async). Replaces <Loader2 spin/>.
 *   LoadingScreen  — centered region for route loading.tsx / Suspense / async sections.
 *   LoadingButton  — async button (auto busy state, double-submit safe).
 *   LoadingOverlay — controlled full-screen interaction-locking overlay.
 *   LoadingProvider / useGlobalLoading — imperative global overlay for long-running ops.
 *
 * All use the single global `mal-` CSS (src/app/loader.css). No other loading animation exists.
 */
export { MalnadLoader, InlineLoader, LoadingScreen } from './malnad-loader';
export { LoadingButton } from './loading-button';
export { LoadingOverlay, LoadingProvider, useGlobalLoading } from './loading-overlay';
export {
  LoadingConfig,
  LOADING_MESSAGES,
  ALBUM_MESSAGES,
  resolveLoadingMessages,
  resolveStaticMessage,
  type MessageGroup,
  type MessageInput,
} from './loading-config';
export { useDelayedLoading, useRotatingMessage } from './use-delayed-loading';
