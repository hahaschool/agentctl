// ── Prompt templates for LLM-based task decomposition (§10.5 Phase 5b) ──

export const DECOMPOSE_SYSTEM_PROMPT = `You are a task decomposition engine for a multi-agent AI orchestration platform.

Your job is to break a high-level task description into a directed acyclic graph (DAG) of sub-tasks that can be assigned to AI coding agents.

## Output Format

You MUST respond with ONLY valid JSON matching this exact schema (no markdown, no explanation outside the JSON):

{
  "tasks": [
    {
      "tempId": "string (unique identifier, e.g. 't1', 't2')",
      "type": "task | gate",
      "name": "string (short, descriptive name)",
      "description": "string (detailed instruction for the agent)",
      "requiredCapabilities": ["string (capabilities needed)"],
      "estimatedTokens": number,
      "timeoutMs": number
    }
  ],
  "edges": [
    {
      "from": "string (tempId of predecessor)",
      "to": "string (tempId of successor)",
      "type": "blocks | context"
    }
  ],
  "suggestedApprovalGates": ["string (tempIds of gate-type nodes)"],
  "reasoning": "string (brief explanation of the decomposition strategy)",
  "estimatedTotalTokens": number,
  "estimatedTotalCostUsd": number | null
}

## Rules

1. Use ONLY capabilities that exist in the provided agent profile list.
2. Prefer parallelism: if two sub-tasks are independent, do NOT add an edge between them.
3. Insert approval gates (type: "gate") before destructive or high-risk steps (e.g., database migrations, production deployments, force pushes).
4. Each sub-task should be completable by a single agent in one session. Keep estimated tokens under the per-task budget.
5. Edge type "blocks" means the predecessor must complete before the successor can start. Edge type "context" means the predecessor's output is useful but not strictly required.
6. Every tempId must be unique across all tasks.
7. The graph must be a valid DAG (no cycles).
8. Do not create more sub-tasks than necessary. Prefer fewer, well-scoped tasks over many tiny ones.`;

export function buildUserPrompt(params: {
  readonly description: string;
  readonly profileSummaries: readonly string[];
  readonly nodeCapabilities: readonly string[];
  readonly maxSubTasks: number;
  readonly maxDepthLevels: number;
  readonly budgetTokens: number | undefined;
  readonly requiredCapabilities: readonly string[] | undefined;
  readonly excludeCapabilities: readonly string[] | undefined;
}): string {
  const lines: string[] = [
    '## Task Description',
    '',
    params.description,
    '',
    '## Available Agent Profiles',
    '',
  ];

  if (params.profileSummaries.length > 0) {
    for (const summary of params.profileSummaries) {
      lines.push(`- ${summary}`);
    }
  } else {
    lines.push('No agent profiles configured. Use generic capabilities.');
  }

  lines.push('', '## Available Machine Capabilities', '');

  if (params.nodeCapabilities.length > 0) {
    lines.push(params.nodeCapabilities.join(', '));
  } else {
    lines.push('No specific machine capabilities registered.');
  }

  lines.push('', '## Constraints', '');
  lines.push(`- Maximum sub-tasks: ${params.maxSubTasks}`);
  lines.push(`- Maximum DAG depth: ${params.maxDepthLevels}`);

  if (params.budgetTokens !== undefined) {
    lines.push(`- Total token budget: ${params.budgetTokens}`);
  }

  if (params.requiredCapabilities && params.requiredCapabilities.length > 0) {
    lines.push(
      `- Must include at least one sub-task requiring: ${params.requiredCapabilities.join(', ')}`,
    );
  }

  if (params.excludeCapabilities && params.excludeCapabilities.length > 0) {
    lines.push(`- Do NOT use these capabilities: ${params.excludeCapabilities.join(', ')}`);
  }

  return lines.join('\n');
}
