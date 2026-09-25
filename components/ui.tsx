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
        <IconButton onPress={onBack} label="Go back">
          <ChevronLeftIcon />
        </IconButton>
      ) : (
        <View style={{ width: minTouchTarget }} />
      )}
      <Text style={[type.title, { flex: 1, color: colors.text }]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {right ?? <View style={{ width: minTouchTarget }} />}
    </View>
  );
}

// `label` is REQUIRED in spirit even though it's optional in the type: an
// icon button with no label is announced by a screen reader as just "button",
// which in this app means a blind rider cannot tell sign-out from back. Every
// call site passes one; the optionality exists only so older call sites fail
// loudly in review rather than silently at runtime.
export function IconButton({
  children,
  onPress,
  label,
}: {
  children: ReactNode;
  onPress?: () => void;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.iconBtn}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* The icon itself is decorative — the label above carries the meaning,
          so don't let a screen reader read the SVG as a second element. */}
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {children}
      </View>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  // Announced as a heading so screen-reader users can jump between sections
  // instead of reading every card top to bottom.
  return (
    <Text style={type.sectionLabel} accessibilityRole="header">
      {children}
    </Text>
  );
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
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      // Selectable chips are checkboxes, not buttons: "selected" has to be
      // announced, or a rider choosing their mobility aid can't tell what
      // they've already picked.
      accessibilityRole={onPress ? 'checkbox' : 'text'}
      accessibilityState={onPress ? { checked: !!selected } : undefined}
      accessibilityLabel={label}
    >
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
      accessibilityRole="button"
      accessibilityLabel={label}
      // Without this a disabled button is announced as tappable, and a rider
      // is left wondering why nothing happens.
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text selectable={false} style={[styles.btnText, { color: disabled ? colors.textTertiary : colors.surface }]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.btn, { backgroundColor: colors.surfaceAlt, flex: 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
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
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[styles.segment, active && styles.segmentActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, checked: active }}
            accessibilityLabel={opt}
          >
            <Text selectable={false} style={[styles.segmentText, active && { color: colors.text }]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// `label` names what is being counted ("companions"), so the buttons don't
// announce as a bare "minus" and "plus" with no idea what they change.
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 6,
  label = 'value',
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        style={styles.stepBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${label}`}
        accessibilityState={{ disabled: value <= min }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>–</Text>
      </Pressable>
      <Text
        style={{ fontSize: 18, fontWeight: '700', minWidth: 20, textAlign: 'center', color: colors.text }}
        accessibilityLabel={`${value} ${label}`}
      >
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        style={styles.stepBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`More ${label}`}
        accessibilityState={{ disabled: value >= max }}
      >
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>+</Text>
      </Pressable>
    </View>
  );
}

// Initials are a visual shorthand for a name that is always shown next to
// them, so announcing "E W" adds nothing but noise.
export function Avatar({ initials, size = 48 }: { initials: string; size?: number }) {
  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
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
