import { useEffect, useState } from 'react';
import { backOr } from '../../lib/nav';
import { RiderProfileForm } from '../../components/RiderProfileForm';
import { useProfiles } from '../../contexts/ProfileContext';
import { useAuth } from '../../contexts/AuthContext';
import { fetchRiderProfile } from '../../lib/profileApi';

export default function EditRiderProfile() {
  const { rider, setRider } = useProfiles();
  const { user } = useAuth();
  // ProfileContext is in-memory, so reaching this screen directly — a
  // refresh, a deep link, one of the app's own redirects — leaves it empty
  // and the form renders blank. That isn't just cosmetic here: this form
  // SAVES. Retyping a name and phone over a blank form would write empty
  // needs and an empty standing note back over the real profile, and those
  // are what every driver is matched against. Load the real thing first.
  const [loading, setLoading] = useState(rider.fullName.trim() === '');

  useEffect(() => {
    if (!user || rider.fullName.trim() !== '') {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await fetchRiderProfile(user.id);
      if (cancelled) return;
      if (data) setRider(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, rider.fullName]);

  const firstName = rider.fullName.trim().split(' ')[0];

  // Never show the form half-loaded — an empty field here reads as "you have
  // nothing saved", which is exactly the misunderstanding that leads to
  // overwriting a real profile.
  if (loading) return null;

  return (
    <RiderProfileForm
      title={firstName ? `${firstName}'s Profile` : 'Rider Profile'}
      ctaLabel="Save Profile"
      onBack={() => backOr('/(rider)/home')}
      onSubmit={() => backOr('/(rider)/home')}
    />
  );
}
