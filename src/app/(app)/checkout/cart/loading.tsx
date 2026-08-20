import { LoadingScreen } from '@/components/loading';

/** Combined-checkout route loading — the unified Malnad album loader (centralized copy). */
export default function CombinedCheckoutLoading() {
  return <LoadingScreen fullscreen messageGroup="checkout" />;
}
