import { LoadingScreen } from '@/components/loading';

/** Dashboard route loading — the unified Malnad album loader (centralized copy). */
export default function DashboardLoading() {
  return <LoadingScreen fullscreen messageGroup="dashboard" />;
}
