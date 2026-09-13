// Formatting + validation for fields that used to accept "a series of
// numbers" with no real check behind them.

export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  const len = digits.length;
  if (len === 0) return '';
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isValidPhone(formatted: string): boolean {
  return formatted.replace(/\D/g, '').length === 10;
}

// Auto-inserts slashes as digits are typed; rebuilding from digits each time
// (rather than patching the string) means backspace naturally un-formats too.
export function formatDobInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length >= 3) out += '/' + digits.slice(2, 4);
  if (digits.length >= 5) out += '/' + digits.slice(4, 8);
  return out;
}

export function isValidDob(value: string): boolean {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return false;
  if (year < 1900) return false;
  const dob = new Date(year, month - 1, day);
  if (dob.getTime() > Date.now()) return false; // no future birthdays
  return true;
}
