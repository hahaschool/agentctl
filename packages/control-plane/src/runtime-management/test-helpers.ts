import { vi } from 'vitest';

export type MockDb = {
  insert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

export function createMockDb(terminalValue: unknown = []): MockDb {
  const mock: MockDb = {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    values: vi.fn(),
    set: vi.fn(),
    returning: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };

  for (const key of Object.keys(mock) as (keyof MockDb)[]) {
    mock[key].mockReturnValue(mock);
  }

  mock.returning.mockResolvedValue(terminalValue);
  mock.limit.mockResolvedValue(terminalValue);

  // biome-ignore lint/suspicious/noThenProperty: drizzle query builders are thenable
  (mock as Record<string, unknown>).then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(terminalValue).then(resolve, reject);

  return mock;
}
