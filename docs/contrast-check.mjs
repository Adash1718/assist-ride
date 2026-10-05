// WCAG contrast audit of the palette. Ratios are computed, not eyeballed.
// AA needs 4.5:1 for normal text, 3:1 for large text (>=18.66px bold or 24px)
// and for UI component boundaries.
const C = {
  bg: '#F7F4EF', surface: '#FDFCFB', surfaceAlt: '#EFEAE3',
  text: '#232838', textSecondary: '#5B6272', textTertiary: '#71757E',
  border: '#DEDAD2', borderStrong: '#8E8C86',
  accent: '#AE5F3A', accentDark: '#A45032', accentSoft: '#F5E4DA',
  positive: '#3F9E82', positiveDark: '#2D7660', positiveSoft: '#DEEFE8',
  alert: '#C1543A', alertDark: '#9C4230', alertSoft: '#F6E1DA',
};
const lum = (hex) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// Pairs the app actually renders.
const pairs = [
  ['text on bg', C.text, C.bg, 4.5],
  ['text on surface', C.text, C.surface, 4.5],
  ['textSecondary on surface (hints, 13px)', C.textSecondary, C.surface, 4.5],
  ['textSecondary on bg', C.textSecondary, C.bg, 4.5],
  ['sectionLabel (textSecondary on surface)', C.textSecondary, C.surface, 4.5],
  ['textTertiary on surface (placeholders)', C.textTertiary, C.surface, 4.5],
  ['surface text on accent (primary button)', C.surface, C.accent, 4.5],
  ['accentDark on surface (links)', C.accentDark, C.surface, 4.5],
  ['accentDark on accentSoft (chips)', C.accentDark, C.accentSoft, 4.5],
  ['alertDark on surface (errors)', C.alertDark, C.surface, 4.5],
  ['alertDark on alertSoft (error cards)', C.alertDark, C.alertSoft, 4.5],
  ['positiveDark on positiveSoft (success cards)', C.positiveDark, C.positiveSoft, 4.5],
  ['borderStrong against surface (input outlines)', C.borderStrong, C.surface, 3],
  ['borderStrong against bg', C.borderStrong, C.bg, 3],
  ['accent text on surface (phone links)', C.accent, C.surface, 4.5],
  ['surface text on accent (chat bubble)', C.surface, C.accent, 4.5],
  ['accent against surface (button edge)', C.accent, C.surface, 3],
];
let bad = 0;
for (const [name, fg, bg, need] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${r.toFixed(2)}:1  (needs ${need}:1)`);
}
console.log(`\n${pairs.length - bad} of ${pairs.length} pass`);
