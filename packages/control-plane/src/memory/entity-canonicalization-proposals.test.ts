import { describe, expect, it } from 'vitest';

import {
  buildEntityCanonicalizationProposalReport,
  type EntityCanonicalizationProposalCandidate,
} from './entity-canonicalization-proposals.js';

describe('entity canonicalization proposals', () => {
  it('classifies resolved, ambiguous, and unresolved candidates without mutating source facts', () => {
    const candidates: EntityCanonicalizationProposalCandidate[] = [
      {
        factId: 'fact-1',
        scope: 'project:agentctl',
        entityType: 'person',
        entityName: ' John Smith ',
        content: 'John Smith approved the rollout.',
        source: {
          sessionId: 'session-1',
          turnIndex: 4,
        },
      },
      {
        factId: 'fact-2',
        scope: 'project:agentctl',
        entityType: 'person',
        entityName: 'Smith',
        content: 'Follow up with Smith before release.',
      },
      {
        factId: 'fact-3',
        scope: 'project:agentctl',
        entityType: 'person',
        entityName: 'Jones',
        content: 'Jones asked for a second pass.',
      },
      {
        factId: 'fact-4',
        scope: 'project:agentctl',
        entityType: 'concept',
        entityName: 'Project Zephyr',
        content: 'Project Zephyr remains untracked.',
      },
    ];

    const report = buildEntityCanonicalizationProposalReport({
      candidates,
      aliases: [
        {
          id: 'alias-1',
          canonicalId: 'person-1',
          entityType: 'person',
          canonicalName: 'John Smith',
          normalizedCanonicalName: 'john smith',
          alias: 'John Smith',
          normalizedAlias: 'john smith',
          sourceJson: {},
          createdAt: '2026-04-25T00:00:00.000Z',
        },
        {
          id: 'alias-2',
          canonicalId: 'person-1',
          entityType: 'person',
          canonicalName: 'John Smith',
          normalizedCanonicalName: 'john smith',
          alias: 'J. Smith',
          normalizedAlias: 'j. smith',
          sourceJson: {},
          createdAt: '2026-04-25T00:00:00.000Z',
        },
        {
          id: 'alias-3',
          canonicalId: 'person-2',
          entityType: 'person',
          canonicalName: 'Tom Jones',
          normalizedCanonicalName: 'tom jones',
          alias: 'Tom Jones',
          normalizedAlias: 'tom jones',
          sourceJson: {},
          createdAt: '2026-04-25T00:00:00.000Z',
        },
        {
          id: 'alias-4',
          canonicalId: 'person-3',
          entityType: 'person',
          canonicalName: 'Alice Jones',
          normalizedCanonicalName: 'alice jones',
          alias: 'Alice Jones',
          normalizedAlias: 'alice jones',
          sourceJson: {},
          createdAt: '2026-04-25T00:00:00.000Z',
        },
      ],
    });

    expect(report.dryRun).toBe(true);
    expect(report.summary).toEqual({
      candidates: 4,
      resolved: 2,
      ambiguous: 1,
      unresolved: 1,
      proposedAliases: 1,
      exactMatches: 1,
      skippedSourceMutations: 4,
    });
    expect(report.proposals).toEqual([
      expect.objectContaining({
        factId: 'fact-1',
        entityType: 'person',
        entityName: 'John Smith',
        normalizedEntityName: 'john smith',
        status: 'resolved',
        resolutionReason: 'person_exact',
        proposalAction: 'none',
        canonicalId: 'person-1',
        canonicalName: 'John Smith',
        proposedAlias: null,
        aliasAlreadyExists: true,
        matchedCanonicalIds: ['person-1'],
        matchedCanonicalNames: ['John Smith'],
        reviewSource: expect.objectContaining({
          scope: 'project:agentctl',
          sessionId: 'session-1',
          turnIndex: 4,
        }),
      }),
      expect.objectContaining({
        factId: 'fact-2',
        entityType: 'person',
        entityName: 'Smith',
        normalizedEntityName: 'smith',
        status: 'resolved',
        resolutionReason: 'person_last_name',
        proposalAction: 'review_alias',
        canonicalId: 'person-1',
        canonicalName: 'John Smith',
        proposedAlias: 'Smith',
        aliasAlreadyExists: false,
        matchedCanonicalIds: ['person-1'],
        matchedCanonicalNames: ['John Smith'],
      }),
      expect.objectContaining({
        factId: 'fact-3',
        entityType: 'person',
        entityName: 'Jones',
        normalizedEntityName: 'jones',
        status: 'ambiguous',
        resolutionReason: 'ambiguous_person_last_name',
        proposalAction: 'review_match',
        canonicalId: null,
        canonicalName: null,
        proposedAlias: null,
        matchedCanonicalIds: ['person-2', 'person-3'],
        matchedCanonicalNames: ['Alice Jones', 'Tom Jones'],
      }),
      expect.objectContaining({
        factId: 'fact-4',
        entityType: 'concept',
        entityName: 'Project Zephyr',
        normalizedEntityName: 'project zephyr',
        status: 'unresolved',
        resolutionReason: 'unresolved',
        proposalAction: 'review_entity',
        canonicalId: null,
        canonicalName: null,
        proposedAlias: null,
        matchedCanonicalIds: [],
        matchedCanonicalNames: [],
      }),
    ]);
  });

  it('sanitizes and bounds review previews so raw secret-like values do not leak into dry-run output', () => {
    const rawSecret = 'sk-proj-super-secret-token-1234567890';
    const report = buildEntityCanonicalizationProposalReport({
      candidates: [
        {
          factId: 'fact-secret',
          scope: 'project:agentctl',
          entityType: 'concept',
          entityName: 'Credential Leak',
          content: `OPENAI_API_KEY=${rawSecret}\n${'A'.repeat(300)}`,
        },
      ],
      aliases: [],
      previewCharLimit: 80,
    });

    expect(report.proposals).toHaveLength(1);
    expect(report.proposals[0]).toEqual(
      expect.objectContaining({
        factId: 'fact-secret',
        status: 'unresolved',
        contentPreview: expect.stringContaining('[REDACTED]'),
      }),
    );
    expect(report.proposals[0]?.contentPreview).not.toContain(rawSecret);
    expect(report.proposals[0]?.contentPreview.length).toBeLessThanOrEqual(80);
  });
});
