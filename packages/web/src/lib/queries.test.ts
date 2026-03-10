import { describe, expect, it } from 'vitest';

import {
  accountDefaultsQuery,
  accountsQuery,
  agentQuery,
  agentRunsQuery,
  agentsQuery,
  discoverQuery,
  healthQuery,
  machinesQuery,
  metricsQuery,
  projectAccountsQuery,
  queryKeys,
  routerModelsInfoQuery,
  routerModelsQuery,
  runtimeHandoffSummaryQuery,
  runtimeSessionHandoffsQuery,
  runtimeSessionPreflightQuery,
  runtimeSessionsQuery,
  sessionContentQuery,
  sessionQuery,
  sessionsQuery,
} from './queries';

// ---------------------------------------------------------------------------
// queryKeys namespace
// ---------------------------------------------------------------------------

describe('queryKeys', () => {
  it('health key is correct', () => {
    expect(queryKeys.health).toEqual(['health']);
  });

  it('machines key is correct', () => {
    expect(queryKeys.machines).toEqual(['machines']);
  });

  it('agents key is correct', () => {
    expect(queryKeys.agents).toEqual(['agents']);
  });

  it('agent key with id includes the id', () => {
    expect(queryKeys.agent('test-id')).toEqual(['agents', 'test-id']);
  });

  it('agentRuns key with agentId includes the agentId', () => {
    expect(queryKeys.agentRuns('agent-123')).toEqual(['agents', 'agent-123', 'runs']);
  });

  it('sessions key without params', () => {
    expect(queryKeys.sessions()).toEqual(['sessions']);
  });

  it('sessions key with params includes the params', () => {
    const params = { status: 'running', machineId: 'machine-1' };
    expect(queryKeys.sessions(params)).toEqual(['sessions', params]);
  });

  it('sessions key with partial params', () => {
    const params = { status: 'completed' };
    expect(queryKeys.sessions(params)).toEqual(['sessions', params]);
  });

  it('session key with id includes the id', () => {
    expect(queryKeys.session('session-123')).toEqual(['sessions', 'session-123']);
  });

  it('runtimeSessions key without params', () => {
    expect(queryKeys.runtimeSessions()).toEqual(['runtime-sessions']);
  });

  it('runtimeSessions key with params includes the params', () => {
    const params = { runtime: 'codex', status: 'active' } as const;
    expect(queryKeys.runtimeSessions(params)).toEqual(['runtime-sessions', params]);
  });

  it('runtimeSessionHandoffs key includes id', () => {
    expect(queryKeys.runtimeSessionHandoffs('ms-123')).toEqual([
      'runtime-sessions',
      'ms-123',
      'handoffs',
    ]);
  });

  it('runtimeSessionHandoffs key includes optional limit', () => {
    expect(queryKeys.runtimeSessionHandoffs('ms-123', 10)).toEqual([
      'runtime-sessions',
      'ms-123',
      'handoffs',
      10,
    ]);
  });

  it('runtimeSessionPreflight key includes target runtime', () => {
    expect(queryKeys.runtimeSessionPreflight('ms-123', 'claude-code')).toEqual([
      'runtime-sessions',
      'ms-123',
      'preflight',
      'claude-code',
    ]);
  });

  it('runtimeSessionPreflight key includes target machine when present', () => {
    expect(queryKeys.runtimeSessionPreflight('ms-123', 'claude-code', 'machine-2')).toEqual([
      'runtime-sessions',
      'ms-123',
      'preflight',
      'claude-code',
      'machine-2',
    ]);
  });

  it('runtimeHandoffSummary key includes optional limit', () => {
    expect(queryKeys.runtimeHandoffSummary(100)).toEqual([
      'runtime-sessions',
      'handoffs',
      'summary',
      100,
    ]);
  });

  it('sessionContent key includes sessionId and params', () => {
    const params = { machineId: 'machine-1', projectPath: '/home/user/project', limit: 100 };
    expect(queryKeys.sessionContent('session-1', params)).toEqual([
      'session-content',
      'session-1',
      params,
    ]);
  });

  it('sessionContent key with minimal params', () => {
    const params = { machineId: 'machine-1' };
    expect(queryKeys.sessionContent('session-1', params)).toEqual([
      'session-content',
      'session-1',
      params,
    ]);
  });

  it('discover key is correct', () => {
    expect(queryKeys.discover).toEqual(['discovered-sessions']);
  });

  it('metrics key is correct', () => {
    expect(queryKeys.metrics).toEqual(['metrics']);
  });

  it('accounts key is correct', () => {
    expect(queryKeys.accounts).toEqual(['accounts']);
  });

  it('accountDefaults key is correct', () => {
    expect(queryKeys.accountDefaults).toEqual(['account-defaults']);
  });

  it('projectAccounts key is correct', () => {
    expect(queryKeys.projectAccounts).toEqual(['project-accounts']);
  });

  it('routerModels key is correct', () => {
    expect(queryKeys.routerModels).toEqual(['router', 'models']);
  });

  it('routerModelsInfo key is correct', () => {
    expect(queryKeys.routerModelsInfo).toEqual(['router', 'models-info']);
  });
});

// ---------------------------------------------------------------------------
// healthQuery
// ---------------------------------------------------------------------------

describe('healthQuery', () => {
  it('returns queryOptions with health queryKey', () => {
    const options = healthQuery();
    expect(options.queryKey).toEqual(queryKeys.health);
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = healthQuery();
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = healthQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// machinesQuery
// ---------------------------------------------------------------------------

describe('machinesQuery', () => {
  it('returns queryOptions with machines queryKey', () => {
    const options = machinesQuery();
    expect(options.queryKey).toEqual(queryKeys.machines);
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = machinesQuery();
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = machinesQuery();
    expect(options.queryFn).toBeDefined();
  });
});

describe('runtimeHandoffSummaryQuery', () => {
  it('returns queryOptions with runtime handoff summary queryKey', () => {
    const options = runtimeHandoffSummaryQuery(100);
    expect(options.queryKey).toEqual(queryKeys.runtimeHandoffSummary(100));
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = runtimeHandoffSummaryQuery(100);
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = runtimeHandoffSummaryQuery(100);
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// agentsQuery
// ---------------------------------------------------------------------------

describe('agentsQuery', () => {
  it('returns queryOptions with agents queryKey', () => {
    const options = agentsQuery();
    expect(options.queryKey).toEqual(queryKeys.agents);
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = agentsQuery();
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = agentsQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// agentQuery
// ---------------------------------------------------------------------------

describe('agentQuery', () => {
  it('returns queryOptions with agent queryKey including id', () => {
    const options = agentQuery('agent-123');
    expect(options.queryKey).toEqual(queryKeys.agent('agent-123'));
  });

  it('uses different key for different ids', () => {
    const options1 = agentQuery('agent-1');
    const options2 = agentQuery('agent-2');
    expect(options1.queryKey).not.toEqual(options2.queryKey);
  });

  it('has enabled property based on id', () => {
    const optionsWithId = agentQuery('agent-123');
    expect(optionsWithId.enabled).toBe(true);

    const optionsWithoutId = agentQuery('');
    expect(optionsWithoutId.enabled).toBe(false);
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = agentQuery('agent-123');
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = agentQuery('agent-123');
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// agentRunsQuery
// ---------------------------------------------------------------------------

describe('agentRunsQuery', () => {
  it('returns queryOptions with agentRuns queryKey including agentId', () => {
    const options = agentRunsQuery('agent-123');
    expect(options.queryKey).toEqual(queryKeys.agentRuns('agent-123'));
  });

  it('uses different key for different agentIds', () => {
    const options1 = agentRunsQuery('agent-1');
    const options2 = agentRunsQuery('agent-2');
    expect(options1.queryKey).not.toEqual(options2.queryKey);
  });

  it('has enabled property based on agentId', () => {
    const optionsWithId = agentRunsQuery('agent-123');
    expect(optionsWithId.enabled).toBe(true);

    const optionsWithoutId = agentRunsQuery('');
    expect(optionsWithoutId.enabled).toBe(false);
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = agentRunsQuery('agent-123');
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = agentRunsQuery('agent-123');
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// sessionsQuery
// ---------------------------------------------------------------------------

describe('sessionsQuery', () => {
  it('returns queryOptions with sessions queryKey without params', () => {
    const options = sessionsQuery();
    expect(options.queryKey).toEqual(queryKeys.sessions());
  });

  it('includes params in queryKey when provided', () => {
    const params = { status: 'running', machineId: 'machine-1' };
    const options = sessionsQuery(params);
    expect(options.queryKey).toEqual(queryKeys.sessions(params));
  });

  it('includes partial params in queryKey', () => {
    const params = { status: 'completed' };
    const options = sessionsQuery(params);
    expect(options.queryKey).toEqual(queryKeys.sessions(params));
  });

  it('uses different key for different params', () => {
    const options1 = sessionsQuery({ status: 'running' });
    const options2 = sessionsQuery({ status: 'completed' });
    expect(options1.queryKey).not.toEqual(options2.queryKey);
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = sessionsQuery();
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = sessionsQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// sessionQuery
// ---------------------------------------------------------------------------

describe('sessionQuery', () => {
  it('returns queryOptions with session queryKey including id', () => {
    const options = sessionQuery('session-123');
    expect(options.queryKey).toEqual(queryKeys.session('session-123'));
  });

  it('uses different key for different ids', () => {
    const options1 = sessionQuery('session-1');
    const options2 = sessionQuery('session-2');
    expect(options1.queryKey).not.toEqual(options2.queryKey);
  });

  it('has enabled property based on id', () => {
    const optionsWithId = sessionQuery('session-123');
    expect(optionsWithId.enabled).toBe(true);

    const optionsWithoutId = sessionQuery('');
    expect(optionsWithoutId.enabled).toBe(false);
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = sessionQuery('session-123');
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has a custom refetchInterval of 5000ms', () => {
    const options = sessionQuery('session-123');
    expect(options.refetchInterval).toBe(5_000);
  });

  it('has queryFn property', () => {
    const options = sessionQuery('session-123');
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// runtimeSessionsQuery
// ---------------------------------------------------------------------------

describe('runtimeSessionsQuery', () => {
  it('returns queryOptions with runtimeSessions queryKey without params', () => {
    const options = runtimeSessionsQuery();
    expect(options.queryKey).toEqual(queryKeys.runtimeSessions());
  });

  it('includes params in queryKey when provided', () => {
    const params = { runtime: 'codex', status: 'active' } as const;
    const options = runtimeSessionsQuery(params);
    expect(options.queryKey).toEqual(queryKeys.runtimeSessions(params));
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = runtimeSessionsQuery();
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = runtimeSessionsQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// runtimeSessionHandoffsQuery
// ---------------------------------------------------------------------------

describe('runtimeSessionHandoffsQuery', () => {
  it('returns queryOptions with runtimeSessionHandoffs queryKey', () => {
    const options = runtimeSessionHandoffsQuery('ms-123');
    expect(options.queryKey).toEqual(queryKeys.runtimeSessionHandoffs('ms-123'));
  });

  it('includes limit in queryKey when provided', () => {
    const options = runtimeSessionHandoffsQuery('ms-123', 10);
    expect(options.queryKey).toEqual(queryKeys.runtimeSessionHandoffs('ms-123', 10));
  });

  it('is enabled only when id is present', () => {
    expect(runtimeSessionHandoffsQuery('ms-123').enabled).toBe(true);
    expect(runtimeSessionHandoffsQuery('').enabled).toBe(false);
  });

  it('has queryFn property', () => {
    const options = runtimeSessionHandoffsQuery('ms-123');
    expect(options.queryFn).toBeDefined();
  });
});

describe('runtimeSessionPreflightQuery', () => {
  it('returns queryOptions with runtimeSessionPreflight queryKey', () => {
    const options = runtimeSessionPreflightQuery('ms-123', { targetRuntime: 'claude-code' });
    expect(options.queryKey).toEqual(queryKeys.runtimeSessionPreflight('ms-123', 'claude-code'));
  });

  it('includes targetMachineId in the queryKey when present', () => {
    const options = runtimeSessionPreflightQuery('ms-123', {
      targetRuntime: 'claude-code',
      targetMachineId: 'machine-2',
    });
    expect(options.queryKey).toEqual(
      queryKeys.runtimeSessionPreflight('ms-123', 'claude-code', 'machine-2'),
    );
  });

  it('has enabled property based on id', () => {
    expect(runtimeSessionPreflightQuery('ms-123', { targetRuntime: 'claude-code' }).enabled).toBe(
      true,
    );
    expect(runtimeSessionPreflightQuery('', { targetRuntime: 'claude-code' }).enabled).toBe(false);
  });

  it('has queryFn property', () => {
    expect(
      runtimeSessionPreflightQuery('ms-123', { targetRuntime: 'claude-code' }).queryFn,
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// sessionContentQuery
// ---------------------------------------------------------------------------

describe('sessionContentQuery', () => {
  it('returns queryOptions with sessionContent queryKey including sessionId and params', () => {
    const params = { machineId: 'machine-1' };
    const options = sessionContentQuery('session-123', params);
    expect(options.queryKey).toEqual(queryKeys.sessionContent('session-123', params));
  });

  it('includes all params in queryKey', () => {
    const params = { machineId: 'machine-1', projectPath: '/home/user/project', limit: 50 };
    const options = sessionContentQuery('session-123', params);
    expect(options.queryKey).toEqual(queryKeys.sessionContent('session-123', params));
  });

  it('uses different key for different sessionIds', () => {
    const params = { machineId: 'machine-1' };
    const options1 = sessionContentQuery('session-1', params);
    const options2 = sessionContentQuery('session-2', params);
    expect(options1.queryKey).not.toEqual(options2.queryKey);
  });

  it('uses different key for different params', () => {
    const params1 = { machineId: 'machine-1' };
    const params2 = { machineId: 'machine-2' };
    const options1 = sessionContentQuery('session-123', params1);
    const options2 = sessionContentQuery('session-123', params2);
    expect(options1.queryKey).not.toEqual(options2.queryKey);
  });

  it('has enabled property based on sessionId and machineId', () => {
    const params = { machineId: 'machine-1' };
    const optionsEnabled = sessionContentQuery('session-123', params);
    expect(optionsEnabled.enabled).toBe(true);

    const optionsNoSessionId = sessionContentQuery('', params);
    expect(optionsNoSessionId.enabled).toBe(false);

    const optionsNoMachineId = sessionContentQuery('session-123', { machineId: '' });
    expect(optionsNoMachineId.enabled).toBe(false);
  });

  it('has queryFn property', () => {
    const params = { machineId: 'machine-1' };
    const options = sessionContentQuery('session-123', params);
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// discoverQuery
// ---------------------------------------------------------------------------

describe('discoverQuery', () => {
  it('returns queryOptions with discover queryKey', () => {
    const options = discoverQuery();
    expect(options.queryKey).toEqual(queryKeys.discover);
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = discoverQuery();
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = discoverQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// metricsQuery
// ---------------------------------------------------------------------------

describe('metricsQuery', () => {
  it('returns queryOptions with metrics queryKey', () => {
    const options = metricsQuery();
    expect(options.queryKey).toEqual(queryKeys.metrics);
  });

  it('has refetchOnWindowFocus enabled', () => {
    const options = metricsQuery();
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('has queryFn property', () => {
    const options = metricsQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// accountsQuery
// ---------------------------------------------------------------------------

describe('accountsQuery', () => {
  it('returns queryOptions with accounts queryKey', () => {
    const options = accountsQuery();
    expect(options.queryKey).toEqual(queryKeys.accounts);
  });

  it('has queryFn property', () => {
    const options = accountsQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// accountDefaultsQuery
// ---------------------------------------------------------------------------

describe('accountDefaultsQuery', () => {
  it('returns queryOptions with accountDefaults queryKey', () => {
    const options = accountDefaultsQuery();
    expect(options.queryKey).toEqual(queryKeys.accountDefaults);
  });

  it('has queryFn property', () => {
    const options = accountDefaultsQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// projectAccountsQuery
// ---------------------------------------------------------------------------

describe('projectAccountsQuery', () => {
  it('returns queryOptions with projectAccounts queryKey', () => {
    const options = projectAccountsQuery();
    expect(options.queryKey).toEqual(queryKeys.projectAccounts);
  });

  it('has queryFn property', () => {
    const options = projectAccountsQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// routerModelsQuery
// ---------------------------------------------------------------------------

describe('routerModelsQuery', () => {
  it('returns queryOptions with routerModels queryKey', () => {
    const options = routerModelsQuery();
    expect(options.queryKey).toEqual(queryKeys.routerModels);
  });

  it('has a staleTime of 30000ms', () => {
    const options = routerModelsQuery();
    expect(options.staleTime).toBe(30_000);
  });

  it('has queryFn property', () => {
    const options = routerModelsQuery();
    expect(options.queryFn).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// routerModelsInfoQuery
// ---------------------------------------------------------------------------

describe('routerModelsInfoQuery', () => {
  it('returns queryOptions with routerModelsInfo queryKey', () => {
    const options = routerModelsInfoQuery();
    expect(options.queryKey).toEqual(queryKeys.routerModelsInfo);
  });

  it('has a staleTime of 30000ms', () => {
    const options = routerModelsInfoQuery();
    expect(options.staleTime).toBe(30_000);
  });

  it('has queryFn property', () => {
    const options = routerModelsInfoQuery();
    expect(options.queryFn).toBeDefined();
  });
});
