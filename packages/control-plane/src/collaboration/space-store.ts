import type { Space, SpaceMember } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { spaceMembers, spaces } from '../db/index.js';

type CreateSpaceInput = {
  name: string;
  description?: string;
  type: string;
  visibility?: string;
  createdBy: string;
};

type AddMemberInput = {
  memberType: string;
  memberId: string;
  role?: string;
};

export class SpaceStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    const rows = await this.db
      .insert(spaces)
      .values({
        name: input.name,
        description: input.description ?? '',
        type: input.type,
        visibility: input.visibility ?? 'private',
        createdBy: input.createdBy,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('SPACE_CREATE_FAILED', 'Failed to insert space row', { input });
    }

    this.logger.info({ spaceId: rows[0].id, name: input.name }, 'Space created');
    return this.toSpace(rows[0]);
  }

  async getSpace(id: string): Promise<Space | undefined> {
    const rows = await this.db.select().from(spaces).where(eq(spaces.id, id));

    if (rows.length === 0) {
      return undefined;
    }

    return this.toSpace(rows[0]);
  }

  async listSpaces(): Promise<Space[]> {
    const rows = await this.db.select().from(spaces);
    return rows.map((row) => this.toSpace(row));
  }

  async deleteSpace(id: string): Promise<void> {
    const result = await this.db
      .delete(spaces)
      .where(eq(spaces.id, id))
      .returning({ id: spaces.id });

    if (result.length === 0) {
      throw new ControlPlaneError('SPACE_NOT_FOUND', `Space '${id}' does not exist`, { id });
    }

    this.logger.info({ spaceId: id }, 'Space deleted');
  }

  async addMember(spaceId: string, input: AddMemberInput): Promise<SpaceMember> {
    const rows = await this.db
      .insert(spaceMembers)
      .values({
        spaceId,
        memberType: input.memberType,
        memberId: input.memberId,
        role: input.role ?? 'member',
      })
      .onConflictDoUpdate({
        target: [spaceMembers.spaceId, spaceMembers.memberType, spaceMembers.memberId],
        set: { role: input.role ?? 'member' },
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('MEMBER_ADD_FAILED', 'Failed to add member', {
        spaceId,
        input,
      });
    }

    this.logger.info(
      { spaceId, memberType: input.memberType, memberId: input.memberId },
      'Member added to space',
    );
    return this.toMember(rows[0]);
  }

  async removeMember(spaceId: string, memberType: string, memberId: string): Promise<void> {
    const result = await this.db
      .delete(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.memberType, memberType),
          eq(spaceMembers.memberId, memberId),
        ),
      )
      .returning({ spaceId: spaceMembers.spaceId });

    if (result.length === 0) {
      throw new ControlPlaneError(
        'MEMBER_NOT_FOUND',
        `Member '${memberId}' not found in space '${spaceId}'`,
        { spaceId, memberType, memberId },
      );
    }

    this.logger.info({ spaceId, memberType, memberId }, 'Member removed from space');
  }

  async getMembers(spaceId: string): Promise<SpaceMember[]> {
    const rows = await this.db.select().from(spaceMembers).where(eq(spaceMembers.spaceId, spaceId));

    return rows.map((row) => this.toMember(row));
  }

  private toSpace(row: typeof spaces.$inferSelect): Space {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      type: row.type as Space['type'],
      visibility: (row.visibility ?? 'private') as Space['visibility'],
      createdBy: row.createdBy,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }

  private toMember(row: typeof spaceMembers.$inferSelect): SpaceMember {
    return {
      spaceId: row.spaceId,
      memberType: row.memberType as SpaceMember['memberType'],
      memberId: row.memberId,
      role: (row.role ?? 'member') as SpaceMember['role'],
    };
  }
}
