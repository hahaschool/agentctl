import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DeploymentView } from '@/views/DeploymentView';

export default function Page() {
  return (
    <ErrorBoundary>
      <DeploymentView />
    </ErrorBoundary>
  );
}
