import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SecurityFindingsPage } from '@/views/SecurityFindingsPage';

export default function Page() {
  return (
    <ErrorBoundary>
      <SecurityFindingsPage />
    </ErrorBoundary>
  );
}
