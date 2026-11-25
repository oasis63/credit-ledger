export type Role = 'owner' | 'accountant' | 'salesman';
export type RiskFlag = 'green' | 'amber' | 'red';
export type PaymentMode = 'cash' | 'cheque' | 'upi' | 'bank';
export type EntryKind =
  | 'opening_balance'
  | 'invoice'
  | 'payment'
  | 'credit_note'
  | 'adjustment_debit'
  | 'adjustment_credit'
  | 'cheque_bounce';

export interface User {
  id: string;
  name: string;
  role: Role;
  tenantId: string;
}

export interface Risk {
  flag: RiskFlag;
  score: number;
  reasons: string[];
  max_days_overdue: number;
  balance_paise: number;
}

export interface Aging {
  not_due: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string;
  gstin: string | null;
  credit_limit_paise: number;
  credit_days: number;
  language: 'en' | 'hi';
  balance_paise: number;
  overdue_paise: number;
  aging: Aging;
  risk: Risk;
  open_disputes: number;
  tally_balance_paise: number | null;
  tally_synced_at: string | null;
}

export interface StatementLine {
  id: string;
  kind: EntryKind;
  entry_date: string;
  due_date: string | null;
  reference: string | null;
  note?: string | null;
  payment_mode?: PaymentMode | null;
  payment_ref?: string | null;
  debit_paise: number;
  credit_paise: number;
  running_balance_paise: number;
}

export interface Dispute {
  id: string;
  customer_id: string;
  entry_id: string | null;
  reason: string;
  message: string | null;
  raised_by: 'retailer' | 'staff';
  status: 'open' | 'resolved' | 'rejected';
  resolution_note: string | null;
  created_at: string;
}

export interface Promise_ {
  id: string;
  promised_date: string;
  amount_paise: number | null;
  source_text: string;
  status: 'pending' | 'kept' | 'broken';
}

export interface CustomerDetail {
  customer: CustomerSummary;
  balance_paise: number;
  aging: Aging;
  statement: StatementLine[];
  risk: Risk;
  disputes: Dispute[];
  promises: Promise_[];
  reminders: Array<{ id: string; created_at: string; amount_paise: number; status: string; error: string | null }>;
}

export interface NewCollection {
  customer_id: string;
  /** Rupees as a decimal string, e.g. "1250.50". */
  amount: string;
  payment_mode: Exclude<PaymentMode, 'bank'>;
  payment_ref?: string;
  note?: string;
  /** UUID generated on the device; retries with the same value are recorded once. */
  client_ref: string;
  /** YYYY-MM-DD the money was collected (offline entries sync later). */
  collected_on: string;
}

export interface CollectionResult {
  entry: { id: string; amount_paise: number; entry_date: string };
  receipt: { number: string; sent: boolean; error: string | null };
  duplicate: boolean;
}

export const RISK_LABEL: Record<RiskFlag, string> = { green: 'Good', amber: 'Watch', red: 'Stop credit' };

export const KIND_LABEL: Record<EntryKind, string> = {
  opening_balance: 'Opening balance',
  invoice: 'Invoice',
  payment: 'Payment',
  credit_note: 'Credit note',
  adjustment_debit: 'Adjustment (+)',
  adjustment_credit: 'Adjustment (−)',
  cheque_bounce: 'Cheque bounced',
};

export const MODE_LABEL: Record<PaymentMode, string> = { cash: 'Cash', cheque: 'Cheque', upi: 'UPI', bank: 'Bank transfer' };
