// ---------------------------------------------------------------------------
// Knowledge Synthesis — §3.6
//
// Phase 1 (lint): identifies candidate facts that need attention:
//   - near-duplicates: facts with high vector similarity (>0.85) but < 0.9
//     (those above 0.9 trigger contradiction detection instead)
//   - stale: active facts not accessed in 30+ days
//   - orphans: facts with no edges to other facts
//
// Phase 2 (synthesize): groups related facts by entity_type and proposes
//   higher-level principle candidates from those clusters.
//
// No LLM call is made — synthesis candidates are structural proposals that
// a human or separate LLM step can act on.
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';
import type { Logger } from 'pino';

export type NearDuplicateCandidate = {
  factIdA: string;
  factIdB: string;
  similarity: number;
  contentA: string;
  contentB: string;
};

export type StaleFactCandidate = {
  factId: string;
  content: string;
  lastAccessedDaysAgo: number;
};

export type OrphanFactCandidate = {
  factId: string;
  content: string;
  entityType: string;
  createdAt: string;
};

export type SynthesisGroup = {
  entityType: string;
  factIds: string[];
  factContents: string[];
  proposalHint: string;
  principleCandidate?: PrincipleCandidate;
};

export type SynthesisLintResult = {
  nearDuplicates: NearDuplicateCandidate[];
  staleFacts: StaleFactCandidate[];
  orphanFacts: OrphanFactCandidate[];
};

export type SynthesisResult = {
  lint: SynthesisLintResult;
  synthesisGroups: SynthesisGroup[];
};

export type PrincipleCandidateSignalBreakdown = {
  nearDuplicatePairs: number;
  staleFacts: number;
  orphanFacts: number;
};

export type PrincipleCandidate = {
  title: string;
  summary: string;
  evidenceCount: number;
  scope: string;
  confidence: number;
  actionHint: string;
  themeKeywords: string[];
  signalBreakdown: PrincipleCandidateSignalBreakdown;
};

const NEAR_DUPLICATE_MIN = 0.85;
const NEAR_DUPLICATE_MAX = 0.9;
const STALE_DAYS = 30;
const MIN_GROUP_SIZE = 3;
const MAX_THEME_KEYWORDS = 3;
const PRINCIPLE_TITLE_MAX = 72;
const THEME_STOPWORDS = new Set([
  'about',
  'always',
  'because',
  'being',
  'could',
  'every',
  'from',
  'have',
  'into',
  'just',
  'keep',
  'more',
  'must',
  'same',
  'should',
  'that',
  'their',
  'them',
  'then',
  'this',
  'with',
  'without',
]);

type PreparedSynthesisGroup = {
  entityType: string;
  factIds: string[];
  factContents: string[];
  scopes: string[];
  proposalHint: string;
};

export type KnowledgeSynthesisOptions = {
  pool: Pool;
  logger: Logger;
};

export class KnowledgeSynthesis {
  private readonly pool: Pool;
  private readonly logger: Logger;

  constructor(options: KnowledgeSynthesisOptions) {
    this.pool = options.pool;
    this.logger = options.logger;
  }

  async runSynthesis(scope?: string): Promise<SynthesisResult> {
    const [lint, preparedGroups] = await Promise.all([
      this.runLint(scope),
      this.buildSynthesisGroups(scope),
    ]);
    const synthesisGroups = preparedGroups.map((group) =>
      this.createSynthesisGroup(group, lint, scope),
    );

    this.logger.info(
      {
        nearDuplicates: lint.nearDuplicates.length,
        staleFacts: lint.staleFacts.length,
        orphanFacts: lint.orphanFacts.length,
        synthesisGroups: synthesisGroups.length,
      },
      'Knowledge synthesis complete',
    );

    return { lint, synthesisGroups };
  }

  private async runLint(scope?: string): Promise<SynthesisLintResult> {
    const [nearDuplicates, staleFacts, orphanFacts] = await Promise.all([
      this.findNearDuplicates(scope),
      this.findStaleFacts(scope),
      this.findOrphanFacts(scope),
    ]);

    return { nearDuplicates, staleFacts, orphanFacts };
  }

  private async findNearDuplicates(scope?: string): Promise<NearDuplicateCandidate[]> {
    // Self-join on embedding similarity: find pairs in the near-duplicate band
    // Uses pgvector <=> operator (cosine distance); similarity = 1 - distance
    const scopeClause = scope ? `AND a.scope = $3 AND b.scope = $3` : '';
    const params: unknown[] = [1 - NEAR_DUPLICATE_MIN, 1 - NEAR_DUPLICATE_MAX];
    if (scope) {
      params.push(scope);
    }

    const { rows } = await this.pool.query(
      `SELECT
         a.id AS fact_id_a,
         b.id AS fact_id_b,
         1 - (a.embedding <=> b.embedding) AS similarity,
         a.content AS content_a,
         b.content AS content_b
       FROM memory_facts a
       JOIN memory_facts b ON b.id > a.id
       WHERE a.valid_until IS NULL
         AND b.valid_until IS NULL
         AND a.embedding IS NOT NULL
         AND b.embedding IS NOT NULL
         AND (a.embedding <=> b.embedding) <= $1
         AND (a.embedding <=> b.embedding) > $2
         ${scopeClause}
       LIMIT 50`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => ({
      factIdA: String(row.fact_id_a),
      factIdB: String(row.fact_id_b),
      similarity: Number(row.similarity),
      contentA: String(row.content_a),
      contentB: String(row.content_b),
    }));
  }

  private async findStaleFacts(scope?: string): Promise<StaleFactCandidate[]> {
    const scopeClause = scope ? 'AND scope = $1' : '';
    const params: unknown[] = scope ? [scope] : [];

    const { rows } = await this.pool.query(
      `SELECT
         id AS fact_id,
         content,
         EXTRACT(EPOCH FROM (now() - accessed_at)) / 86400 AS days_since_access
       FROM memory_facts
       WHERE valid_until IS NULL
         AND accessed_at < now() - interval '${STALE_DAYS} days'
         AND strength > 0.05
         ${scopeClause}
       ORDER BY accessed_at ASC
       LIMIT 100`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => ({
      factId: String(row.fact_id),
      content: String(row.content),
      lastAccessedDaysAgo: Math.round(Number(row.days_since_access)),
    }));
  }

  private async findOrphanFacts(scope?: string): Promise<OrphanFactCandidate[]> {
    const scopeClause = scope ? 'AND f.scope = $1' : '';
    const params: unknown[] = scope ? [scope] : [];

    const { rows } = await this.pool.query(
      `SELECT
         f.id AS fact_id,
         f.content,
         f.entity_type,
         f.created_at
       FROM memory_facts f
       WHERE f.valid_until IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM memory_edges e
           WHERE e.source_fact_id = f.id OR e.target_fact_id = f.id
         )
         ${scopeClause}
       ORDER BY f.created_at ASC
       LIMIT 100`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => ({
      factId: String(row.fact_id),
      content: String(row.content),
      entityType: String(row.entity_type),
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  }

  private async buildSynthesisGroups(scope?: string): Promise<PreparedSynthesisGroup[]> {
    // Group facts by entity_type; surface clusters with >= MIN_GROUP_SIZE facts
    // as synthesis candidates (potential higher-level principles)
    const scopeClause = scope ? 'AND scope = $1' : '';
    const params: unknown[] = scope ? [scope] : [];

    const { rows } = await this.pool.query(
      `SELECT
         entity_type,
         array_agg(id ORDER BY created_at DESC) AS fact_ids,
         array_agg(content ORDER BY created_at DESC) AS fact_contents,
         array_agg(scope ORDER BY created_at DESC) AS scopes,
         COUNT(*)::int AS fact_count
       FROM memory_facts
       WHERE valid_until IS NULL
         ${scopeClause}
       GROUP BY entity_type
       HAVING COUNT(*) >= ${MIN_GROUP_SIZE}
       ORDER BY fact_count DESC`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => {
      const entityType = String(row.entity_type);
      const factIds = Array.isArray(row.fact_ids) ? (row.fact_ids as unknown[]).map(String) : [];
      const factContents = Array.isArray(row.fact_contents)
        ? (row.fact_contents as unknown[]).map(String)
        : [];
      const scopes = Array.isArray(row.scopes) ? (row.scopes as unknown[]).map(String) : [];

      return {
        entityType,
        factIds: factIds.slice(0, 20),
        factContents: factContents.slice(0, 20),
        scopes: scopes.slice(0, 20),
        proposalHint: `Consider synthesising ${factIds.length} ${entityType} facts into a higher-level principle`,
      };
    });
  }

  private createSynthesisGroup(
    group: PreparedSynthesisGroup,
    lint: SynthesisLintResult,
    requestedScope?: string,
  ): SynthesisGroup {
    const signalBreakdown = this.buildSignalBreakdown(group, lint);
    const themeKeywords = extractThemeKeywords(group.factContents);
    const evidenceCount = group.factIds.length;

    return {
      entityType: group.entityType,
      factIds: group.factIds,
      factContents: group.factContents,
      proposalHint: group.proposalHint,
      principleCandidate: {
        title: cleanPrincipleTitle(group.factContents[0] ?? '', group.entityType),
        summary: buildPrincipleSummary(
          group.entityType,
          evidenceCount,
          themeKeywords,
          signalBreakdown,
        ),
        evidenceCount,
        scope: resolveCandidateScope(group.scopes, requestedScope),
        confidence: calculateCandidateConfidence(evidenceCount, signalBreakdown, themeKeywords),
        actionHint: `Draft one reviewed principle for this ${humanizeEntityType(group.entityType)} cluster, then link the strongest evidence facts under it.`,
        themeKeywords,
        signalBreakdown,
      },
    };
  }

  private buildSignalBreakdown(
    group: PreparedSynthesisGroup,
    lint: SynthesisLintResult,
  ): PrincipleCandidateSignalBreakdown {
    const factIds = new Set(group.factIds);
    return {
      nearDuplicatePairs: lint.nearDuplicates.filter(
        (pair) => factIds.has(pair.factIdA) && factIds.has(pair.factIdB),
      ).length,
      staleFacts: lint.staleFacts.filter((fact) => factIds.has(fact.factId)).length,
      orphanFacts: lint.orphanFacts.filter((fact) => factIds.has(fact.factId)).length,
    };
  }
}

function humanizeEntityType(entityType: string): string {
  return entityType.replace(/[_-]+/g, ' ').trim() || 'memory';
}

function cleanPrincipleTitle(content: string, entityType: string): string {
  const normalized = content
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[*-]\s*/, '');
  const withoutTrailingPunctuation = normalized.replace(/[.,;:!?]+$/g, '');
  if (!withoutTrailingPunctuation) {
    return `Recurring ${humanizeEntityType(entityType)} principle`;
  }
  if (withoutTrailingPunctuation.length <= PRINCIPLE_TITLE_MAX) {
    return withoutTrailingPunctuation;
  }

  const candidate = withoutTrailingPunctuation.slice(0, PRINCIPLE_TITLE_MAX + 1);
  const lastSpace = candidate.lastIndexOf(' ');
  if (lastSpace >= Math.floor(PRINCIPLE_TITLE_MAX * 0.6)) {
    return `${candidate.slice(0, lastSpace).trimEnd()}...`;
  }
  return `${withoutTrailingPunctuation.slice(0, PRINCIPLE_TITLE_MAX).trimEnd()}...`;
}

function extractThemeKeywords(factContents: string[]): string[] {
  const counts = new Map<string, { count: number; firstSeen: number }>();

  factContents.forEach((content, contentIndex) => {
    const tokens = new Set(
      (content.toLowerCase().match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) ?? []).filter(
        (token) => token.length >= 4 && !THEME_STOPWORDS.has(token) && !/^\d+$/.test(token),
      ),
    );

    for (const token of tokens) {
      const existing = counts.get(token);
      if (existing) {
        existing.count += 1;
        continue;
      }
      counts.set(token, { count: 1, firstSeen: contentIndex });
    }
  });

  const ranked = Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      if (a[1].firstSeen !== b[1].firstSeen) return a[1].firstSeen - b[1].firstSeen;
      return a[0].localeCompare(b[0]);
    })
    .map(([token, stats]) => ({ token, ...stats }));

  const recurring = ranked.filter((entry) => entry.count > 1);
  const selected = recurring.length > 0 ? recurring : ranked;
  return selected.slice(0, MAX_THEME_KEYWORDS).map((entry) => entry.token);
}

function buildPrincipleSummary(
  entityType: string,
  evidenceCount: number,
  themeKeywords: string[],
  signalBreakdown: PrincipleCandidateSignalBreakdown,
): string {
  const entityLabel = humanizeEntityType(entityType);
  const factLabel = `${evidenceCount} ${entityLabel} fact${evidenceCount === 1 ? '' : 's'}`;
  const themeSentence =
    themeKeywords.length > 0
      ? `Recurring themes: ${themeKeywords.join(', ')}.`
      : 'Recurring themes: repeated phrasing and intent.';

  const signalParts: string[] = [];
  if (signalBreakdown.nearDuplicatePairs > 0) {
    signalParts.push(
      `${signalBreakdown.nearDuplicatePairs} near-duplicate pair${signalBreakdown.nearDuplicatePairs === 1 ? '' : 's'}`,
    );
  }
  if (signalBreakdown.staleFacts > 0) {
    signalParts.push(
      `${signalBreakdown.staleFacts} stale fact${signalBreakdown.staleFacts === 1 ? '' : 's'}`,
    );
  }
  if (signalBreakdown.orphanFacts > 0) {
    signalParts.push(
      `${signalBreakdown.orphanFacts} orphan fact${signalBreakdown.orphanFacts === 1 ? '' : 's'}`,
    );
  }

  const signalSentence =
    signalParts.length > 0
      ? `Signals: ${signalParts.join(', ')}.`
      : 'Signals: entity-type cluster only.';

  return `${factLabel} ${evidenceCount === 1 ? 'suggests' : 'suggest'} the same operating principle. ${themeSentence} ${signalSentence}`;
}

function resolveCandidateScope(scopes: string[], requestedScope?: string): string {
  if (requestedScope) {
    return requestedScope;
  }

  const uniqueScopes = Array.from(new Set(scopes.filter(Boolean)));
  if (uniqueScopes.length === 1) {
    return uniqueScopes[0] ?? 'unknown';
  }
  if (uniqueScopes.length > 1) {
    return 'cross-scope';
  }
  return 'unknown';
}

function calculateCandidateConfidence(
  evidenceCount: number,
  signalBreakdown: PrincipleCandidateSignalBreakdown,
  themeKeywords: string[],
): number {
  let confidence = 0.55;
  confidence += Math.min(0.2, Math.max(0, evidenceCount - MIN_GROUP_SIZE) * 0.05);
  confidence += Math.min(0.1, signalBreakdown.nearDuplicatePairs * 0.05);
  confidence += themeKeywords.length >= 2 ? 0.08 : themeKeywords.length === 1 ? 0.04 : 0;
  return Number(Math.min(0.95, confidence).toFixed(2));
}
