type DateParts = {
  year: number;
  month: number;
  day: number;
};

export type ParsedItineraryTimeToken = {
  hour: number;
  minute: number;
  dayOffset: number;
};

function parseDateParts(date: string): DateParts {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    throw new Error(`Invalid itinerary date: ${date}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function dayDelta(from: DateParts, to: DateParts): number {
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day);
  const toUtc = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((fromUtc - toUtc) / (24 * 60 * 60 * 1000));
}

export function parseItineraryTimeToken(
  token: string,
  input?: { baseDate?: string },
): ParsedItineraryTimeToken {
  const match = token
    .trim()
    .match(
      /^(?:(\d{4})-(\d{2})-(\d{2})\s+)?(\d{1,2}):(\d{2})(?:\s*\(\+(\d+)\))?$/u,
    );
  if (!match) {
    throw new Error(`Invalid itinerary time: ${token}`);
  }

  const explicitDate =
    match[1] && match[2] && match[3]
      ? {
          year: Number(match[1]),
          month: Number(match[2]),
          day: Number(match[3]),
        }
      : null;

  const baseDayOffset =
    explicitDate && input?.baseDate
      ? dayDelta(explicitDate, parseDateParts(input.baseDate))
      : 0;

  return {
    hour: Number(match[4]),
    minute: Number(match[5]),
    dayOffset: baseDayOffset + Number(match[6] ?? "0"),
  };
}
