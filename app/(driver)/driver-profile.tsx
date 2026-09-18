import { router } from 'expo-router';
import { backOr } from '../../lib/nav';
import { DriverProfileForm } from '../../components/DriverProfileForm';
import { useProfiles } from '../../contexts/ProfileContext';

export default function EditDriverProfile() {
  const { driver } = useProfiles();
  const firstName = driver.fullName.trim().split(' ')[0];
  return (
    <DriverProfileForm
      title={firstName ? `${firstName}'s Profile` : 'Driver Profile'}
      ctaLabel="Save Profile"
      onBack={() => backOr('/(driver)/driver-home')}
      onSubmit={() => backOr('/(driver)/driver-home')}
    />
  );
}
