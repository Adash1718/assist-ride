import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, radii, spacing, type } from '../constants/theme';
import { ChevronLeftIcon } from './Icon';

// Shared UI kit — mirrors the .card/.chip/.btn/.topbar classes used across
// wireframes/*.dc.html so screens stay visually consistent without repeating
// styles. Add to this file rather than inlining one-off styled Views.

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.frame}>{children}</View>;
}

export function TopBar({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.topbar}>
      {onBack ? (
        <IconButton onPress={onBack}>
          <ChevronLeftIcon />
        </IconButton>
      ) : (
        <View style={{ width: minTouchTarget }} />
      )}
      <Text style={[type.title, { flex: 1, color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      {right ?? <View style={{ width: minTouchTarget }} />}
    </View>
  );
}

export function IconButton({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.iconBtn} hitSlop={8}>
      {children}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={type.sectionLabel}>{children}</Text>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text style={type.hint}>{children}</Text>;
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text selectable={false} style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, { backgroundColor: disabled ? colors.surfaceAlt : colors.accent }]}
    >
      <Text selectable={false} style={[styles.btnText, { color: disabled ? colors.textTertiary : colors.surface }]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.btn, { backgroundColor: colors.surfaceAlt, flex: 1 }]}>
      <Text selectable={false} style={[styles.btnText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <Pressable key={opt} onPress={() => onChange(opt)} style={[styles.segment, active && styles.segmentActive]}>
            <Text selectable={false} style={[styles.segmentText, active && { color: colors.text }]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 6 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        style={styles.stepBtn}
        hitSlop={8}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>–</Text>
      </Pressable>
      <Text style={{ fontSize: 18, fontWeight: '700', minWidth: 20, textAlign: 'center', color: colors.text }}>{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        style={styles.stepBtn}
        hitSlop={8}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>+</Text>
      </Pressable>
    </View>
  );
}

export function Avatar({ initials, size = 48 }: { initials: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: size * 0.32 }}>{initials}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  iconBtn: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: minTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  chipTextSelected: { color: colors.accentDark },
  btn: {
    height: 56,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  btnText: { fontSize: 17, fontWeight: '700' },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 4,
    gap: 4,
  },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radii.md - 3 },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
