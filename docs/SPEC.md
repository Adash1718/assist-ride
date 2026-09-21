# Assist Ride — Product Spec (v0.1 draft)

> Working name only. A specialized rideshare service for individuals who need
> physical or communication assistance to travel — originally inspired by a
> senior citizen (limited tech skills) struggling to book a standard rideshare.

Items marked **[ASSUMED]** are my best guess to keep the spec moving — flag
any of them to change. Items marked **[OPEN]** are things we haven't decided
and I've deliberately left blank rather than guess.

## 0. Milestone: authentication + real data (this round)

The app moved from an in-memory UI prototype to real auth + persistence:

- **Auth**: Supabase email/password. `contexts/AuthContext.tsx` wraps
  session state; sign-up stores `role` (`rider`|`driver`) in the user's
  metadata so later logins know which table/home to route to.
- **Schema**: [`supabase/migrations/0001_init.sql`](assist-ride/supabase/migrations/0001_init.sql)
  — `rider_profiles`, `driver_profiles`, `emergency_contacts`,
  `medical_contacts`, and a `ride_requests` table (schema only, not wired to
  the booking screens yet — see below). RLS policies restrict every table to
  the owning user.
- **Profile create/edit now persists**: `lib/profileApi.ts` bridges
  `ProfileContext`'s shape to the DB. Sign-up creates a bare profile row
  immediately (so contacts have something to reference before the form is
  submitted); "Create/Save Profile" upserts the full row; adding/removing an
  emergency or medical contact writes through immediately, not just on
  final submit.
- **Setup is on the user, not Claude**: creating the Supabase project itself
  is an account-creation step outside what Claude does autonomously — see
  [`assist-ride/README-SUPABASE.md`](assist-ride/README-SUPABASE.md) for the
  one-time steps (create project → copy URL/anon key into `.env` → run the
  migration in the SQL Editor). Until that's done, `lib/supabase.ts` falls
  back to a placeholder URL so the rest of the app keeps working — auth
  calls just fail with a visible "Failed to fetch" instead of crashing.

**Not yet wired** (next milestones, deliberately deferred):
- Booking flow (`book.tsx` → `matching.tsx` → …) still uses local state and
  a fake timer instead of writing to `ride_requests` / real matching.
- No real-time subscriptions (a proxy's "Tracking" screen doesn't yet
  reflect another device's live status).
- No password reset flow, no route-level auth guard beyond the two home
  screens (redirect-to-Welcome if there's no session).

---

## 1. Scope decisions locked in so far

- **Standalone service**, own driver pool — not a layer on Uber/Lyft.
- **Proxy booking is in scope from day one**: a caregiver/family member can
  book on behalf of a rider who won't use the app themselves. Self-service
  (the rider books their own ride) is also in scope, using the same booking
  flow — a request is just made *by* a rider account instead of *for* one.
- **Exactly one assistance-needing rider per ride.** No multi-disabled-rider
  bin-packing for now — this drastically simplifies driver capacity and
  matching. Revisit later if there's demand.
- **Proxy/companion riders may ride along** (0 or more), separate headcount
  from the assistance rider.
- **Premium/specialized positioning is accepted**: stricter driver
  requirements → smaller driver pool → higher price point. This is treated
  as a feature (trust/quality), not an oversight.
- Proxy does **not** ride along by default in this model (they book/track
  remotely) — but nothing stops the same flow from also supporting "proxy
  rides along" as just a proxy-rider headcount of 1.

---

## 2. Core entities

### 2.1 User Account
A single account can hold multiple roles: **Rider**, **Proxy**, **Driver**.
(A person could plausibly be a proxy for their mother and also a driver on
the platform — no reason to force separate accounts.)

- `user_id`, name, phone, email, auth info
- `roles: [rider, proxy, driver]`

### 2.2 Rider Profile
The persistent record of a person who needs assistance. Created either by
the rider themselves or by a proxy on their behalf.

| Field | Notes |
|---|---|
| `rider_id` | |
| `linked_proxy_ids[]` | proxies allowed to book/view for this rider |
| `mobility_aid` | none / cane / walker / manual wheelchair / power wheelchair / other **[ASSUMED enum — confirm list]** |
| `wheelchair_foldable` | bool, only relevant if wheelchair — determines if a regular trunk works or a ramp/lift vehicle is required |
| `communication_needs` | tags: hearing-impaired, vision-impaired, cognitive support, non-native-language, other-freeform |
| `assistance_needs` | tags: needs door-to-door escort, needs help with transfer to seat, needs extra time, service animal, other-freeform |
| `standing_notes` | freeform, persists across rides ("always sits in front seat") |
| `identification_aid` | set by proxy (or rider) ahead of time to help a driver who's never met the rider confirm they have the right person — e.g. photo, physical description, "will be wearing a red jacket," name to call out. Shown to driver alongside the PIN at pickup. |
| `emergency_contacts[]` | name/phone/relationship — separate from the proxy; who to reach if something goes wrong on a ride |
| `medical_contacts[]` | optional — doctor(s)/caretaker(s), name/phone/role, for context in a non-urgent situation |
| — | **Not** a substitute for emergency services — app should surface a clear "call 911" action for actual emergencies rather than routing through these contacts |

### 2.3 Driver Profile
| Field | Notes |
|---|---|
| `driver_id` | |
| `vehicle` | make/model, total seat count |
| `ramp_or_lift_equipped` | bool — required for non-foldable wheelchair riders |
| `assistance_capability_tags` | self-attested: "comfortable assisting transfers," "wheelchair stowage," "patient with cognitive-support riders," etc. **[ASSUMED — self-attested at v1, see §5]** |
| `certifications[]` | optional uploaded doc (e.g. CPR, caregiving course) — **[OPEN]** whether this is verified by anyone or just displayed |
| `background_check_status` | **[OPEN]** — placeholder field; real check likely needs a 3rd-party provider (e.g. Checkr) — out of scope for a prototype |
| `capacity.assistance_seats` | **[ASSUMED = 1 always, given one-assistance-rider-per-ride rule]** |
| `capacity.companion_seats` | integer, remaining seats after driver + assistance rider |

### 2.4 Ride Request
| Field | Notes |
|---|---|
| `requested_by` | user_id (rider themselves, or a linked proxy) |
| `rider_profile_id` | the one assistance rider on this ride |
| `companion_count` | 0..N, capped by matched driver's `capacity.companion_seats` |
| `pickup`, `dropoff` | |
| `ride_mode` | `on_demand` \| `scheduled` — both supported in v1 |
| `requested_time` | now (on-demand) or a future date/time (scheduled) |
| `ride_notes` | freeform, ride-specific (separate from the rider's standing profile notes — e.g. "extra bag today") |
| `needs_snapshot` | copy of the rider profile's need-tags at request time, so later profile edits don't retroactively change a ride already matched |

### 2.5 Ride (post-match)
- status lifecycle: `requested → matched → driver_en_route → arrived → in_progress → completed` (+ `cancelled` / `no_show`)
- live tracking, visible to whoever booked it (rider and/or proxy)
- **Status history — DECIDED (round 9)**: every status change is appended to
  a `ride_events` log by a database trigger, not by the app — so all paths
  are covered (driver screens, rider cancel, and the `SECURITY DEFINER`
  functions for decline/driver-cancel), including ones added later. Clients
  can read the log (whoever booked the ride, plus the ride's current driver)
  but never write it. The Tracking screen's timeline is built from it, and
  it's the only way the history survives a driver handing a ride back before
  pickup, which moves the status `matched → requested`. No ETA is shown
  anywhere in the app: there's no routing or map data to base one on yet.
- **Pickup identity verification — DECIDED**: a PIN code shown in the driver
  app, confirmed against the rider/proxy app, plus the rider profile's
  `identification_aid` (photo/description/what-they're-wearing) surfaced to
  the driver beforehand — useful precisely because the driver may be meeting
  someone whose profile a proxy set up and has never seen in person.

### 2.6 Post-ride Feedback
- Separate from a generic star rating: a specific "how was the assistance
  experience" rating/comment, tied to the driver's `assistance_capability_tags`
  so bad-actor drivers (checked the box, didn't actually help) get filtered
  out over time.
- **Stored for real — round 14** (`0014_ride_feedback.sql`). One row per ride
  (`ride_id` is the primary key, so a duplicate submit fails in the database),
  holding the three specific ratings, the overall rating and an optional
  comment. Written only by the ride's requester, only once it's `completed`,
  and only against the ride's actual matched driver. There are no UPDATE or
  DELETE policies: feedback is immutable once sent, and the completion screen
  says so before you send it.
- **Drivers cannot read individual feedback.** A comment on a ride a driver
  just finished would identify the rider who left it. Drivers get only their
  own aggregate, via `my_driver_rating()` — a `SECURITY DEFINER` function that
  takes no argument, so there is no other driver to ask about. It returns
  `count` with null averages when there's none yet, so the app says "No
  ratings yet" rather than "0.0".
- **Still not built**: feeding any of this into matching or ranking (§3.C),
  flagging drivers whose assistance ratings contradict their capability tags,
  and any moderation of comments.

---

## 3. Core flows

**0. Onboarding — DECIDED**: a Welcome screen (brief pitch, no login wall)
leads to a single choice: **sign up as a Rider or as a Driver**. That choice
immediately leads into the matching **create-profile** screen (rider needs,
or driver vehicle/capabilities — same fields as the persistent profile in
§2.2/§2.3), and completing it lands on that role's **home**:
- **Rider home**: the full ride-requesting interface — profile summary up
  top, primary "Book a Ride" action. This is where the rest of flow B below
  starts.
- **Driver home**: an availability toggle (Available/Offline), matching a
  standard rideshare driver app rather than a booking interface — a driver
  does nothing but wait once available.

No auth exists yet (see §6) — right now "signing up" just walks straight
into create-profile with no account actually persisted (though see the
round-3 fixes below: entered data now lives in an in-memory
`ProfileContext` for the session, instead of every screen showing a fixed
demo name). Editing an existing profile later reuses the exact same form
component in an "edit" mode (see `components/RiderProfileForm.tsx` /
`DriverProfileForm.tsx` in the app).

**0c. Round-4 fixes — real inputs, not placeholders**:
- **Phone number** now auto-formats as `(XXX) XXX-XXXX` while typing and is
  validated (must resolve to 10 digits) before a profile can be submitted —
  same on rider, driver, and the contact-add forms below.
- **Date of birth** auto-inserts slashes (`MM/DD/YYYY`) and is validated as a
  real calendar date that isn't in the future — inline red error text
  otherwise, and the create-profile CTA stays disabled until it's valid.
- **Photo upload — REMOVED in round 12 (2026-09-17).** Round 4 added an
  `expo-image-picker` box to the rider's "Help a driver recognize you" card,
  but it only ever stored a **local device URI** (on web a `blob:` URL that
  dies with the tab): nothing uploaded the bytes anywhere, and the driver's
  screen never rendered a photo at all. Identification at pickup is the text
  description (`identification_aid`, §2.2) plus the PIN (§2.5). Doing photos
  properly means private storage for photographs of disabled riders, with
  access rules and retention — deferred rather than half-built, and worth
  adding back if this becomes a real service. The `photo_url` column stays
  so it can return without a schema change.
- **"Add emergency contact" and "Add doctor or caretaker" are functional**:
  each opens a form (name, phone, address, email — doctor adds specialty
  and hospital/practice) and adds a removable row to the profile. Previously
  these were inert text with a plus icon.
- **Scheduling picks real dates/times**: tapping the date field opens a
  calendar (current month, past days disabled, forward navigation only);
  tapping time opens a list of slots — filtered to exclude anything at or
  before the current moment when today is selected. Free-text date/time
  entry is gone.

**0a. Create-profile now starts with identity, not needs — DECIDED**: both
the rider and driver create-profile forms open with a **Basic Info** section
(full name, date of birth, phone; driver adds license number) before any
needs/vehicle questions. The "Create Profile" button is disabled until a
name (and, for drivers, a license number) is entered — profiles can no
longer be created blank. Whatever's entered here now actually appears
elsewhere (home screen, ride screens) instead of the fixed demo persona
that was there before.

**0b. Driver verification — DECIDED (base level, self-attested)**: after
completing the driver create-profile form, a driver goes through a **Basic
Capability Check** before reaching driver home — a handful of yes/no
questions (can you assist a rider up to a given weight during a transfer,
are you comfortable supporting an older adult while walking, can you lift a
folded wheelchair/walker, do you have relevant experience). Still entirely
self-attested (no real background check, per §5/§6) — a "no" on a critical
question doesn't block setup, it just surfaces a note that some ride types
may not be matched to that driver. This is deliberately the *bare minimum*
version; a real verification pipeline is future work.

**A. Rider profile setup** — by rider or proxy, or as part of onboarding
above. One-time, editable later from the rider home screen.

**B. Book a ride** — requester is a rider or a linked proxy → fills pickup/
dropoff/time → optionally adjusts companion count and ride-specific notes →
system matches. **Fixed in round 3**: selecting "Schedule" now actually
shows date and time fields (was previously a dead toggle with no inputs) —
the primary action button is disabled until both are filled.

**C. Matching** — filter drivers by: has 1 free assistance seat, has enough
companion seats, vehicle meets any hard requirement (e.g. ramp needed →
ramp-equipped only), then rank by capability-tag overlap + proximity + rating.

**C1. Who this service is for — DECIDED (round 10)**: riders with **moderate**
assistance needs. Severe-care transport is non-emergency medical transport —
different vehicles, securement, training and regulation (see §5) — and the
matching rules below deliberately don't try to cover it.

**C2. Hard vs advisory matching — DECIDED (round 10)**, implemented in
`supabase/migrations/0010_capability_matching.sql` as `driver_can_serve()`,
enforced in the drivers' row-level SELECT policy so an ineligible driver
never sees the ride and cannot accept it:

| Rider need | Hard requirement on the driver |
|---|---|
| Power wheelchair, or any wheelchair the rider marks as non-folding | ramp-equipped vehicle |
| Folding wheelchair | ramp **or** `Wheelchair stowage` |
| `Help transferring to seat` | `Comfortable assisting transfers` |
| `Extra patience needed` or `Prefers simple instructions` | `Patient with cognitive-support riders` |
| `companion_count` | must fit the driver's `companion_seats` |

Advisory only — shown to the driver, never used to hide a ride:
- `Service animal`: in the US this is a legal obligation, not an optional
  capability, so drivers must not be able to filter these rides out.
- `Hard of hearing`, `Vision impaired`, `Needs extra time`: no corresponding
  driver capability exists to check them against.

**C3. Ranking — DECIDED (round 15)**, in `0015_offer_ranking.sql`. There is no
server process to run a dispatch loop and no geo for proximity, so ranking is
expressed as **staggered visibility**, computed on the fly: a ride is visible
to a driver whose rank is `<= 1 + floor(age / 45s)`. The best match is offered
a new ride alone for one accept window (§4's 45s), then the top two, then the
top three, until every eligible driver can see it. No background job, no
offers table, and it degrades to the old free-for-all for an older ride.

Rank order: how many of the driver's capability tags are **relevant to this
ride's needs**, then their rating (§2.6). Hard requirements are already
guaranteed by §3.C2's filter, so the tag term mostly separates drivers on the
advisory needs — e.g. a driver experienced with service animals is offered
that ride first. Unrated drivers score as average (4.0), not worst, so a new
driver isn't buried. Proximity remains unused: there is no geo in the app.

Declining, going offline or picking up another ride re-ranks everyone else
immediately — the next driver doesn't wait out the stagger. For a scheduled
ride the clock starts at its lead window (§4), not when it was booked.

Still not built: §4's radius widening (no geo), and anything that acts on the
contradiction between a driver's assistance ratings and their capability tags.

**D. Pre-arrival briefing** — driver sees rider's needs_snapshot before
arriving, not discovered at curbside.

**E. Pickup** — identity confirmation (see 2.6 open item).

**F. Tracking & notification** — whoever booked (rider and/or proxy) sees
live status; if a proxy booked and isn't riding along, they get push
notifications at each status change (matched, driver arriving, picked up,
completed) since they can't see it happening.

**G. Completion & feedback.**

**H. Driver onboarding** — signup → vehicle info → self-attested capability
form → optional certification upload → **[OPEN]** background check step →
approval → active.

---

## 4. Decisions from round 2

- **Ride mode**: both **on-demand** and **scheduled** are in scope for v1
  (not phased) — `ride_mode` field on the request, see §2.4.
- **No-match fallback**: if no driver matches within a set window, auto-widen
  search radius; if still no match, show a clear failure state and offer to
  convert the request into a **scheduled** ride for later, rather than a
  silent dead end.
  - **Built in round 11** (`0011_eligible_driver_count.sql`): the rider is
    told which situation they're in, because after §3.C2's filtering a ride
    can legitimately have nobody eligible.
    `count_eligible_drivers_for_ride()` counts drivers who are available,
    can serve the ride, haven't declined it and aren't already on another
    ride — requester-only, since riders can't see driver_profiles. The
    matching screen then shows one of: searching (normal), **no drivers
    available right now** with the reason spelled out ("no available driver
    can carry a power wheelchair right now"), or **still looking — N min so
    far** once eligible drivers exist but none has accepted after 2 minutes.
    Nothing is auto-cancelled; all three states offer keep waiting (which
    re-checks), book for later, or cancel.
  - **Not built**: widening a radius — there is no geo/proximity anywhere in
    the app.
  - **Scheduled rides wait their turn — DECIDED (round 13)**, in
    `0013_scheduled_rides_lead_time.sql`: a scheduled ride enters the search
    **60 minutes** before its `requested_time` and is invisible to drivers
    until then (same SELECT policy as §3.C2's filtering, so the catch-up
    query, the live feed and accept all agree). Before that the rider sees a
    "Booked for …" state saying nobody is looking yet — not a search that
    can't succeed. Previously a ride booked for tomorrow was broadcast
    immediately, with a 45-second accept window on a ride a day away.
    Consequence: a ride maturing is the passage of time, not a row change,
    so Realtime has nothing to publish — Driver Home re-runs its catch-up
    query every 60s while available. "Book for later" on the matching screen
    now genuinely holds the ride back.
- **Cancellation / no-show policy**: an **extended grace window** (longer
  than typical rideshare, given this audience may be booking around medical
  appointments) during which cancellation is free; cancelling **after** that
  window, or a no-show, incurs a **standard flat fee**. Exact window length
  and fee amount are business-tuning parameters, not blocking for the build —
  model them as configurable constants.
  - **Built in round 16** (`0016_cancellation_policy.sql`). Constants, all in
    that migration: grace **15 minutes** from the moment a driver was matched,
    late-cancellation fee **$12.00**, no-show wait **10 minutes** at pickup,
    no-show fee **$15.00**. Cancelling while still searching is always free —
    nobody was inconvenienced.
  - Both decisions are made **server-side**, in `SECURITY DEFINER` functions
    (`rider_cancel_ride`, `mark_no_show`), using the `ride_events` log (§2.5)
    for the times they depend on. The rider's cancel used to be a direct
    UPDATE, which would have left the fee to whatever the client claimed.
  - `no_show` was a valid status that nothing ever set, so a driver who
    waited and left had no way to end the ride. Now the matched driver can,
    from `arrived` only and only after the wait.
  - The fee is **recorded on the ride** (`fee_cents`, `fee_reason`) and
    nothing charges anyone: there is no payment anywhere in this app.
- **Driver accept/decline window**: **45 seconds** (vs. a typical rideshare's near-instant accept) — a driver here needs time to actually read the rider's `needs_snapshot` and `identification_aid` before committing, not just glance at a pickup pin. Configurable constant, not hardcoded logic.
- **Pricing model — deferred**: fare will eventually depend on rider needs,
  distance, and driver scarcity, but working out that formula isn't needed
  to build the core flows. v1 shows a flat/placeholder fare estimate.

## 5. Still open (non-blocking for a first build)

- **Regulatory framing** — standalone + drivers physically assisting riders
  using mobility aids sits close to Non-Emergency Medical Transport (NEMT),
  which many US states regulate separately from standard rideshare (driver
  background-check depth, insurance class, sometimes state licensing). Fine
  to build as a concept/prototype; flagging so it's a conscious choice if
  this ever moves toward real riders.
- **Exact grace-window length and no-show fee amount** — placeholder
  constants until a real policy is set.

---

## 6. Tech stack (decided)

- **Expo (React Native + Expo Router)** — universal codebase (iOS, Android,
  web via React Native Web). Ship web-first for speed, add native builds
  later with no rewrite. Reason: the entire premise of this product is
  someone holding a phone, so a Next.js-only path would mean a full UI
  rewrite later — Expo avoids that trap.
- **Supabase** — Postgres (fits the relational data model: riders, drivers,
  ride requests, matching filters) + built-in auth + realtime subscriptions
  (live ride status) + file storage (for `identification_aid` photos).
- **Maps/location** — deferred implementation detail. Web build can start
  with something lightweight (Mapbox GL JS, or even just address text + a
  static map). Native builds will likely move to `react-native-maps` or a
  native Mapbox SDK — not a decision that blocks starting the build.
- No marketing/landing site planned yet; if wanted later, that would
  reasonably be a separate lightweight site, not part of the app codebase.

## 7. v1 (build-first) simplifications

- Driver capability = self-attested checkboxes + post-ride ratings feed back
  into a trust score. No real background-check integration yet (stub the
  field).
- Rider need-tags from a fixed small taxonomy (not fully freeform) so
  matching logic stays simple — freeform `standing_notes` still available for
  anything the taxonomy doesn't cover.
- Pickup verification = PIN code + `identification_aid`, shown to the driver.
- Pricing = flat placeholder fare, real model deferred.
