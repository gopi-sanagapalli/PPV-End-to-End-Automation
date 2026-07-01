export interface ParsedDate {
  day: number;
  month: string;
  monthIndex: number;
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export function parsePPVDate(dateStr: string): ParsedDate {
  const normalized = dateStr.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

  const match = normalized.match(/(\d{1,2})\s+([A-Za-z]+)/);

  if (!match) {
    throw new Error(`Unable to parse PPV_DATE: ${dateStr}`);
  }

  const day = Number(match[1]);
  const month = match[2];
  const monthIndex = MONTH_MAP[month.toLowerCase()];

  if (monthIndex === undefined) {
    throw new Error(`Unknown month "${month}"`);
  }

  return {
    day,
    month,
    monthIndex,
  };
}
