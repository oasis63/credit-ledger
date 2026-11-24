import type { LedgerEntry } from './ledger.js';
import { balanceOf, openItems } from './ledger.js';

export type RiskFlag = 'green' | 'amber' | 'red';

export interface RiskInput {
  entries: readonly LedgerEntry[];
  credit_limit_paise: number;
  open_disputes: number;
  broken_promises: number;
  as_of: string;
}

export interface RiskResult {
  flag: RiskFlag;
  score: number; // 0 (safe) to 100 (stop credit)
  reasons: string[];
  max_days_overdue: number;
  balance_paise: number;
}

/**
 * Transparent, rule-based risk score. Deliberately simple and explainable:
 * every point added comes with a human-readable reason the salesman can act on.
 * Replace or blend with a learned model once there are months of payment data.
 */
export function assessRisk(input: RiskInput): RiskResult {
  const { items } = openItems(input.entries, input.as_of);
  const balance = balanceOf(input.entries);
  const maxDays = items.reduce((m, i) => Math.max(m, i.days_overdue), 0);
  const overdue = items.filter((i) => i.days_overdue > 0).reduce((s, i) => s + i.open_paise, 0);
  const reasons: string[] = [];
  let score = 0;

  if (maxDays > 90) {
    score += 50;
    reasons.push(`Oldest bill is ${maxDays} days overdue`);
  } else if (maxDays > 60) {
    score += 35;
    reasons.push(`Oldest bill is ${maxDays} days overdue`);
  } else if (maxDays > 30) {
    score += 20;
    reasons.push(`Oldest bill is ${maxDays} days overdue`);
  } else if (maxDays > 0) {
    score += 8;
    reasons.push(`Bills overdue by up to ${maxDays} days`);
  }

  if (balance > 0 && overdue / balance > 0.5) {
    score += 10;
    reasons.push('More than half the balance is overdue');
  }

  if (input.credit_limit_paise > 0 && balance > input.credit_limit_paise) {
    score += 20;
    reasons.push('Balance is above the credit limit');
  }

  const bounces = input.entries.filter((e) => e.kind === 'cheque_bounce').length;
  if (bounces > 0) {
    score += Math.min(30, bounces * 15);
    reasons.push(`${bounces} bounced cheque${bounces > 1 ? 's' : ''}`);
  }

  if (input.broken_promises > 0) {
    score += Math.min(20, input.broken_promises * 10);
    reasons.push(`${input.broken_promises} broken payment promise${input.broken_promises > 1 ? 's' : ''}`);
  }

  if (input.open_disputes > 0) {
    // A dispute is not bad faith, but money will not move until it is resolved.
    score += 5;
    reasons.push(`${input.open_disputes} open dispute${input.open_disputes > 1 ? 's' : ''}`);
  }

  score = Math.min(100, score);
  const flag: RiskFlag = score >= 50 ? 'red' : score >= 20 ? 'amber' : 'green';
  return { flag, score, reasons, max_days_overdue: maxDays, balance_paise: balance };
}
