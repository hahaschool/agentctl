import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConflictsPage } from '@/views/ConflictsPage';

export default function Page() {
  return (
    <ErrorBoundary>
      <ConflictsPage />
    </ErrorBoundary>
  );
}
