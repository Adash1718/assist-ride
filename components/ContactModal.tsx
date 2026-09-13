import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing, type } from '../constants/theme';
import { formatPhoneInput, isValidPhone } from '../lib/validators';
import { PrimaryButton, SecondaryButton } from './ui';

export type EmergencyContactInput = { name: string; phone: string; address: string; email: string };
export type MedicalContactInput = EmergencyContactInput & { specialty: string; hospital: string };

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address';
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 14,
          fontSize: 16,
          color: colors.text,
        }}
      />
    </View>
  );
}

// Shared by "Add emergency contact" and "Add doctor or caretaker" — same
// base fields (name/phone/address/email); the doctor variant adds
// specialty + hospital on top.
export function ContactModal({
  visible,
  onClose,
  onSave,
  variant,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (contact: MedicalContactInput) => void;
  variant: 'emergency' | 'doctor';
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [hospital, setHospital] = useState('');

  useEffect(() => {
    if (visible) {
      setName('');
      setPhone('');
      setAddress('');
      setEmail('');
      setSpecialty('');
      setHospital('');
    }
  }, [visible]);

  const canSave = name.trim() !== '' && isValidPhone(phone);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '85%',
          backgroundColor: colors.surface,
          borderTopLeftRadius: radii.lg,
          borderTopRightRadius: radii.lg,
        }}
      >
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, padding: spacing.lg, paddingBottom: spacing.sm }}>
          {variant === 'doctor' ? 'Add doctor or caretaker' : 'Add emergency contact'}
        </Text>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.md }}>
          <Field label="Full name" value={name} onChangeText={setName} placeholder="e.g. Maria Alvarez" />
          <Field
            label="Phone number"
            value={phone}
            onChangeText={(v) => setPhone(formatPhoneInput(v))}
            placeholder="(555) 000-0000"
            keyboardType="phone-pad"
          />
          <Field label="Address" value={address} onChangeText={setAddress} placeholder="Street, city, state" />
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" />
          {variant === 'doctor' && (
            <>
              <Field label="Type of doctor" value={specialty} onChangeText={setSpecialty} placeholder="e.g. Primary care, Cardiologist" />
              <Field label="Hospital / practice" value={hospital} onChangeText={setHospital} placeholder="e.g. Riverside Medical Center" />
            </>
          )}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 12, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
          <SecondaryButton label="Cancel" onPress={onClose} />
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label="Add"
              disabled={!canSave}
              onPress={() => {
                onSave({ name: name.trim(), phone, address: address.trim(), email: email.trim(), specialty, hospital });
                onClose();
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
