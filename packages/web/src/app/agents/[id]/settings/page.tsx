'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Settings } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type React from 'react';
import { useState } from 'react';

import { ConfigPreviewPanel } from '@/components/agent-settings/ConfigPreviewPanel';
import { GeneralTab } from '@/components/agent-settings/GeneralTab';
import { McpServersTab } from '@/components/agent-settings/McpServersTab';
import { MemoryTab } from '@/components/agent-settings/MemoryTab';
import { ModelPromptsTab } from '@/components/agent-settings/ModelPromptsTab';
import { PermissionsToolsTab } from '@/components/agent-settings/PermissionsToolsTab';
import { RuntimeConfigTab } from '@/components/agent-settings/RuntimeConfigTab';
import { SkillsTab } from '@/components/agent-settings/SkillsTab';
import { Breadcrumb } from '@/components/Breadcrumb';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { ErrorBanner } from '@/components/ErrorBanner';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { agentQuery, machinesQuery } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'model-prompts', label: 'Model & Prompts' },
  { value: 'permissions', label: 'Permissions & Tools' },
  { value: 'mcp', label: 'MCP Servers' },
  { value: 'skills', label: 'Skills' },
  { value: 'memory', label: 'Memory' },
  { value: 'runtime-config', label: 'Runtime Config' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AgentSettingsPageContent(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const agentId = params.id;

  const agent = useQuery(agentQuery(agentId));
  const machinesList = useQuery(machinesQuery());

  const [activeTab, setActiveTab] = useState<TabValue>('general');
  const [previewOpen, setPreviewOpen] = useState(false);

  // -- Loading --
  if (agent.isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px]">
        <Skeleton className="h-4 w-48 mb-4" />
        <Skeleton className="h-8 w-72 mb-6" />
        <Skeleton className="h-9 w-full mb-6" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  // -- Error --
  if (agent.error) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px]">
        <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: 'Error' }]} />
        <ErrorBanner
          message={`Failed to load agent: ${agent.error.message}`}
          onRetry={() => void agent.refetch()}
          className="mt-6"
        />
      </div>
    );
  }

  const data = agent.data;

  if (!data) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px]">
        <Breadcrumb items={[{ label: 'Agents', href: '/agents' }, { label: 'Error' }]} />
        <div className="mt-6 text-center text-muted-foreground text-sm py-12">Agent not found.</div>
      </div>
    );
  }

  const machines = machinesList.data ?? [];

  return (
    <div className="p-4 md:p-6 max-w-[1400px] animate-page-enter">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Agents', href: '/agents' },
          { label: data.name, href: `/agents/${agentId}` },
          { label: 'Settings' },
        ]}
      />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/agents/${agentId}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to agent"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-[22px] font-semibold tracking-tight">
          {data.name}
          <span className="text-muted-foreground font-normal ml-2 text-base">Settings</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        {/* Left column: tabs and forms */}
        <div>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
            <TabsList className="mb-6 flex w-full justify-start gap-1 overflow-x-auto whitespace-nowrap">
              {TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="shrink-0">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="general">
              <GeneralTab agent={data} machines={machines} />
            </TabsContent>

            <TabsContent value="model-prompts">
              <ModelPromptsTab agent={data} />
            </TabsContent>

            <TabsContent value="permissions">
              <PermissionsToolsTab agent={data} />
            </TabsContent>

            <TabsContent value="mcp">
              <McpServersTab agent={data} />
            </TabsContent>

            <TabsContent value="skills">
              <SkillsTab agent={data} />
            </TabsContent>

            <TabsContent value="memory">
              <MemoryTab agent={data} />
            </TabsContent>

            <TabsContent value="runtime-config">
              <RuntimeConfigTab agent={data} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Desktop sidebar */}
        <div className="hidden lg:block sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto">
          <ConfigPreviewPanel agentId={data.id} runtime={data.runtime} />
        </div>
      </div>

      {/* Mobile preview panel */}
      <div className="lg:hidden mt-6">
        <CollapsibleSection
          title="Config Preview"
          open={previewOpen}
          onToggle={() => setPreviewOpen((v) => !v)}
        >
          <ConfigPreviewPanel agentId={data.id} runtime={data.runtime} />
        </CollapsibleSection>
      </div>
    </div>
  );
}

export default function AgentSettingsPage(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <AgentSettingsPageContent />
    </ErrorBoundary>
  );
}
