import { router } from 'expo-router';
import { RiderProfileForm } from '../../components/RiderProfileForm';
import { useProfiles } from '../../contexts/ProfileContext';

export default function EditRiderProfile() {
  const { rider } = useProfiles();
  const firstName = rider.fullName.trim().split(' ')[0];
  return (
    <RiderProfileForm
      title={firstName ? `${firstName}'s Profile` : 'Rider Profile'}
      ctaLabel="Save Profile"
      onBack={() => router.back()}
      onSubmit={() => router.back()}
    />
  );
}
