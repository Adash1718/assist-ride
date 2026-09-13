import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { colors, radii, spacing } from '../constants/theme';
import { timeSlotsFor } from '../lib/dateTime';

export function TimePickerModal({
  visible,
  onClose,
  onSelect,
  forDate,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (label: string) => void;
  forDate: Date | null;
}) {
  const slots = timeSlotsFor(forDate ?? new Date(), new Date());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '60%',
          backgroundColor: colors.surface,
          borderTopLeftRadius: radii.lg,
          borderTopRightRadius: radii.lg,
          padding: spacing.lg,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm }}>Pick a time</Text>
        {slots.length === 0 ? (
          <Text style={{ fontSize: 14, color: colors.textSecondary, paddingVertical: spacing.md }}>
            No times left today — pick a future date first.
          </Text>
        ) : (
          <ScrollView>
            {slots.map((s) => (
              <Pressable
                key={s.label}
                onPress={() => onSelect(s.label)}
                style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}
              >
                <Text style={{ fontSize: 16, color: colors.text }}>{s.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
