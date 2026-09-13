import { router } from 'expo-router';
import { RiderProfileForm } from '../../components/RiderProfileForm';

export default function RiderSignUp() {
  return (
    <RiderProfileForm
      title="Create Your Profile"
      ctaLabel="Create Profile"
      onBack={() => router.back()}
      onSubmit={() => router.replace('/(rider)/home')}
    />
  );
}
