# Assist Ride — plan for the next sessions

Written 2026-10-05. Read `CLAUDE.md` first, then `docs/SPEC.md`. Current
state: commits through `f10999a`, tree clean, **not pushed**, migrations
`0001`–`0032` all confirmed run against the live Supabase project.

---

## 0. Rebuild the data-layer test suites — IN THE REPO (do this first)

**What happened:** 19 Node test suites (~1900 lines, 317 assertions) lived in
a session scratchpad under `/private/tmp/...`. That directory was swept on
2026-10-02 and they are gone. The app code, migrations and docs survive
because they are in git; the tests did not, because they weren't.

**Do not recreate them in a temp directory.** Put them in `tests/` in the
repo and commit them.

### Target layout

```
tests/
  _harness.mjs        shared: login(), check/section, clearOpenRides(),
                      freshDriver(), crash-aware exit
  <area>-test.mjs     one per area (list below)
  run-all.mjs         runs every suite, prints a per-suite summary + total
```

Add to `package.json`: `"test:data": "node tests/run-all.mjs"`.
They need `--env-file=.env` (or have the harness read `.env` itself) and
`@supabase/supabase-js`, which is already a dependency.

### Harness rules — these were learned the hard way, do not skip

1. **Never `process.exit()` from inside a `finally`.** Every suite used to do
   this, so an exception mid-run printed a tidy "N passed, 0 failed" and
   exited 0. An aborted run was indistinguishable from a clean one, and
   sweeps were read as green for days. Pattern:

   ```js
   let crashed = null;
   try { /* checks */ } catch (err) { crashed = err; } finally { /* cleanup */ }
   if (crashed) console.error(`\nCRASHED: ${crashed.message}`);
   console.log(`\n${pass} passed, ${fail} failed${crashed ? ' — RUN ABORTED' : ''}`);
   process.exit(fail || crashed ? 1 : 0);
   ```

2. **Reputational or immutable data never goes on the shared accounts.**
   `ride_feedback` and `ride_incidents` have no DELETE policy. A suite that
   writes either to `assistride.e2e.driver@…` or `…driver2@…` permanently
   changes their rating order or blocks a pairing, which silently breaks
   other suites. Sign up a throwaway driver per run instead:

   ```js
   const email = `assistride.e2e.<area>.${Date.now().toString(36)}@mailinator.com`;
   // signUp with options.data.role = 'driver', then insert a driver_profiles row
   ```

3. **Assert properties, not ambient state.** `rank-test` used to assume "d1
   has the better rating (from the feedback tests)". When other suites began
   leaving ratings, the order inverted and it failed for reasons unrelated to
   ranking. Read both aggregates and assert *the better-rated one wins*.

4. **Wait for conditions, not fixed delays.** The Realtime assertion waited a
   flat 3s: it passed alone and failed under full-sweep load. Poll until the
   condition holds with a ceiling (15s).

5. **Matching has FIVE gates.** A driver sees an open ride only if they can
   serve it (0010), haven't declined it (0006), aren't blocked by that rider
   (0032), it's inside its lead window (0013) and offer radius (0027), *and*
   their rank has come up (0015). Two are time-based. When a test needs a
   specific driver to take a ride, **take every other driver offline** —
   otherwise the rank stagger makes a fresh ride invisible to whoever ranks
   second, and the failure looks like a bug in whatever you were testing.

### Suites to rebuild, and what each asserted

Migration comments are detailed and are the best spec; `docs/SPEC.md` has the
product reasoning. Rough coverage (original check counts in brackets):

| suite | covers | migrations |
|---|---|---|
| `scheduled` [17] | scheduled rides invisible until the 60-min lead window | 0013 |
| `nomatch` [22] | eligible-driver count, "nobody is coming", rescheduling | 0011 |
| `rank` [17] | capability beats rating; 45s stagger; busy/offline unranked | 0015 |
| `feedback` [17] | one immutable rating per ride; driver aggregate only | 0014 |
| `policy` [16 fast / +SLOW] | 15-min cancel grace, $12 late fee, 10-min no-show, $15 | 0016 |
| `proxy` [23] | invite/accept/revoke; proxy books, tracks, cancels | 0017 |
| `hardening` [23] | pins in `ride_pins`, 5-attempt lock, riders can't set status | 0018/0019 |
| `emergency` [20] | contacts to the matched driver at pickup only; access log | 0020/0025 |
| `quote` [14 + SLOW] | `cancel_quote` equals what `rider_cancel_ride` charges | 0021 |
| `message` [18] | per-ride thread; outsiders blocked; sender can't be forged | 0022 |
| `geo` [16] | coordinate columns, CHECK constraints, Nominatim/OSRM live | 0023 |
| `location` [14] | driver location private; proximity ranking; stale ignored | 0024 |
| `fare` [12] | **identical trips cost the same regardless of needs** | 0026 |
| `radius` [16] | radius widens, never excludes a driver who can't be measured | 0027 |
| `reissue` [14] | rider escapes the PIN lockout; driver cannot | 0028 |
| `attest` [9] | capability declaration persists; riders never see it | — |
| `contradiction` [18] | tags suppressed on contradicting evidence; recoverable | 0029/0030 |
| `correction` [13] | 24h feedback edit window; identity columns pinned | 0031 |
| `incident` [18] | report blocks that pairing; driver can't read reports | 0032 |

**The two highest-value assertions to restore first**, because they encode
decisions rather than mechanics:

- `fare`: two identical trips — one with no needs, one with wheelchair +
  transfer + escort — must produce **the same rider fare** and different
  driver pay. A future "charge for wait time" change breaks this silently.
- `contradiction`: a driver must *not* be suppressed on evidence from rides
  where the capability was never needed, nor on fewer than six such rides.

**Acceptance:** `npm run test:data` prints a per-suite summary and a total,
exits non-zero if anything fails or aborts, and the whole thing is committed.

---

## 1. Ride history (build after the tests exist)

**Why it matters:** the app charges a $12 late-cancellation fee and a $15
no-show fee, and **there is nowhere a rider can see they were charged**. It
also stores fares, feedback and incident reports that the rider can never
look back at. For riders whose trips are booked by a caregiver, neither party
has any record.

**No migration needed** — RLS already lets the rider and the booking proxy
read their own rides (`0017` widened it to `requested_by = auth.uid() or
rider_id = auth.uid()`). Verify that before assuming.

Build:
- `app/(rider)/history.tsx`: past rides (`completed`, `cancelled`, `no_show`),
  newest first, paginated. Each row: date, pickup → dropoff, status, the
  **fare estimate**, and **any fee charged with its reason** stated plainly
  ("$12.00 late-cancellation fee"). Link each to the existing
  `tracking.tsx` timeline.
- Entry point from rider home.
- `lib/rideApi.ts`: `fetchRideHistory(userId, { limit, before })`.
- Keep the existing honesty rules: a ride with no route has no fare — say so
  rather than showing $0.

**Acceptance:** a rider who was charged a late-cancellation fee can find that
charge in the app; a proxy sees the rides they booked.

---

## 2. Screen-reader testing — needs a human, cannot be automated

Round 33 proved every element is *named* (via the browser accessibility
tree). Nobody has proven the app is *usable* with a screen reader, and for
this product that is the real test. Suggested pass, ~30 minutes with
VoiceOver (⌘F5 on macOS):

1. Sign in, book a ride end to end **without looking at the screen**.
2. Check the pickup PIN reads out digit by digit ("6 1 7 2"), not as a number.
3. Confirm "Your driver has arrived" announces itself without re-navigating.
4. Walk the profile form: does each field announce its own label and error?
5. Try the report flow and the feedback stars.

Record what was confusing. Known rough edge already: single-choice
mobility-aid chips announce as *checkboxes* rather than radios
(`components/ui.tsx`, `Chip`) — a `role` prop would fix it.

---

## 3. Small, well-understood fixes

- **Chips as radios** — see above. `Chip` needs an optional role so
  single-select groups announce correctly.
- **ETA freshness** — the rider's "About 6 min away" can be ~75s stale (45s
  write throttle + 30s refresh) and says nothing about its own age. Add "as
  of N minutes ago" when the position is old. (Accepted as a known gap
  2026-09-24.)
- **Driver can't go offline mid-ride** — Driver Home shows "You're on a ride"
  instead of the availability toggle, so a driver finishing their shift can't
  stop new offers for after this ride.

---

## 4. Decisions needed from the user — don't guess these

- **Payments.** Fares and fees are computed and recorded; nothing charges
  anyone. Permanently out of scope, or wire Stripe?
- **Push notifications.** Deferred four times for one honest reason: delivery
  can't be verified on web. Needs a native/dev build before building, or an
  explicit decision to ship unverified.
- **Driver vetting.** Capability claims are self-declared; the app now says
  so plainly and suppresses contradicted claims, but there is no identity or
  licence check. Out of scope for coursework, or worth a design?
- **Incident escalation.** A report blocks the pairing and is recorded.
  There is deliberately no automatic suspension — that needs a human
  reviewer, and inventing a fake one would be worse.

---

## House rules for whoever works on this

- **Migrations are applied by hand.** Write the next numbered file, put it on
  the clipboard with `pbcopy` **run with the sandbox disabled** (a sandboxed
  shell has its own pasteboard that dies with the process — it will look like
  it worked and the user's clipboard will be untouched), verify with a
  *separate* unsandboxed `pbpaste | wc -c`, then **wait for confirmation that
  it ran** before testing against it. Prefer `create or replace` / `if not
  exists`; guard `alter publication … add table` so the file is re-runnable.
- **Verify the object exists** from Node afterwards rather than trusting
  "success" — a stale clipboard once caused an old migration to be re-run and
  reported as the new one.
- **Check the blast radius of any DELETE** before handing it over. A repair
  migration once nearly wiped 40 of 41 feedback rows when 14 were intended.
- **The app must not claim what it doesn't do.** This project has repeatedly
  found features that were pure theatre: a capability check that saved
  nothing, "contact support" with no support, standing notes collected and
  never shown, a fare that was a hard-coded placeholder. When writing copy,
  check the thing it promises actually happens.
- **Browser testing**: click by **coordinate**, not element ref — ref clicks
  don't reliably fire React Native Web press handlers, and typing via refs
  doesn't land in `TextInput`s at all.
- **Re-run `node docs/contrast-check.mjs` after any palette change.** A
  colour tweak that looks nicer and drops below 4.5:1 is a regression for the
  people this app is built for.
