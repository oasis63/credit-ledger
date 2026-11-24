import { addDays } from './ledger.js';

export interface ParsedPromise {
  promised_date: string;
  amount_paise: number | null;
  matched: string;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, ravivar: 0, itwar: 0,
  monday: 1, mon: 1, somvar: 1,
  tuesday: 2, tue: 2, mangalvar: 2,
  wednesday: 3, wed: 3, budhvar: 3,
  thursday: 4, thu: 4, guruvar: 4,
  friday: 5, fri: 5, shukravar: 5,
  saturday: 6, sat: 6, shanivar: 6,
};

function nextWeekday(fromIso: string, weekday: number): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  let delta = (weekday - d.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(fromIso, delta);
}

function parseAmount(text: string): number | null {
  const m = text.match(/(?:₹|rs\.?|inr|rupees?)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|rupees?|rupaye|rupay)/i);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

/**
 * Rule-based parser for payment promises in retailer WhatsApp replies, in
 * English and romanised Hindi ("Hinglish"). Returns null when no date is found.
 * Designed to be swapped for (or backed by) an LLM; keep this as the fallback.
 */
export function parsePromise(text: string, todayIsoDate: string): ParsedPromise | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const amount = parseAmount(t);

  const rules: Array<[RegExp, (m: RegExpMatchArray) => string | null]> = [
    [/\b(day after tomorrow|parso|parson)\b/, () => addDays(todayIsoDate, 2)],
    [/\b(tomorrow|tmrw|tmw|kal)\b/, () => addDays(todayIsoDate, 1)],
    [/\b(today|aaj|abhi)\b/, () => todayIsoDate],
    [/\b(next week|agle hafte|agle week|next hafta)\b/, () => nextWeekday(todayIsoDate, 1)],
    [/\b(end of (the )?month|month end|mahine ke end|month ke end)\b/, () => {
      const d = new Date(`${todayIsoDate}T00:00:00Z`);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      return last.toISOString().slice(0, 10);
    }],
    [/\b(?:in|within|after)\s+(\d{1,2})\s+days?\b|\b(\d{1,2})\s+din\s+(?:mein|me|baad)\b/, (m) => {
      const n = Number(m[1] ?? m[2]);
      return n > 0 && n <= 90 ? addDays(todayIsoDate, n) : null;
    }],
    [/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/, (m) => {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const today = new Date(`${todayIsoDate}T00:00:00Z`);
      let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : today.getUTCFullYear();
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      let candidate = new Date(Date.UTC(year, month - 1, day));
      if (candidate.getUTCDate() !== day) return null;
      if (!m[3] && candidate < today) {
        year += 1;
        candidate = new Date(Date.UTC(year, month - 1, day));
      }
      return candidate.toISOString().slice(0, 10);
    }],
  ];

  for (const [re, toDate] of rules) {
    const m = t.match(re);
    if (m) {
      const date = toDate(m);
      if (date) return { promised_date: date, amount_paise: amount, matched: m[0] };
    }
  }

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      return { promised_date: nextWeekday(todayIsoDate, weekday), amount_paise: amount, matched: name };
    }
  }
  return null;
}
