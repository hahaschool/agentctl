import type { AgentConfig } from './api';

export type AgentTemplateConfig = Pick<AgentConfig, 'defaultPrompt' | 'permissionMode' | 'model'>;

export type AgentTemplateIcon = 'GitPullRequest' | 'Bug' | 'FlaskConical' | 'FileText';

export type AgentTemplate = {
  id: string;
  name: string;
  description: string;
  icon: AgentTemplateIcon;
  config: AgentTemplateConfig;
};

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Reviews PRs and provides feedback on code quality',
    icon: 'GitPullRequest',
    config: {
      defaultPrompt: 'Review the latest PR and provide feedback',
      permissionMode: 'acceptEdits',
      model: 'claude-sonnet-4-6',
    },
  },
  {
    id: 'bug-fixer',
    name: 'Bug Fixer',
    description: 'Debugs and fixes issues from error logs',
    icon: 'Bug',
    config: {
      defaultPrompt: 'Find and fix the latest reported bug',
      permissionMode: 'bypassPermissions',
      model: 'claude-opus-4-6',
    },
  },
  {
    id: 'test-writer',
    name: 'Test Writer',
    description: 'Writes unit and integration tests for uncovered code',
    icon: 'FlaskConical',
    config: {
      defaultPrompt: 'Write tests for recently changed files',
      permissionMode: 'bypassPermissions',
      model: 'claude-sonnet-4-6',
    },
  },
  {
    id: 'doc-updater',
    name: 'Documentation',
    description: 'Updates documentation based on code changes',
    icon: 'FileText',
    config: {
      defaultPrompt: 'Update documentation for recent changes',
      permissionMode: 'bypassPermissions',
      model: 'claude-sonnet-4-6',
    },
  },
];
