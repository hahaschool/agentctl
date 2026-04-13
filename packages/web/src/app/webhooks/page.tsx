import { ErrorBoundary } from '@/components/ErrorBoundary';
import { WebhooksPage } from '@/views/WebhooksPage';

export default function Page() {
  return (
    <ErrorBoundary>
      <WebhooksPage />
    </ErrorBoundary>
  );
}
