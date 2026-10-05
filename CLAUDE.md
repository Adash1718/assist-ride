# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Assist Ride — a specialized rideshare app (Expo/React Native) for riders who
need physical or communication assistance, matched with drivers who can
provide it. Full product spec, data model, and decision log lives in
`docs/SPEC.md` — read it before making product/schema decisions, and update
it when a decision is made or a milestone lands. (It used to live one level
up at `../SPEC.md`, shared with a sibling homework folder; that copy is now
a snapshot left in place for the sibling folder. `docs/SPEC.md` is the one
to edit.)

## Commands

- `npm run web` — start the Expo dev server for web (port 8081). This is the
  primary way to run the app during development.
- `npm run ios` / `npm run android` — start for native simulators.
- `npm start` — plain `expo start` (choose platform from the Expo CLI menu).
- There is no configured lint or test command (no `lint`/`test` script in
  `package.json`, no test files in the repo) — don't assume one exists.

Metro's incremental bundler has a history of going stale after edits to
hooks/effects in this app — if a change doesn't seem to take effect, or an
error doesn't match current source, restart the dev server before assuming
it's a real bug.

## Environment / Supabase setup

Real Supabase project, not a mock. Config comes from `.env`
(`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`; gitignored,
Expo only reads it at startup — restart after editing). `lib/supabase.ts`
falls back to a syntactically-valid placeholder URL/key when unset, so a
missing `.env` degrades to failed network calls rather than crashing the
app at import time. One-time project setup steps are in
`README-SUPABASE.md`.

**Migrations are applied by hand, not by tooling**: `supabase/migrations/*.sql`
are numbered, sequential, and meant to be pasted into the Supabase SQL
Editor one at a time — there's no CLI/migration runner wiring them up. A
file existing in this repo does **not** mean it has been run against the
live project. Always check the highest-numbered file here, and confirm with
the user which have actually been executed, before writing a new migration
or assuming a given schema/policy is live.

## Architecture

**Routing**: Expo Router, file-based, under `app/`. Route groups partition
the app by phase/role rather than by feature:
- `app/(auth)/` — sign-in/sign-up (Supabase email/password).
- `app/(onboarding)/` — post-signup profile creation for each role
  (`rider.tsx`, `driver.tsx`) plus the driver's self-attested capability
  check (`driver-verification.tsx`).
- `app/(rider)/` — the rider-facing flow: home → `book` → `matching` →
  `en-route` → `tracking` → `complete`. Rider Home sends a rider whose ride
  is still going straight back to it (`requested` → `matching`; matched
  through `in_progress` → `en-route`) instead of offering "Book a Ride" —
  the rider-side counterpart of the driver double-booking fix (runs in
  `useFocusEffect`, same reason as Driver Home). A rider cancel lands on
  Home with a "Your ride was cancelled" notice (`?notice=cancelled`).
  `matching` has three states, driven by
  `countEligibleDriversForRide()` (0011) plus the ride's age: searching,
  "no drivers available right now" (count 0 — it names the blocking need),
  and "still looking — N min" after 2 minutes when eligible drivers do
  exist. It never auto-cancels; the rider can re-check, cancel, or move the
  same ride row to a scheduled time (`rescheduleRideRequest`). A fourth
  state covers a scheduled ride before its lead window (0013): nobody can
  see it yet, so it says so and doesn't run the driver count. "Still
  looking" counts from `searchStartedAt()`, not from booking — a ride
  scheduled for tomorrow hasn't been searching since today.
  `tracking` is the ride's timeline for whoever booked it (SPEC.md §3.F —
  the rider today, a linked proxy once those exist), built from the
  `ride_events` log (0009) and reachable from `en-route` and `complete`.
  It shows no ETA on purpose: there's no routing/map data behind it.
- `app/(driver)/` — the driver-facing flow: `driver-home` (availability
  toggle), `incoming` (a live ride request to accept/decline),
  `active-ride` (matched → en route → arrived/PIN → in progress →
  completed), `driver-profile`. A driver with an active ride is always
  sent to `active-ride` and offered nothing new. Driver Home's matching
  runs in `useFocusEffect`, not `useEffect` — it stays mounted under the
  screens pushed on top of it, and a mounted-but-unfocused subscription
  would keep offering rides from underneath (double-booking). Leave
  `incoming`/`active-ride` with `router.dismissTo('/(driver)/driver-home')`
  so the existing Driver Home regains focus instead of a new one stacking.
  Before pickup a driver can hand a ride back (`driverCancelRide` →
  `driver_cancel_ride`, 0008): the ride isn't ended but goes back to
  `requested` with this driver in `declined_driver_ids`, so other online
  drivers get it, and the rider's `en-route` says "your driver had to
  cancel" and returns to `matching` (`?notice=driver_cancelled`).
- `app/_layout.tsx` wraps everything in `AuthProvider` → `ProfileProvider`.
- Back arrows call `backOr(fallback)` (`lib/nav.ts`), never `router.back()`
  directly. Screens here are routinely reached with no history behind them —
  a direct URL or refresh, or one of the app's own `router.replace`
  redirects (Rider Home → matching/en-route, Driver Home → active-ride) —
  and `back()` there does nothing but log "The action 'GO_BACK' was not
  handled by any navigator", leaving the arrow dead.

**Two separate pieces of client state, not one** — don't conflate them:
- `contexts/AuthContext.tsx` — real Supabase session/auth state (`role` comes
  from `user_metadata.role` set at sign-up).
- `contexts/ProfileContext.tsx` — in-memory (non-persisted) form state for
  the rider/driver profile being edited in the current session.
  `lib/profileApi.ts` is the bridge that reads/writes this shape to the
  actual `rider_profiles`/`driver_profiles` tables — the context itself
  holds no truth, it's UI-form state.

**`lib/` helpers**:
- `supabase.ts` — the client singleton (see Environment above).
- `profileApi.ts` — profile + emergency/medical contact CRUD.
- `rideApi.ts` — ride request CRUD, status transitions, and the Realtime
  subscription wiring for live matching. Which rides a driver may see is
  **not** decided here: `driver_can_serve()` (0010) is enforced in the
  drivers' SELECT policy, so the catch-up query and the live feed filter
  themselves (SPEC.md §3.C2 lists the hard rules vs the advisory ones).
  Ranking between eligible drivers doesn't exist yet — first come, first
  served.
- **Assume any client can call the API with its own token** — the screens are
  not the security boundary. Round 18 closed three places where they were
  being treated as one: the pickup pin (now in `ride_pins`, unreadable by
  drivers, checked by `start_ride_with_pin`, which is also the only way to
  reach `in_progress`); riders setting arbitrary statuses (their UPDATE
  policy is now limited to still-`requested` rides and can't change status
  at all); and riders reading a driver's whole profile row, licence number
  included, because RLS can't restrict columns — `matched_driver_public()`
  returns the five fields the screens show, and the old policy is
  `using (false)`.
- A wrong pin RETURNS a result rather than raising (0019): raising rolls the
  transaction back, which silently undid the attempt counter and made the
  lockout a no-op. Anything that must persist alongside a rejection has the
  same problem.
- **A `finally` that calls `process.exit` will swallow crashes.** Every suite
  did this: an exception mid-run printed a tidy "N passed, 0 failed" and
  exited 0, so an aborted run was indistinguishable from a clean one. Found
  when a suite reported "1 passed, 0 failed" while actually dying on its
  second step. All suites now catch, print `CRASHED:`, mark the summary
  "RUN ABORTED" and exit non-zero. Any new suite must do the same — a harness
  that reports success on a crash is worse than no harness.
- **Don't assert on ambient state another suite happens to create.**
  `rank-test` assumed "d1 has the better rating (from the feedback tests)".
  Once other suites started leaving ratings, the order inverted and it failed
  for reasons unrelated to ranking. It now READS both aggregates and asserts
  the property ("the better-rated one wins", whoever that is).
- **A test that permanently damages shared state is not a test.** The
  contradiction suite put six real 1-star ratings on the shared driver2
  account, which suppressed a capability for 60 days — and feedback is
  immutable, so undoing it needed a migration. It now signs up a THROWAWAY
  driver per run. Anything writing immutable or reputational data must not
  use the shared accounts.
- **This app is FOR people who use screen readers, so accessibility props are
  load-bearing, not polish.** Round 29 added them at the primitives in
  `components/ui.tsx` (every `IconButton` takes a `label`; `SectionLabel` and
  `TopBar` titles are headers; selectable `Chip`s are checkboxes with
  `accessibilityState`; `SegmentedControl` is a radiogroup; `Stepper` names
  what it counts; `Avatar` and decorative icons are hidden), so new screens
  inherit most of it. Two app-specific rules:
  the rider's PIN is announced as ONE element read digit by digit ("6 1 7 2"),
  because four unlabelled boxes left a blind rider unable to say their own
  PIN aloud; and anything that CHANGES while you're looking at it needs a live
  region — ride status is `polite`, errors are `assertive` alerts, since "3
  tries left" is useless if it only appears on screen.
  **Round 33 finished the pass**: every `TextInput` in the app now carries an
  `accessibilityLabel` (a visible `<Text>` above a field is not associated
  with it for a screen reader — the field announced as a bare edit box), the
  steppers name what they count, and chips/segments were raised to a 44px
  minimum touch target from ~38px.
  **Contrast is measured, not eyeballed**: `docs/contrast-check.mjs` computes
  WCAG ratios for every pair the app renders. Six failed, including white
  text on the primary button (3.07:1 — every CTA in the app) and input
  outlines at 1.36:1. The palette was darkened by the smallest amount that
  passes, hue kept; `borderStrong` now marks control boundaries as distinct
  from decorative card edges. Re-run that script after ANY palette change —
  a tweak that looks nicer and drops below 4.5:1 is a regression for the
  people this app is for.
  Still not done: never tested with a real screen reader (the accessibility
  tree proves elements are named, not that the experience is good), and the
  mobility-aid chips announce as checkboxes though only one can be chosen.
- **A flapping check is worse than a missing one.** `message-test`'s Realtime
  assertion waited a flat 3s: it passed alone and failed under the load of a
  full sweep, which trains you to shrug at red. It now polls for the
  condition with a 15s ceiling. Wait on the state you care about, not a
  guessed delay.
- **Never promise support that doesn't exist.** "Contact support" appeared in
  four places with no support behind it anywhere; the worst was the PIN
  lockout, which permanently bricked a ride at the kerb. 0028 gives the RIDER
  (not the driver — that would undo the lockout) a "get a new PIN" escape.
  Before writing copy that refers a user somewhere, check the somewhere
  exists.
- **Matching has FOUR independent gates, and a test that confuses them looks
  like a bug.** A driver sees an open ride only if: they can serve it (0010),
  haven't declined it (0006), it's in its lead window (0013), it's within the
  widening radius (0027), AND their rank has come up (0015). Two of those are
  time-based, so "why can't this driver see the ride?" is rarely one answer —
  the radius suite initially failed because a fresh ride is invisible to the
  second-ranked driver no matter how close they are. Isolate one gate at a
  time (take the other driver offline, or age the ride) rather than asserting
  visibility and assuming which gate caused it.
- **A "resume your ride" redirect must have a way out.** Both Homes send a
  user with a live ride straight back to it on every focus. Home is also the
  only route to sign-out and the profile, so for a while the ride screen was
  a dead end whose only exits ended the ride — the rider had to cancel (and
  eat the $12 late fee) to sign out, and the driver's screen had no back
  arrow at all. Fixed with an explicit `stay=1` param: the back arrow
  navigates to Home with it, Home honours it by skipping the redirect and
  offering "Back to your ride" instead. Anything that force-redirects on
  focus needs the same escape hatch.
- Money-ish decisions are made in the database, never in a screen: the
  rider's cancel goes through `rider_cancel_ride` (0016), which decides from
  the `ride_events` log whether the 15-minute grace window has passed, and
  `mark_no_show` enforces "matched driver, at pickup, waited 10 minutes".
  Clients only mirror the constants (`CANCEL_GRACE_MINUTES` and friends in
  `rideApi.ts`) for wording. Nothing charges anyone — the fee is recorded on
  the ride. **A screen must never be more optimistic than the server about a
  fee**: en-route decided "this cancel is free" from `matchedAt` (a
  best-effort `fetchRideEvents` whose error was discarded) and a
  timer-updated `now` (which a throttled background tab leaves minutes
  behind). Either being wrong showed "Free to cancel", skipped the
  confirmation, and cancelled on one tap while the server charged $12.
  **0021 removed the second implementation rather than patching it**: the
  rule now lives once, in `cancel_decision()`, and both `cancel_quote()` (a
  read that charges nothing) and `rider_cancel_ride()` call it, so they
  cannot disagree. The screen asks for a quote and displays the answer — it
  does not work fees out. It still fails safe on top of that (confirmation
  required unless it can prove the window is open, `Date.now()` read fresh
  at tap time, a quoted fee outranking the local clock), because a quote can
  always be missing. Anything else that duplicates a server-side money rule
  should be collapsed the same way.
- `proxyApi.ts` — proxy links (0017): who may book for a rider, and who a
  rider books for. Two directions of the same table; RLS decides which rows
  come back, so `fetchLinksForMe()` is the same query either way. A ride
  booked by a proxy has `requested_by` = the proxy and `rider_id` = the
  rider, and **both** can see and cancel it — anything that scopes rides to
  one person needs both columns (`fetchActiveRideForRider` does).
- Emergency contacts are readable by the **matched driver only between
  `arrived` and `in_progress`** (0020), via `ride_emergency_contacts()` —
  name and phone, never the contact's address or email, since RLS can't
  restrict columns. Every read logs a row to `emergency_contact_access`,
  which the rider can read and nobody can write through the API. Two
  consequences for anything built on top: the function is **volatile, not
  stable**, because it writes; and the driver's card must stay behind a
  deliberate tap, because fetching on render would log views that never
  happened and make the rider-facing notice a lie. This grant is drivers
  only — 0017 still keeps proxies away from these, and the People screen
  says so.
- `locationApi.ts` — live driver position (0024), the basis of proximity
  ranking and the rider's pickup ETA. Sharing is tied to the availability
  toggle (keyed off the DB-confirmed flag, so it resumes on reload), and
  going offline DELETES the row rather than letting it age out. One row per
  driver, overwritten — there is no location history anywhere, deliberately.
  Nobody reads the raw row but the driver: ranking uses it only inside
  `SECURITY DEFINER` functions, and the rider gets coordinates through
  `driver_location_for_ride` only while a driver is on the way to them (not
  before a match, not once they're in the car).
  **Scoring ratio matters**: proximity is worth up to 8 points and capability
  matches 10 each, so being *close* can never outrank being *able* — a nearby
  driver who can't take a wheelchair still loses to a capable one further
  out. No location scores 4 (mid-range), so declining the permission is
  neutral, never a penalty.
  **Known gap (accepted 2026-09-24)**: the ETA can be ~75s stale (45s write
  throttle + 30s refresh) and says nothing about its own freshness, and a
  backgrounded Chrome tab throttles both timers so it can be much worse. On
  native this is a non-issue; on web it's real.
- `fare.ts` — the fare estimate (0026). **The rider's fare must never depend
  on their needs.** It's computed from distance and the *routed driving
  duration* only, so kerb time is structurally unmeterable: an assisted ride
  takes longer to board, and charging for that would mean disabled riders pay
  more for the same journey — which the ADA also prohibits
  (28 CFR 36.301(c)). The extra work is paid to the DRIVER as a
  platform-funded premium instead, never added to the fare. `fare-test.mjs`
  asserts this directly (identical trips, wildly different needs, same rider
  fare), because it is exactly the property a future "charge for wait time"
  change would quietly break. The quote is stored on the ride at booking so
  later rate changes can't rewrite history, and a ride with no route has no
  price rather than a guessed one.
- `geoApi.ts` — geocoding (Nominatim) and routing (OSRM) over the public
  OpenStreetMap services: no API key, so the project stays runnable by anyone
  who clones it, at the cost of rate limits and no uptime promise. Every call
  is short-timeout and returns null on any failure, and **every geo column in
  0023 is nullable**: a ride books without coordinates rather than failing,
  and screens show nothing rather than a guess (the rule that got the
  invented "~8 min" deleted in round 17).
  **The trap to know about**: Nominatim always returns its best guess and
  never says "I'm not sure" — `5 Oak Avenue` resolves confidently to a street
  in Enfield, London. So the booking screen looks the address up on blur and
  shows the matched result back to the rider, who is the only one who can
  tell a right match from a wrong one. Never use a geocode result silently.
  Lookups are sequential, not parallel: Nominatim's policy is one request per
  second.
- `messageApi.ts` — the per-ride message thread (0022), and the reason there
  is no phone number anywhere in this app. Readable by the rider, the matched
  driver **and the proxy who booked**; `sender_id` is pinned to `auth.uid()`
  inside the INSERT policy, so a client can't post as the other party. No
  UPDATE/DELETE policies — messages are a record. Sending stops when the ride
  ends (`ride_accepts_messages`), reading doesn't. Both participants keep
  passing the SELECT policy for the whole ride and after, so unlike the offer
  screen there's no Realtime visibility cliff to poll around. One shared
  screen (`app/chat.tsx`) serves both sides; the only difference is whose
  bubbles sit on the right, and two copies of a chat is two places to drift.
- `feedbackApi.ts` — post-ride feedback (0014): one immutable row per ride,
  written by the requester only after the ride is `completed`. Drivers can't
  read rows at all — `fetchMyDriverRating()` gives a driver their own
  aggregate and nothing else. A duplicate submit surfaces as 23505, not a
  silent overwrite.
- `useLiveRide.ts` — one ride kept current from a fetch plus its Realtime
  subscription (used by `matching`, `en-route`, `active-ride`). Once a live
  event has arrived it wins over the fetch. Don't merge by "furthest
  status": a driver cancel moves a ride backwards to `requested`.
- `validators.ts`, `dateTime.ts`, `format.ts` — input formatting/validation
  (phone auto-format, DOB, scheduling) shared by the profile and booking
  forms.

**Live matching / RLS shape** (see migration comments for the full reasoning
trail — 0002 → 0006 fixed each other's bugs, worth reading in order; note
0005's diagnosis turned out to be wrong, 0006 explains the real cause):
- A driver's availability is a persisted column
  (`driver_profiles.is_available`), not just local state.
- `ride_requests` uses Postgres Realtime; drivers subscribe to rides that
  become `requested` (INSERTs, plus UPDATEs — a ride handed back by its
  driver), riders subscribe to see status changes on their own row.
- Realtime delivers a change only if the subscriber can still SELECT the
  row afterwards (RLS is checked per subscriber). So a driver looking at an
  open offer never hears that the rider cancelled or another driver claimed
  it — the row just became invisible to them; `incoming.tsx` re-checks the
  ride every 2s instead. (Observed while testing: in a hidden, unfocused
  Chrome tab, live updates and timers can land well after the fact — test
  screens with the tab in the foreground.)
- **ProfileContext is in-memory, and any screen that SAVES must load before
  it renders.** `profile.tsx` rendered the rider form straight from context,
  so a refresh or a direct URL showed a blank form — and that form writes.
  Retyping a name and phone over it would have saved empty needs and an empty
  standing note over the real profile, which is what every driver is matched
  against. It now fetches when context is empty and renders nothing until it
  has (`book.tsx` already did this). Applies to any future editing screen.
- **A disclosure and the function it describes have to change together.**
  The profile screen tells riders exactly what a driver can see; 0025 added
  `relationship` to `ride_emergency_contacts()` and the copy still said "name
  and number". Whenever that function's payload changes, the wording on the
  profile screen changes in the same commit — otherwise the promise quietly
  becomes false.
- **When a suite fails right after an unrelated change, suspect the test's
  assumption before the app.** Three times now the "regression" was a stale
  expectation: a ride gone invisible under 0013's lead window, a plain status
  update silently blocked by 0018, and `feedback-test` demanding a strict
  decrease in an average that rounds to 1dp after 17 accumulated ratings
  (feedback is immutable, so the data only grows). Check what the test
  assumed about the world, then hunt the bug.
- That 2s re-check has three outcomes, not two: gone, still open, **or
  already mine**. The third one was missed at first — the poll exempted
  "matched to me" from its gone-check, so the offer stayed up on a ride the
  driver already had and the 45s expiry then called `declineRideRequest` on
  their own ride. Reachable whenever an accept lands on another tab or
  device. `incoming.tsx` now routes to the active ride on load, on poll, and
  on expiry (re-reading first, to cover the gap between the two timers). The
  database refused the bogus decline anyway — `decline_ride_request` only
  touches `requested` rides — which is why it stayed invisible for so long.
- Availability checks run through a `SECURITY DEFINER` SQL function
  (`is_available_driver`), not a direct RLS-to-RLS query — a direct cross-
  table policy reference between `driver_profiles` and `ride_requests`
  caused infinite RLS recursion (42P17); the function breaks that cycle.
- Declines are tracked in a `declined_driver_ids` uuid array, appended via
  an atomic RPC (`decline_ride_request`) rather than read-modify-write, to
  avoid a race between concurrent decliners on the same ride. The RPC is
  `SECURITY DEFINER` with its own auth checks (0006) — it can't be a plain
  RLS-governed UPDATE, see next point.
- RLS gotcha that bit this schema: when an `UPDATE` reads the table's
  columns (a `WHERE`/`RETURNING`), Postgres also requires the **updated row
  to still pass the table's SELECT policies**, and raises 42501 ("new row
  violates row-level security policy") if it doesn't. So an update that
  makes a row invisible to its own writer (e.g. a driver adding themselves
  to `declined_driver_ids`, which the SELECT policy hides) can never work
  through RLS — use a `SECURITY DEFINER` function for it instead. (Multiple
  permissive policies' `WITH CHECK`s are simply ORed; 0005 assumed
  otherwise and changed nothing.)
- An `UPDATE` that matches zero rows (lost race, RLS-filtered) is **not** an
  error from PostgREST — chain `.select()` and check the returned rows when
  success matters (see `acceptRideRequest`).
- Which open rides a driver sees is decided entirely by that one SELECT
  policy, now four conditions deep: available (0002), not declined (0004),
  can actually serve it (`driver_can_serve`, 0010), inside a scheduled
  ride's lead window (0013), and ranked highly enough for the ride's age
  (`driver_offer_rank` <= 1 + floor(age/45s), 0015). Two of those turn on
  the clock rather than a row change, so Realtime can't announce them —
  that's why Driver Home re-runs its catch-up query every 20s.
- `ride_events` (0009) is the status history, written **only** by the
  `log_ride_event` trigger: it has no client INSERT/UPDATE/DELETE policies,
  so the log can't be forged or rewritten. Reads are limited to the ride's
  `requested_by` and its *current* `matched_driver_id` — so a driver who
  hands a ride back loses access to that ride's history, and the rider can
  no longer read that driver's profile either (an older "matched with…" step
  then reads "Driver assigned").

**Session storage note**: Supabase auth persists sessions via
`AsyncStorage`, which on web is backed by the browser's `localStorage` —
scoped per browser origin, not per tab. Two tabs of the same browser share
one session, so logging into a second account in another tab clobbers the
first tab's session; use separate browsers/profiles (or a raw `fetch` with
a separately-obtained access token) to simulate two simultaneous users.
