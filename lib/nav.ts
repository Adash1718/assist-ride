import { router, type Href } from 'expo-router';

// Go back, or to `fallback` when there's nothing to go back to.
//
// A screen reached directly rather than by navigating — a pasted/deep link,
// a browser refresh, or one of this app's own `router.replace` redirects
// (Rider Home → matching/en-route, Driver Home → active-ride) — has no
// history behind it. `router.back()` there does nothing at all except log
// "The action 'GO_BACK' was not handled by any navigator", leaving the back
// arrow dead.
export function backOr(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
