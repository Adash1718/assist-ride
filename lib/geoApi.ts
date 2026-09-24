// Geocoding and routing against OpenStreetMap services (migration 0023).
//
// Why these: they need no account and no API key, which keeps the project
// runnable by anyone who clones it. The trade is that they are shared公共
// public services with rate limits and no uptime promise — so every call is
// best-effort, short-timeout, and failure-tolerant. A ride books fine
// without coordinates; screens show nothing rather than something invented.
//
// If this ever goes near production it wants a real provider (or a
// self-hosted Nominatim/OSRM): the public instances explicitly disallow
// heavy use.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

// Nominatim's usage policy requires an identifying UA. Browsers won't let us
// set User-Agent, so the Referer the browser sends is what identifies us
// there; on Node (tests) we can and do set it.
const UA = 'AssistRide/0.1 (student project; contact via repo)';

// Short: a rider waiting on a booking should never be held up by someone
// else's server being slow. Better to book without coordinates.
const TIMEOUT_MS = 6000;

export type GeoPoint = { lat: number; lng: number; label: string };
export type RouteInfo = { meters: number; seconds: number };

async function getJson(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: typeof window === 'undefined' ? { 'User-Agent': UA, Accept: 'application/json' } : { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Timeout, offline, CORS, rate limit — all the same to the caller: we
    // don't know where this is, so we say so by returning null.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Turn what the rider typed into a point. Returns null when the address
// can't be resolved, which is a normal outcome for a half-written address
// and must never block a booking.
export async function geocode(address: string): Promise<GeoPoint | null> {
  const query = address.trim();
  if (query === '') return null;
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&addressdetails=0`;
  const data = await getJson(url);
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: String(hit.display_name ?? query) };
}

// Driving distance and time along real roads — not a straight line, which
// would understate every trip and badly so anywhere with water or one-ways.
export async function route(from: GeoPoint, to: GeoPoint): Promise<RouteInfo | null> {
  const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  const data = await getJson(url);
  const leg = data?.routes?.[0];
  if (!leg) return null;
  const meters = Math.round(Number(leg.distance));
  const seconds = Math.round(Number(leg.duration));
  if (!Number.isFinite(meters) || !Number.isFinite(seconds)) return null;
  return { meters, seconds };
}

// Both ends plus the route between them, for booking. Partial results are
// kept: knowing where the pickup is still helps even if the dropoff didn't
// resolve and there's no route.
export async function locateTrip(
  pickup: string,
  dropoff: string
): Promise<{ pickup: GeoPoint | null; dropoff: GeoPoint | null; route: RouteInfo | null }> {
  // Sequential, not parallel: Nominatim's policy is one request per second,
  // and two at once from every booking is exactly the abuse it asks us to
  // avoid. Two lookups cost about a second — acceptable on a booking tap.
  const from = await geocode(pickup);
  const to = await geocode(dropoff);
  const leg = from && to ? await route(from, to) : null;
  return { pickup: from, dropoff: to, route: leg };
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.1 ? '< 0.1 mi' : `${miles.toFixed(1)} mi`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
