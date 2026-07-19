import { LoadingScreen } from '@/components/loading';

/** Builder route loading — the unified Malnad album loader (centralized copy). */
export default function BuilderLoading() {
  return <LoadingScreen fullscreen messageGroup="albumCreation" />;
}
