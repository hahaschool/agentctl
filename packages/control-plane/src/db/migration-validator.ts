// ---------------------------------------------------------------------------
// Migration Validator — static analysis of SQL migration files
// ---------------------------------------------------------------------------

export type MigrationError = {
  line: number;
  message: string;
  severity: 'error';
};

export type MigrationWarning = {
  line: number;
  message: string;
  severity: 'warning';
};

export type MigrationValidationResult = {
  valid: boolean;
  errors: MigrationError[];
  warnings: MigrationWarning[];
  summary: {
    tablesCreated: string[];
    tablesAltered: string[];
    columnsAdded: string[];
    columnsDropped: string[];
    indexesCreated: string[];
    hasDestructiveChanges: boolean;
  };
};

// ---------------------------------------------------------------------------
// Patterns — case-insensitive regex for SQL statement detection
// ---------------------------------------------------------------------------

/** DROP TABLE without IF EXISTS. */
const DROP_TABLE_NO_IF_EXISTS = /^\s*DROP\s+TABLE\s+(?!IF\s+EXISTS\b)/i;

/** DROP TABLE with IF EXISTS (safe). */
const DROP_TABLE_IF_EXISTS = /^\s*DROP\s+TABLE\s+IF\s+EXISTS\b/i;

/** TRUNCATE TABLE. */
const TRUNCATE_TABLE = /^\s*TRUNCATE\s+TABLE\b/i;

/** DELETE FROM without WHERE (bare DELETE). */
const DELETE_FROM = /^\s*DELETE\s+FROM\b/i;

/** WHERE clause following a DELETE. */
const WHERE_CLAUSE = /\bWHERE\b/i;

/** ALTER TABLE ... DROP COLUMN. */
const ALTER_DROP_COLUMN = /^\s*ALTER\s+TABLE\s+.+\bDROP\s+COLUMN\b/i;

/** ALTER TABLE ... ALTER COLUMN ... TYPE (type change). */
const ALTER_COLUMN_TYPE = /^\s*ALTER\s+TABLE\s+.+\bALTER\s+COLUMN\s+.+\bTYPE\b/i;

/** DROP INDEX. */
const DROP_INDEX = /^\s*DROP\s+INDEX\b/i;

/** ALTER TABLE ... DROP CONSTRAINT. */
const ALTER_DROP_CONSTRAINT = /^\s*ALTER\s+TABLE\s+.+\bDROP\s+CONSTRAINT\b/i;

/** CREATE TABLE — capture table name in quotes or bare. */
const CREATE_TABLE = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\S+))/i;

/** ALTER TABLE — capture table name. */
const ALTER_TABLE = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\S+))/i;

/** ALTER TABLE ... ADD COLUMN — capture column name. */
const ALTER_ADD_COLUMN =
  /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"[^"]+"|[^\s]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\S+))/i;

/** ALTER TABLE ... DROP COLUMN — capture column name. */
const ALTER_DROP_COLUMN_NAME =
  /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"[^"]+"|[^\s]+)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\S+))/i;

/** CREATE INDEX — capture index name. */
const CREATE_INDEX =
  /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:CONCURRENTLY\s+)?(?:"([^"]+)"|(\S+))/i;

/** BEGIN / COMMIT transaction wrapper. */
const BEGIN_TX = /^\s*BEGIN\b/i;
const COMMIT_TX = /^\s*COMMIT\b/i;

/** SQL comment metadata pattern: `-- @key value` or `-- @key: value`. */
const METADATA_COMMENT = /^--\s*@(\w+)[:\s]\s*(.+)$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate a SQL migration file content. */
export function validateMigration(sql: string): MigrationValidationResult {
  const lines = sql.split('\n');
  const errors: MigrationError[] = [];
  const warnings: MigrationWarning[] = [];

  const tablesCreated: string[] = [];
  const tablesAltered: string[] = [];
  const columnsAdded: string[] = [];
  const columnsDropped: string[] = [];
  const indexesCreated: string[] = [];

  let hasBegin = false;
  let hasCommit = false;
  let hasStatements = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip pure comments and blank lines for statement detection
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('--')) {
      continue;
    }

    hasStatements = true;

    // Transaction tracking
    if (BEGIN_TX.test(trimmed)) {
      hasBegin = true;
    }
    if (COMMIT_TX.test(trimmed)) {
      hasCommit = true;
    }

    // ---- Errors ----

    // DROP TABLE without IF EXISTS
    if (DROP_TABLE_NO_IF_EXISTS.test(trimmed) && !DROP_TABLE_IF_EXISTS.test(trimmed)) {
      errors.push({
        line: lineNum,
        message: 'DROP TABLE without IF EXISTS — use DROP TABLE IF EXISTS instead',
        severity: 'error',
      });
    }

    // TRUNCATE TABLE
    if (TRUNCATE_TABLE.test(trimmed)) {
      errors.push({
        line: lineNum,
        message: 'TRUNCATE TABLE is a destructive operation that removes all rows',
        severity: 'error',
      });
    }

    // DELETE FROM without WHERE
    if (DELETE_FROM.test(trimmed)) {
      // Collect the full statement (may span multiple lines)
      const fullStatement = collectStatement(lines, i);
      if (!WHERE_CLAUSE.test(fullStatement)) {
        errors.push({
          line: lineNum,
          message: 'DELETE FROM without WHERE clause — this deletes all rows',
          severity: 'error',
        });
      }
    }

    // ALTER TABLE ... DROP COLUMN
    if (ALTER_DROP_COLUMN.test(trimmed)) {
      errors.push({
        line: lineNum,
        message: 'ALTER TABLE ... DROP COLUMN is destructive — requires --allow-destructive flag',
        severity: 'error',
      });

      // Also capture the column name for summary
      const dropColMatch = trimmed.match(ALTER_DROP_COLUMN_NAME);
      if (dropColMatch) {
        const colName = dropColMatch[1] ?? dropColMatch[2];
        if (colName) {
          columnsDropped.push(colName);
        }
      }
    }

    // ---- Warnings ----

    // ALTER COLUMN TYPE
    if (ALTER_COLUMN_TYPE.test(trimmed)) {
      warnings.push({
        line: lineNum,
        message: 'ALTER COLUMN TYPE change may lose data — verify type compatibility',
        severity: 'warning',
      });
    }

    // DROP INDEX
    if (DROP_INDEX.test(trimmed)) {
      warnings.push({
        line: lineNum,
        message: 'DROP INDEX may degrade query performance',
        severity: 'warning',
      });
    }

    // ALTER TABLE ... DROP CONSTRAINT
    if (ALTER_DROP_CONSTRAINT.test(trimmed)) {
      warnings.push({
        line: lineNum,
        message: 'DROP CONSTRAINT removes referential integrity or check constraints',
        severity: 'warning',
      });
    }

    // ---- Summary extraction ----

    // CREATE TABLE
    const createTableMatch = trimmed.match(CREATE_TABLE);
    if (createTableMatch) {
      const tableName = createTableMatch[1] ?? createTableMatch[2];
      if (tableName) {
        tablesCreated.push(tableName);
      }
    }

    // ALTER TABLE (track unique table names)
    const alterTableMatch = trimmed.match(ALTER_TABLE);
    if (alterTableMatch && !CREATE_TABLE.test(trimmed)) {
      const tableName = alterTableMatch[1] ?? alterTableMatch[2];
      if (tableName && !tablesAltered.includes(tableName)) {
        tablesAltered.push(tableName);
      }
    }

    // ADD COLUMN
    const addColMatch = trimmed.match(ALTER_ADD_COLUMN);
    if (addColMatch) {
      const colName = addColMatch[1] ?? addColMatch[2];
      if (colName) {
        columnsAdded.push(colName);
      }
    }

    // CREATE INDEX
    const createIndexMatch = trimmed.match(CREATE_INDEX);
    if (createIndexMatch) {
      const indexName = createIndexMatch[1] ?? createIndexMatch[2];
      if (indexName) {
        indexesCreated.push(indexName);
      }
    }
  }

  // Missing transaction wrapper warning (only if there are SQL statements)
  if (hasStatements && (!hasBegin || !hasCommit)) {
    warnings.push({
      line: 1,
      message: 'Missing transaction wrapper — consider wrapping in BEGIN/COMMIT',
      severity: 'warning',
    });
  }

  const destructive = hasDestructiveOperations(sql);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      tablesCreated,
      tablesAltered,
      columnsAdded,
      columnsDropped,
      indexesCreated,
      hasDestructiveChanges: destructive,
    },
  };
}

/** Check if a migration contains destructive operations. */
export function hasDestructiveOperations(sql: string): boolean {
  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('--')) {
      continue;
    }

    if (DROP_TABLE_NO_IF_EXISTS.test(trimmed) || DROP_TABLE_IF_EXISTS.test(trimmed)) {
      return true;
    }
    if (TRUNCATE_TABLE.test(trimmed)) {
      return true;
    }
    if (ALTER_DROP_COLUMN.test(trimmed)) {
      return true;
    }

    // DELETE FROM without WHERE
    if (DELETE_FROM.test(trimmed)) {
      const fullStatement = collectStatement(lines, lines.indexOf(line));
      if (!WHERE_CLAUSE.test(fullStatement)) {
        return true;
      }
    }
  }
  return false;
}

/** Extract migration metadata from SQL comments. */
export function extractMigrationMetadata(sql: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  const lines = sql.split('\n');

  for (const line of lines) {
    const match = line.trim().match(METADATA_COMMENT);
    if (match) {
      const key = match[1];
      const value = match[2].trim();
      metadata[key] = value;
    }
  }

  return metadata;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collect a full SQL statement starting at the given line index.
 * Reads forward until a semicolon is found or lines are exhausted.
 */
function collectStatement(lines: string[], startIndex: number): string {
  const parts: string[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('--')) {
      continue;
    }
    parts.push(trimmed);
    if (trimmed.includes(';')) {
      break;
    }
  }
  return parts.join(' ');
}
