import { getDcaPeriodInfo, type DcaFrequency } from '../model/constants/dcaConfig';

/** Actual deposit dates: original nth weekday, clamped to the last occurrence.
 * UTC date arithmetic avoids DST and local timezone shifts. */
export const calculateDcaSchedule = (startDate: string, endDate: string, frequency: DcaFrequency): string[] => {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];
  const { type, interval } = getDcaPeriodInfo(frequency);
  const weekday = start.getUTCDay();
  const nth = Math.floor((start.getUTCDate() - 1) / 7);
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (type === 'weekly') {
      cursor = new Date(cursor.getTime() + interval * 7 * 86400000);
    } else {
      const first = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + interval, 1));
      const day = 1 + (weekday + 7 - first.getUTCDay()) % 7 + nth * 7;
      cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day));
      if (cursor.getUTCMonth() !== first.getUTCMonth()) cursor.setUTCDate(cursor.getUTCDate() - 7);
    }
  }
  return dates;
};

export const calculateDcaPeriods = (startDate: string, endDate: string, frequency: DcaFrequency): number =>
  Math.max(1, calculateDcaSchedule(startDate, endDate, frequency).length);
