import { router } from 'expo-router';
import { backOr } from '../../lib/nav';
import { RiderProfileForm } from '../../components/RiderProfileForm';
import { useProfiles } from '../../contexts/ProfileContext';

export default function EditRiderProfile() {
  const { rider } = useProfiles();
  const firstName = rider.fullName.trim().split(' ')[0];
  return (
    <RiderProfileForm
      title={firstName ? `${firstName}'s Profile` : 'Rider Profile'}
      ctaLabel="Save Profile"
      onBack={() => backOr('/(rider)/home')}
      onSubmit={() => backOr('/(rider)/home')}
    />
  );
}
