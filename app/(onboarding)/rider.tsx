import { router } from 'expo-router';
import { backOr } from '../../lib/nav';
import { RiderProfileForm } from '../../components/RiderProfileForm';

export default function RiderSignUp() {
  return (
    <RiderProfileForm
      title="Create Your Profile"
      ctaLabel="Create Profile"
      onBack={() => backOr('/')}
      onSubmit={() => router.replace('/(rider)/home')}
    />
  );
}
