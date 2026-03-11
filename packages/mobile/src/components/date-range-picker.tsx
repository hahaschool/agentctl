// ---------------------------------------------------------------------------
// DateRangePicker — horizontal chip row for selecting time range presets.
// ---------------------------------------------------------------------------

import type React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { DATE_RANGE_PRESETS, type DateRangePresetKey } from '../screens/session-browser-model.js';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type DateRangePickerProps = {
  selected: DateRangePresetKey;
  onSelect: (key: DateRangePresetKey) => void;
};

export function DateRangePicker({ selected, onSelect }: DateRangePickerProps): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {DATE_RANGE_PRESETS.map((preset) => (
        <TouchableOpacity
          key={preset.key}
          style={[styles.chip, selected === preset.key && styles.chipActive]}
          onPress={() => onSelect(preset.key)}
        >
          <Text style={styles.chipText}>{preset.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  chip: {
    backgroundColor: '#1f2937',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: '#1d4ed8',
  },
  chipText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});
