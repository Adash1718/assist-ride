-- Assist Ride — no identification photo in this build (round 12)
--
-- Decision (2026-09-17): the rider identification photo is deferred. It was
-- never actually working: the picker stored a LOCAL device URI in
-- rider_profiles.photo_url (on web a blob: URL that dies with the tab),
-- nothing ever uploaded the bytes anywhere, and the driver's "Recognizing the
-- rider" card never rendered a photo at all. Making it real means private
-- storage for photographs of disabled riders plus access rules and
-- retention — worth doing properly if this becomes a real service, not worth
-- half-doing now. Identification at pickup stays: the rider's text
-- description (identification_aid, SPEC.md §2.2) and the PIN (§2.5).
--
-- The column is kept so the feature can return without a schema change; only
-- its unusable values are cleared. This is the one migration in this project
-- that touches data — it deletes dead local file paths, nothing else.

update public.rider_profiles
set photo_url = null
where photo_url is not null;
