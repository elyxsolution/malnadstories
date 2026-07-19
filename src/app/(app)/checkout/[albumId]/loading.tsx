import { LoadingScreen } from '@/components/loading';

/** Checkout route loading — the unified Malnad album loader (centralized copy). */
export default function CheckoutLoading() {
  return <LoadingScreen fullscreen messageGroup="checkout" />;
}
