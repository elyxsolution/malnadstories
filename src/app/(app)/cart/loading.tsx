import { LoadingScreen } from '@/components/loading';

/** Cart route loading — the unified Malnad album loader (centralized copy, existing groups only). */
export default function CartLoading() {
  return <LoadingScreen fullscreen messageGroup="generic" />;
}
