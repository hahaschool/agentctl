import { redirect } from 'next/navigation';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function MemoryRedirectContent() {
  redirect('/memory/browser');
  return null;
}

export default function MemoryPage() {
  return (
    <ErrorBoundary>
      <MemoryRedirectContent />
    </ErrorBoundary>
  );
}
