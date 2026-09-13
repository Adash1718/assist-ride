import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { colors, radii, spacing } from '../constants/theme';
import { monthMatrix, formatMonthYear, startOfDay } from '../lib/dateTime';
import { ChevronLeftIcon, ChevronRightIcon } from './Icon';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Only today-or-later is selectable — this is for scheduling a ride, not
// picking a birthdate, so past dates are disabled rather than just unusual.
export function DatePickerModal({
  visible,
  onClose,
  onSelect,
  initialDate,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (date: Date) => void;
  initialDate: Date | null;
}) {
  const today = startOfDay(new Date());
  const [viewYear, setViewYear] = useState((initialDate ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState((initialDate ?? today).getMonth());

  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const weeks = monthMatrix(viewYear, viewMonth);

  const goPrev = () => {
    if (isCurrentMonth) return;
    const d = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };
  const goNext = () => {
    const d = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.surface,
          borderTopLeftRadius: radii.lg,
          borderTopRightRadius: radii.lg,
          padding: spacing.lg,
          gap: spacing.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={goPrev} disabled={isCurrentMonth} hitSlop={8} style={{ opacity: isCurrentMonth ? 0.3 : 1, padding: 6 }}>
            <ChevronLeftIcon />
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{formatMonthYear(viewYear, viewMonth)}</Text>
          <Pressable onPress={goNext} hitSlop={8} style={{ padding: 6 }}>
            <ChevronRightIcon />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row' }}>
          {WEEKDAY_LABELS.map((w, i) => (
            <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.textTertiary }}>
              {w}
            </Text>
          ))}
        </View>

        {weeks.map((week, wi) => (
          <View key={wi} style={{ flexDirection: 'row' }}>
            {week.map((day, di) => {
              if (!day) return <View key={di} style={{ flex: 1, height: 44 }} />;
              const disabled = day.getTime() < today.getTime();
              const isToday = day.getTime() === today.getTime();
              return (
                <Pressable
                  key={di}
                  disabled={disabled}
                  onPress={() => onSelect(day)}
                  style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isToday ? colors.accentSoft : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: isToday ? '700' : '500', color: disabled ? colors.border : colors.text }}>
                      {day.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </Modal>
  );
}
