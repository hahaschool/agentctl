import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MeshPeersPage } from '@/views/MeshPeersPage';

export default function Page() {
  return (
    <ErrorBoundary>
      <MeshPeersPage />
    </ErrorBoundary>
  );
}
