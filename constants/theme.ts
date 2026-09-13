// Design tokens — mirrors the palette/type choices from the wireframes
// (wireframes/*.dc.html use oklch(); hex equivalents here since RN's
// StyleSheet color parser doesn't reliably support oklch()).

export const colors = {
  bg: '#F7F4EF',
  surface: '#FDFCFB',
  surfaceAlt: '#EFEAE3',
  text: '#232838',
  textSecondary: '#5B6272',
  textTertiary: '#969CA8',
  border: '#DEDAD2',

  accent: '#D97748',
  accentDark: '#B85A38',
  accentSoft: '#F5E4DA',

  positive: '#3F9E82',
  positiveDark: '#2E7A63',
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
