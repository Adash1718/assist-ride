// Computes avatar initials from a full name — falls back to a placeholder
// glyph when no name has been entered yet (profiles no longer start
// pre-filled with a demo name).
export function initialsFrom(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}
