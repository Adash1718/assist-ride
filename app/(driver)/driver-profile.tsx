import { router } from 'expo-router';
import { DriverProfileForm } from '../../components/DriverProfileForm';
import { useProfiles } from '../../contexts/ProfileContext';

export default function EditDriverProfile() {
  const { driver } = useProfiles();
  const firstName = driver.fullName.trim().split(' ')[0];
  return (
    <DriverProfileForm
      title={firstName ? `${firstName}'s Profile` : 'Driver Profile'}
      ctaLabel="Save Profile"
      onBack={() => router.back()}
      onSubmit={() => router.back()}
    />
  );
}
