import { router } from 'expo-router';
import { DriverProfileForm } from '../../components/DriverProfileForm';

export default function DriverSignUp() {
  return (
    <DriverProfileForm
      title="Create Your Profile"
      ctaLabel="Create Profile"
      onBack={() => router.back()}
      onSubmit={() => router.push('/(onboarding)/driver-verification')}
    />
  );
}
