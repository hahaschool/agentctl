// ---------------------------------------------------------------------------
// ExpandableDiff — shows each agent's contribution as an expandable section
// with file diff summary extracted from handoff snapshots.
// ---------------------------------------------------------------------------

import type React from 'react';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { RuntimeSessionHandoff } from '../services/runtime-session-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runtimeLabel(runtime: string): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function truncateId(id: string, length = 10): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

// ---------------------------------------------------------------------------
// Single section component
// ---------------------------------------------------------------------------

type DiffSectionProps = {
  handoff: RuntimeSessionHandoff;
};

function DiffSection({ handoff }: DiffSectionProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const hasDiff = handoff.snapshot.diffSummary.length > 0;
  const hasFiles = handoff.snapshot.dirtyFiles.length > 0;
  const hasTodos = handoff.snapshot.openTodos.length > 0;

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={toggle} activeOpacity={0.7}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.chevron}>{expanded ? '\u25BC' : '\u25B6'}</Text>
          <Text style={styles.sectionTitle}>
            {runtimeLabel(handoff.sourceRuntime)} → {runtimeLabel(handoff.targetRuntime)}
          </Text>
        </View>
        <Text style={styles.sectionMeta}>
          {handoff.snapshot.dirtyFiles.length} file
          {handoff.snapshot.dirtyFiles.length === 1 ? '' : 's'}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.sectionBody}>
          {handoff.snapshot.branch && (
            <Text style={styles.branchText}>
              Branch: {handoff.snapshot.branch}
              {handoff.snapshot.headSha ? ` (${truncateId(handoff.snapshot.headSha, 8)})` : ''}
            </Text>
          )}

          {hasDiff && (
            <View style={styles.diffBlock}>
              <Text style={styles.diffLabel}>Diff Summary</Text>
              <Text style={styles.diffText}>{handoff.snapshot.diffSummary}</Text>
            </View>
          )}

          {hasFiles && (
            <View style={styles.filesBlock}>
              <Text style={styles.filesLabel}>
                Changed Files ({handoff.snapshot.dirtyFiles.length})
              </Text>
              {handoff.snapshot.dirtyFiles.map((file) => (
                <Text key={file} style={styles.fileName}>
                  {file}
                </Text>
              ))}
            </View>
          )}

          {hasTodos && (
            <View style={styles.todosBlock}>
              <Text style={styles.todosLabel}>
                Open TODOs ({handoff.snapshot.openTodos.length})
              </Text>
              {handoff.snapshot.openTodos.map((todo) => (
                <Text key={todo} style={styles.todoText}>
                  {'\u2022'} {todo}
                </Text>
              ))}
            </View>
          )}

          {!hasDiff && !hasFiles && !hasTodos && (
            <Text style={styles.emptyText}>No diff data available for this handoff.</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type ExpandableDiffProps = {
  handoffs: RuntimeSessionHandoff[];
};

export function ExpandableDiff({ handoffs }: ExpandableDiffProps): React.JSX.Element {
  if (handoffs.length === 0) {
    return <Text style={styles.emptyText}>No agent contributions to display.</Text>;
  }

  return (
    <View style={styles.container}>
      {handoffs.map((handoff) => (
        <DiffSection key={handoff.id} handoff={handoff} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 13,
  },
  section: {
    backgroundColor: '#1f2937',
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  chevron: {
    color: '#6b7280',
    fontSize: 11,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionMeta: {
    color: '#9ca3af',
    fontSize: 11,
  },
  sectionBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  branchText: {
    color: '#60a5fa',
    fontSize: 12,
    fontFamily: 'Courier',
    marginTop: 10,
    marginBottom: 8,
  },
  diffBlock: {
    backgroundColor: '#111111',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2e2e2e',
  },
  diffLabel: {
    color: '#a78bfa',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  diffText: {
    color: '#d1d5db',
    fontSize: 12,
    fontFamily: 'Courier',
    lineHeight: 18,
  },
  filesBlock: {
    marginBottom: 8,
  },
  filesLabel: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  fileName: {
    color: '#d1d5db',
    fontSize: 12,
    fontFamily: 'Courier',
    paddingLeft: 8,
    lineHeight: 20,
  },
  todosBlock: {
    marginBottom: 4,
  },
  todosLabel: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  todoText: {
    color: '#d1d5db',
    fontSize: 12,
    paddingLeft: 8,
    lineHeight: 20,
  },
});
