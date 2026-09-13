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
  `en-route` → `tracking` → `complete`.
- `app/(driver)/` — the driver-facing flow: `driver-home` (availability
  toggle), `incoming` (a live ride request to accept/decline),
  `driver-profile`.
- `app/_layout.tsx` wraps everything in `AuthProvider` → `ProfileProvider`.

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
  subscription wiring for live matching. Matching is intentionally minimal
  (any available driver sees any `requested` ride — no capability/tag
  filtering yet).
- `validators.ts`, `dateTime.ts`, `format.ts` — input formatting/validation
  (phone auto-format, DOB, scheduling) shared by the profile and booking
  forms.

**Live matching / RLS shape** (see migration comments for the full reasoning
trail — 0002 → 0006 fixed each other's bugs, worth reading in order; note
0005's diagnosis turned out to be wrong, 0006 explains the real cause):
- A driver's availability is a persisted column
  (`driver_profiles.is_available`), not just local state.
- `ride_requests` uses Postgres Realtime; drivers subscribe to see new
  `requested` rows, riders subscribe to see status changes on their own row.
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

**Session storage note**: Supabase auth persists sessions via
`AsyncStorage`, which on web is backed by the browser's `localStorage` —
scoped per browser origin, not per tab. Two tabs of the same browser share
one session, so logging into a second account in another tab clobbers the
first tab's session; use separate browsers/profiles (or a raw `fetch` with
a separately-obtained access token) to simulate two simultaneous users.
