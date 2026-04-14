import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuditPage } from '@/views/AuditPage';

export default function Page() {
  return (
    <ErrorBoundary>
      <AuditPage />
    </ErrorBoundary>
  );
}
