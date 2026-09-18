import { router } from 'expo-router';
import { backOr } from '../../lib/nav';
import { DriverProfileForm } from '../../components/DriverProfileForm';

export default function DriverSignUp() {
  return (
    <DriverProfileForm
      title="Create Your Profile"
      ctaLabel="Create Profile"
      onBack={() => backOr('/')}
      onSubmit={() => router.push('/(onboarding)/driver-verification')}
    />
  );
}
