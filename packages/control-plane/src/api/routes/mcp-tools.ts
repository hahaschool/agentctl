import {
  ControlPlaneError,
  type CrossSpaceQueryResponse,
  isSpaceEventType,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { EventStore } from '../../collaboration/event-store.js';
import type { SpaceStore } from '../../collaboration/space-store.js';

// ── Constants ───────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_SPACE_IDS = 20;

// ── Options ─────────────────────────────────────────────────

export type McpToolsRoutesOptions = {
  readonly eventStore: EventStore;
  readonly spaceStore: SpaceStore;
};

// ── Route Plugin ────────────────────────────────────────────

export const mcpToolsRoutes: FastifyPluginAsync<McpToolsRoutesOptions> = async (app, opts) => {
  const { eventStore, spaceStore } = opts;

  // ---------------------------------------------------------------------------
  // POST /cross-space-query — MCP tool: cross_space_query
  //
  // Agents call this during runtime to query events across multiple spaces.
  // Returns matching SpaceEvents with space metadata, respecting visibility.
  // ---------------------------------------------------------------------------

  app.post<{
    Body: {
      spaceIds: string[];
      eventTypes?: string[];
      timeRange?: { start?: string; end?: string };
      textQuery?: string;
      limit?: number;
    };
  }>(
    '/cross-space-query',
    {
      schema: {
        tags: ['mcp-tools'],
        summary: 'Cross-space event query (MCP tool: cross_space_query)',
      },
    },
    async (request, reply) => {
      const { spaceIds, eventTypes, timeRange, textQuery, limit } = request.body;

      // ── Input validation ────────────────────────────────────

      if (!Array.isArray(spaceIds) || spaceIds.length === 0) {
        return reply.code(400).send({
          error: 'INVALID_SPACE_IDS',
          message: 'spaceIds must be a non-empty array of space IDs',
        });
      }

      if (spaceIds.length > MAX_SPACE_IDS) {
        return reply.code(400).send({
          error: 'TOO_MANY_SPACE_IDS',
          message: `spaceIds must contain at most ${MAX_SPACE_IDS} entries`,
        });
      }

      for (const id of spaceIds) {
        if (typeof id !== 'string' || id.trim().length === 0) {
          return reply.code(400).send({
            error: 'INVALID_SPACE_ID',
            message: 'Each spaceId must be a non-empty string',
          });
        }
      }

      if (eventTypes !== undefined) {
        if (!Array.isArray(eventTypes)) {
          return reply.code(400).send({
            error: 'INVALID_EVENT_TYPES',
            message: 'eventTypes must be an array of event type strings',
          });
        }
        for (const et of eventTypes) {
          if (!isSpaceEventType(et)) {
            return reply.code(400).send({
              error: 'INVALID_EVENT_TYPE',
              message: `Unknown event type: '${et}'`,
            });
          }
        }
      }

      if (timeRange !== undefined) {
        if (typeof timeRange !== 'object' || timeRange === null) {
          return reply.code(400).send({
            error: 'INVALID_TIME_RANGE',
            message: 'timeRange must be an object with optional start/end ISO strings',
          });
        }
        if (timeRange.start !== undefined && Number.isNaN(Date.parse(timeRange.start))) {
          return reply.code(400).send({
            error: 'INVALID_TIME_RANGE_START',
            message: 'timeRange.start must be a valid ISO 8601 date string',
          });
        }
        if (timeRange.end !== undefined && Number.isNaN(Date.parse(timeRange.end))) {
          return reply.code(400).send({
            error: 'INVALID_TIME_RANGE_END',
            message: 'timeRange.end must be a valid ISO 8601 date string',
          });
        }
      }

      if (textQuery !== undefined && typeof textQuery !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_TEXT_QUERY',
          message: 'textQuery must be a string',
        });
      }

      if (limit !== undefined) {
        if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
          return reply.code(400).send({
            error: 'INVALID_LIMIT',
            message: `limit must be a positive integer (max ${MAX_LIMIT})`,
          });
        }
      }

      // ── Validate that all requested spaces exist ────────────

      const missingSpaces: string[] = [];
      for (const id of spaceIds) {
        const space = await spaceStore.getSpace(id);
        if (!space) {
          missingSpaces.push(id);
        }
      }

      if (missingSpaces.length > 0) {
        return reply.code(404).send({
          error: 'SPACES_NOT_FOUND',
          message: `The following spaces were not found: ${missingSpaces.join(', ')}`,
        });
      }

      // ── Execute query ───────────────────────────────────────

      try {
        const clampedLimit = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

        const result = await eventStore.queryAcrossSpaces({
          spaceIds,
          eventTypes,
          timeRange,
          textQuery,
          limit: clampedLimit,
        });

        const response: CrossSpaceQueryResponse = {
          events: result.events,
          totalMatched: result.totalMatched,
          truncated: result.totalMatched > clampedLimit,
        };

        return response;
      } catch (err) {
        if (err instanceof ControlPlaneError) {
          throw err;
        }
        throw new ControlPlaneError(
          'CROSS_SPACE_QUERY_FAILED',
          'An error occurred while querying across spaces',
          { spaceIds, error: err instanceof Error ? err.message : String(err) },
        );
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /tools — List available MCP tools (discovery endpoint)
  // ---------------------------------------------------------------------------

  app.get(
    '/tools',
    {
      schema: {
        tags: ['mcp-tools'],
        summary: 'List available MCP tools for agent runtime use',
      },
    },
    async () => {
      return {
        tools: [
          {
            name: 'cross_space_query',
            description:
              'Query events and context across multiple Spaces. ' +
              'Returns matching SpaceEvents in chronological order with space metadata.',
            inputSchema: {
              type: 'object',
              properties: {
                spaceIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'IDs of spaces to query',
                  minItems: 1,
                  maxItems: MAX_SPACE_IDS,
                },
                eventTypes: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Filter by event types (message, artifact, control, task-state, approval)',
                },
                timeRange: {
                  type: 'object',
                  properties: {
                    start: {
                      type: 'string',
                      format: 'date-time',
                      description: 'ISO 8601 start (inclusive)',
                    },
                    end: {
                      type: 'string',
                      format: 'date-time',
                      description: 'ISO 8601 end (inclusive)',
                    },
                  },
                  description: 'Optional time range filter',
                },
                textQuery: {
                  type: 'string',
                  description: 'Full-text search within event payloads',
                },
                limit: {
                  type: 'integer',
                  minimum: 1,
                  maximum: MAX_LIMIT,
                  default: DEFAULT_LIMIT,
                  description: 'Maximum number of events to return',
                },
              },
              required: ['spaceIds'],
            },
          },
        ],
      };
    },
  );
};
