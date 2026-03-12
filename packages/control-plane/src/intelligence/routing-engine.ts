import type {
  AgentInstance,
  AgentProfile,
  AggregateStats,
  RoutingCandidate,
  RoutingRequest,
  RoutingScoreBreakdown,
  WorkerNode,
} from '@agentctl/shared';

// ── Default Weights ─────────────────────────────────────────
// Capability match is a hard filter (not scored).
// These weights sum to 1.0.

const DEFAULT_LOAD_WEIGHT = 0.25;
const DEFAULT_COST_WEIGHT = 0.2;
const DEFAULT_SUCCESS_RATE_WEIGHT = 0.35;
const DEFAULT_DURATION_WEIGHT = 0.2;

export type RoutingWeights = {
  readonly load: number;
  readonly cost: number;
  readonly successRate: number;
  readonly duration: number;
};

/**
 * Read weights from environment variables, falling back to defaults.
 */
export function loadWeightsFromEnv(): RoutingWeights {
  return {
    load: parseFloat(process.env.ROUTING_LOAD_WEIGHT ?? '') || DEFAULT_LOAD_WEIGHT,
    cost: parseFloat(process.env.ROUTING_COST_WEIGHT ?? '') || DEFAULT_COST_WEIGHT,
    successRate:
      parseFloat(process.env.ROUTING_SUCCESS_RATE_WEIGHT ?? '') || DEFAULT_SUCCESS_RATE_WEIGHT,
    duration: parseFloat(process.env.ROUTING_DURATION_WEIGHT ?? '') || DEFAULT_DURATION_WEIGHT,
  };
}

/**
 * Per-profile historical stats map.
 * Key: profileId, Value: aggregate stats for matching capabilities.
 */
export type StatsMap = ReadonlyMap<string, AggregateStats>;

// ── Engine ──────────────────────────────────────────────────

export class RoutingEngine {
  constructor(private readonly weights: RoutingWeights = loadWeightsFromEnv()) {}

  /**
   * Rank (profile, node) candidates for a task.
   *
   * 1. Hard-filter: profile must have all required capabilities.
   * 2. Hard-filter: node must have all machine requirements (if specified).
   * 3. Hard-filter: node must be online and have capacity.
   * 4. Score surviving candidates.
   * 5. Return top-N ordered by score descending.
   */
  rankCandidates(
    request: RoutingRequest,
    profiles: readonly AgentProfile[],
    nodes: readonly WorkerNode[],
    instances: readonly AgentInstance[],
    stats: StatsMap,
  ): RoutingCandidate[] {
    const requiredCaps = new Set(request.requiredCapabilities);
    const machineReqs = new Set(request.machineRequirements ?? []);

    // Build a map of running instances per node for capacity check
    const instancesPerNode = new Map<string, number>();
    for (const inst of instances) {
      if (inst.status === 'running' && inst.machineId) {
        instancesPerNode.set(inst.machineId, (instancesPerNode.get(inst.machineId) ?? 0) + 1);
      }
    }

    // Filter profiles: must have all required capabilities
    const eligibleProfiles = profiles.filter((profile) => {
      const profileCaps = new Set(profile.capabilities);
      for (const cap of requiredCaps) {
        if (!profileCaps.has(cap)) {
          return false;
        }
      }
      return true;
    });

    // Filter nodes: must be online, have capacity, and meet machine requirements
    const eligibleNodes = nodes.filter((node) => {
      if (node.status !== 'online') {
        return false;
      }

      const running = instancesPerNode.get(node.id) ?? 0;
      if (running >= node.maxConcurrentAgents) {
        return false;
      }

      if (machineReqs.size > 0) {
        const nodeCaps = new Set(node.capabilities);
        for (const req of machineReqs) {
          if (!nodeCaps.has(req)) {
            return false;
          }
        }
      }

      return true;
    });

    // Compute max cost across eligible profiles for normalization
    const maxCost = Math.max(
      ...eligibleProfiles.map((p) => p.maxCostPerHour ?? 0),
      0.01, // prevent division by zero
    );

    // Compute max duration across stats for normalization
    const allDurations = [...stats.values()]
      .map((s) => s.avgDurationMs)
      .filter((d): d is number => d !== null);
    const maxDuration = Math.max(...allDurations, 1); // prevent division by zero

    // Score every (profile, node) pair
    const candidates: RoutingCandidate[] = [];

    for (const profile of eligibleProfiles) {
      for (const node of eligibleNodes) {
        const breakdown = this.computeScore(
          profile,
          node,
          instancesPerNode,
          request,
          stats,
          maxCost,
          maxDuration,
        );

        candidates.push({
          profileId: profile.id,
          nodeId: node.id,
          score: breakdown.weightedTotal,
          breakdown,
        });
      }
    }

    // Sort by score descending, limit
    const limit = request.limit ?? 5;
    return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Compute the score breakdown for a single (profile, node) pair.
   */
  computeScore(
    profile: AgentProfile,
    node: WorkerNode,
    instancesPerNode: ReadonlyMap<string, number>,
    _request: RoutingRequest,
    stats: StatsMap,
    maxCost: number,
    maxDuration: number,
  ): RoutingScoreBreakdown {
    // Capability match is always 1.0 here because we pre-filtered
    const capabilityMatch = 1.0;

    // Load score: 1.0 = idle, 0.0 = fully loaded
    const running = instancesPerNode.get(node.id) ?? 0;
    const loadScore = node.maxConcurrentAgents > 0 ? 1.0 - running / node.maxConcurrentAgents : 0.0;

    // Cost score: lower cost = higher score, normalized against max
    const profileCost = profile.maxCostPerHour ?? 0;
    const costScore = maxCost > 0 ? 1.0 - profileCost / maxCost : 1.0;

    // Historical stats
    const profileStats = stats.get(profile.id);

    // Success rate score: direct use of historical success rate (0-1)
    const successRateScore = profileStats?.successRate ?? 0.5; // default to neutral

    // Duration score: lower duration = higher score
    const avgDuration = profileStats?.avgDurationMs ?? null;
    const durationScore =
      avgDuration !== null && maxDuration > 0 ? 1.0 - avgDuration / maxDuration : 0.5;

    // Weighted total
    const weightedTotal =
      this.weights.load * loadScore +
      this.weights.cost * costScore +
      this.weights.successRate * successRateScore +
      this.weights.duration * durationScore;

    return {
      capabilityMatch,
      loadScore,
      costScore,
      successRateScore,
      durationScore,
      weightedTotal,
    };
  }
}
