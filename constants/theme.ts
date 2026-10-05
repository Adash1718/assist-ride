// Design tokens — mirrors the palette/type choices from the wireframes
// (wireframes/*.dc.html use oklch(); hex equivalents here since RN's
// StyleSheet color parser doesn't reliably support oklch()).

// Contrast is a functional requirement here, not a finish: this app is built
// for riders who include people with low vision. Every pair below that carries
// text was measured against WCAG AA (4.5:1 normal text, 3:1 for control
// boundaries) — see scratchpad/contrast-check.mjs. Six pairs failed and were
// darkened by the smallest amount that passes, keeping the hue:
//   accent        3.07 -> 4.56  (white text on the primary button — every CTA)
//   accentDark    4.50 -> 4.58  (accent-coloured text and links)
//   textTertiary  2.69 -> 4.51  (placeholder text)
//   positiveDark  4.32 -> 4.55  (text in success cards)
// Anything changed here must be re-measured; a palette tweak that looks nicer
// and drops below 4.5:1 is a regression for the people this is built for.
export const colors = {
  bg: '#F7F4EF',
  surface: '#FDFCFB',
  surfaceAlt: '#EFEAE3',
  text: '#232838',
  textSecondary: '#5B6272',
  textTertiary: '#71757E',
  // Decorative separators and card edges — no contrast requirement.
  border: '#DEDAD2',
  // Boundaries that mean something: input outlines, control edges. 3:1 is the
  // WCAG minimum for these, and the soft `border` above is only 1.36:1, which
  // left form fields all but invisible.
  borderStrong: '#8E8C86',

  accent: '#AE5F3A',
  accentDark: '#A45032',
  accentSoft: '#F5E4DA',

  positive: '#3F9E82',
  positiveDark: '#2D7660',
  positiveSoft: '#DEEFE8',

  alert: '#C1543A',
  alertDark: '#9C4230',
  alertSoft: '#F6E1DA',
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 16,
  pill: 999,
} as const;

export const type = {
  // Public Sans isn't preloaded here yet (needs expo-font + a static asset);
  // system fallback keeps everything else about the design intact for now.
  title: { fontSize: 19, fontWeight: '700' as const },
  heading: { fontSize: 22, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  label: { fontSize: 15, fontWeight: '600' as const },
  hint: { fontSize: 13, fontWeight: '400' as const, color: colors.textSecondary },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    color: colors.textSecondary,
  },
};

// Minimum comfortable touch target for this audience (seniors/caregivers) —
// see SPEC.md's "calm, high-contrast, large touch targets" guidance.
export const minTouchTarget = 48;
