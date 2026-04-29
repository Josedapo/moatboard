// Pure derivation of when a fund is next expected to file its 13F-HR,
// given the period_of_report of its most recent filing.
//
// SEC rule (13F-HR): institutional investment managers must file within
// 45 calendar days after the end of each calendar quarter. Quarter ends
// are fixed: Q1 = March 31, Q2 = June 30, Q3 = September 30, Q4 =
// December 31. So given the latest period_of_report, the next one is
// the immediately-following quarter end, and the deadline is that end
// plus 45 days.
//
// We don't know the EXACT date a particular fund will file (Berkshire
// often waits to day 44; quants tend to file early), only the deadline.
// Status = how the deadline relates to today:
//   · 'overdue'  — deadline < today and we still don't have the filing
//   · 'imminent' — deadline within the next 30 days
//   · 'upcoming' — deadline more than 30 days out

const FILING_DEADLINE_DAYS = 45;
const IMMINENT_WINDOW_DAYS = 30;

export type NextFilingExpectation = {
  nextPeriod: string; // YYYY-MM-DD of next quarter end
  deadline: string; // YYYY-MM-DD of the 45-day deadline
  daysUntilDeadline: number; // negative when overdue
  status: "overdue" | "imminent" | "upcoming";
};

export function nextExpected13FDeadline(
  latestPeriodOfReport: string,
  today: Date = new Date(),
): NextFilingExpectation {
  const [y, m] = latestPeriodOfReport.split("-").map(Number);

  // Snap to next quarter end. Latest is always a quarter end (the SEC
  // doesn't accept anything else for 13F), so adding 3 months and using
  // the last day of that month is correct.
  const monthZeroIdx = m - 1; // 0-11
  const rawNextMonth = monthZeroIdx + 3;
  const nextMonth = rawNextMonth % 12;
  const nextYear = rawNextMonth >= 12 ? y + 1 : y;
  // Last day of month = day 0 of the following month in UTC.
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const nextPeriod = new Date(Date.UTC(nextYear, nextMonth, lastDay));

  const deadline = new Date(nextPeriod);
  deadline.setUTCDate(deadline.getUTCDate() + FILING_DEADLINE_DAYS);

  const msPerDay = 24 * 60 * 60 * 1000;
  const todayUtcMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const daysUntilDeadline = Math.round(
    (deadline.getTime() - todayUtcMs) / msPerDay,
  );

  const status: NextFilingExpectation["status"] =
    daysUntilDeadline < 0
      ? "overdue"
      : daysUntilDeadline <= IMMINENT_WINDOW_DAYS
        ? "imminent"
        : "upcoming";

  return {
    nextPeriod: toIsoDate(nextPeriod),
    deadline: toIsoDate(deadline),
    daysUntilDeadline,
    status,
  };
}

// "2026-06-30" → "Q2 2026"
export function quarterLabelFromIso(iso: string): string {
  const [yStr, mStr] = iso.split("-");
  const month = Number(mStr);
  const q =
    month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
  return `${q} ${yStr}`;
}

// "2026-08-14" → "14 ago. 2026"
export function shortDateEs(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
