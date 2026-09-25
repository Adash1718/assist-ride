import type { NeedsSnapshot } from './rideApi';

// Fare estimation (SPEC.md §4). Until now the app showed a flat $19.50
// placeholder, which was honest about being fake but useless: a rider booked
// with no idea what the trip cost, while the app could already tell them
// exactly what CANCELLING cost. Since round 23 every ride carries a real
// routed distance and duration, so this can be a real estimate instead.
//
// Nothing bills anyone. This replaces a made-up number with a defensible
// one; payment processing isn't built.

// ---------------------------------------------------------------------------
// What the rider pays
// ---------------------------------------------------------------------------
export const FARE_BASE_CENTS = 350;
export const FARE_PER_MILE_CENTS = 175;
// Deliberately small, and applied to DRIVING time only — see the note on
// riderFareCents below. Distance is the dominant term by design.
export const FARE_PER_MINUTE_CENTS = 20;
export const FARE_MINIMUM_CENTS = 800;

const METERS_PER_MILE = 1609.344;

// The rider's fare depends only on the trip: distance and the routed driving
// time. It does NOT depend on who they are or what help they need.
//
// That's a deliberate constraint, not an oversight. A rider who uses a
// wheelchair, needs a transfer, or is escorted to the door takes longer at
// the kerb — so any fare that meters real elapsed time would charge disabled
// riders more than everyone else for the identical journey. In the US that's
// also specifically prohibited: the ADA bars a provider from passing the cost
// of an accommodation on to the person who needs it (28 CFR 36.301(c)), which
// is why taxi operators can't surcharge for a wheelchair-accessible vehicle.
//
// So the per-minute term uses the ROUTED driving duration — the same number
// for anyone travelling between those two points — and kerb time is never
// metered. The extra work of an assisted ride is paid to the driver instead,
// out of the platform's margin (see driverServicePremiumCents).
export function riderFareCents(routeMeters: number, routeSeconds: number): number {
  const miles = routeMeters / METERS_PER_MILE;
  const minutes = routeSeconds / 60;
  const fare = FARE_BASE_CENTS + Math.round(FARE_PER_MILE_CENTS * miles) + Math.round(FARE_PER_MINUTE_CENTS * minutes);
  return Math.max(FARE_MINIMUM_CENTS, fare);
}

// ---------------------------------------------------------------------------
// What the driver earns on top
// ---------------------------------------------------------------------------
// Paid BY THE PLATFORM, never added to the rider's fare. Two reasons: the
// rider must not be charged for their own access needs (above), and a driver
// who spends fifteen minutes on a transfer shouldn't earn the same as one
// doing a kerbside drop — otherwise drivers drift toward the easy rides and
// the riders this app exists for wait longer.
//
// Fixed amounts per requirement rather than a percentage: predictable, and
// visible on the offer so a driver knows what a ride pays before accepting.
export const PREMIUM_WHEELCHAIR_CENTS = 200;
export const PREMIUM_TRANSFER_CENTS = 200;
export const PREMIUM_ESCORT_CENTS = 150;
export const PREMIUM_CAP_CENTS = 600;

export function driverServicePremiumCents(needs: NeedsSnapshot | undefined): number {
  if (!needs) return 0;
  const assistance = needs.assistanceNeeds ?? [];
  let premium = 0;
  if ((needs.mobilityAid ?? '').toLowerCase().includes('wheelchair')) premium += PREMIUM_WHEELCHAIR_CENTS;
  if (assistance.includes('Help transferring to seat')) premium += PREMIUM_TRANSFER_CENTS;
  if (assistance.includes('Door-to-door escort')) premium += PREMIUM_ESCORT_CENTS;
  return Math.min(PREMIUM_CAP_CENTS, premium);
}

export function driverEarningsCents(fareCents: number, premiumCents: number): number {
  return fareCents + premiumCents;
}

// A one-line explanation of how a fare was reached, for the screens that show
// it. Riders should be able to see why a number is what it is.
export function fareBreakdown(routeMeters: number, routeSeconds: number): string {
  const miles = (routeMeters / METERS_PER_MILE).toFixed(1);
  const minutes = Math.max(1, Math.round(routeSeconds / 60));
  return `$${(FARE_BASE_CENTS / 100).toFixed(2)} base + ${miles} mi + ${minutes} min`;
}
