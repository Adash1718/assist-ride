# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Assist Ride — a specialized rideshare app (Expo/React Native) for riders who
need physical or communication assistance, matched with drivers who can
provide it. Full product spec, data model, and decision log lives in
`../SPEC.md` (one level up, shared with a sibling homework folder) — read it
before making product/schema decisions, and update it when a decision is
made or a milestone lands.

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
