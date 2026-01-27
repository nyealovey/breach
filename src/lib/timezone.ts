type LocalParts = {
  hhmm: string;
  localDate: string; // YYYY-MM-DD in the provided timeZone
};

export function getLocalParts(now: Date, timeZone: string): LocalParts {
  // en-CA yields YYYY-MM-DD ordering in formatToParts reliably.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';

  const localDate = `${pick('year')}-${pick('month')}-${pick('day')}`;
  const hhmm = `${pick('hour')}:${pick('minute')}`;
  return { hhmm, localDate };
}

export function localDateToUtcDateOnly(localDate: string): Date {
  // Store as UTC midnight; Prisma maps @db.Date to a date-only column in Postgres.
  return new Date(`${localDate}T00:00:00.000Z`);
}
