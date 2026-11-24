import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ReminderMessage {
  to: string; // E.164 without '+', e.g. 919876543210
  customerName: string;
  businessName: string;
  amountText: string;
  statementUrl: string;
  language: 'en' | 'hi';
}

export interface ReceiptMessage {
  to: string;
  customerName: string;
  businessName: string;
  amountText: string;
  modeText: string;
  collectedBy: string;
  receiptNo: string;
  language: 'en' | 'hi';
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface MessageSender {
  readonly channel: 'whatsapp' | 'console';
  sendReminder(msg: ReminderMessage): Promise<SendResult>;
  /** Instant receipt to the retailer when a salesman records a collection. */
  sendReceipt(msg: ReceiptMessage): Promise<SendResult>;
}

/** Normalise an Indian mobile number to E.164 digits (no '+'). */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  return null;
}

/** Development sender: logs instead of sending. */
export class ConsoleSender implements MessageSender {
  readonly channel = 'console' as const;
  readonly sent: Array<ReminderMessage | ReceiptMessage> = [];
  constructor(private readonly log: (msg: string) => void = () => undefined) {}
  async sendReminder(msg: ReminderMessage): Promise<SendResult> {
    this.sent.push(msg);
    this.log(`[whatsapp:console] reminder to=${msg.to} ${msg.customerName}: ${msg.amountText} due, ${msg.statementUrl}`);
    return { ok: true, providerMessageId: `console-${this.sent.length}` };
  }
  async sendReceipt(msg: ReceiptMessage): Promise<SendResult> {
    this.sent.push(msg);
    this.log(`[whatsapp:console] receipt to=${msg.to} ${msg.customerName}: received ${msg.amountText} (${msg.modeText}) by ${msg.collectedBy}, #${msg.receiptNo}`);
    return { ok: true, providerMessageId: `console-${this.sent.length}` };
  }
}

/**
 * WhatsApp Cloud API sender. Reminders must use a pre-approved UTILITY template.
 * Expected template body variables: {{1}} customer name, {{2}} business name,
 * {{3}} amount due, {{4}} statement link.
 */
export class WhatsAppCloudSender implements MessageSender {
  readonly channel = 'whatsapp' as const;
  constructor(
    private readonly opts: {
      token: string;
      phoneNumberId: string;
      reminderTemplate: string;
      receiptTemplate: string;
      apiVersion?: string;
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  sendReminder(msg: ReminderMessage): Promise<SendResult> {
    return this.sendTemplate(msg.to, this.opts.reminderTemplate, msg.language, [
      msg.customerName,
      msg.businessName,
      msg.amountText,
      msg.statementUrl,
    ]);
  }

  /** Receipt template variables: {{1}} customer, {{2}} amount, {{3}} mode, {{4}} collected by, {{5}} receipt no, {{6}} business. */
  sendReceipt(msg: ReceiptMessage): Promise<SendResult> {
    return this.sendTemplate(msg.to, this.opts.receiptTemplate, msg.language, [
      msg.customerName,
      msg.amountText,
      msg.modeText,
      msg.collectedBy,
      msg.receiptNo,
      msg.businessName,
    ]);
  }

  private async sendTemplate(to: string, name: string, language: 'en' | 'hi', params: string[]): Promise<SendResult> {
    const url = `https://graph.facebook.com/${this.opts.apiVersion ?? 'v21.0'}/${this.opts.phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name,
        language: { code: language === 'hi' ? 'hi' : 'en' },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    };
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string } };
      if (!res.ok) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
      return { ok: true, providerMessageId: json.messages?.[0]?.id };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

/** Verify Meta's X-Hub-Signature-256 header over the raw request body. */
export function verifyWebhookSignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface InboundText {
  phoneNumberId: string;
  from: string;
  text: string;
  messageId: string;
}

/** Extract inbound text messages from a WhatsApp webhook payload. */
export function extractInboundTexts(payload: unknown): InboundText[] {
  const out: InboundText[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as Array<{ changes?: unknown[] }>) {
    for (const change of (entry.changes ?? []) as Array<{ value?: Record<string, unknown> }>) {
      const value = change.value ?? {};
      const phoneNumberId = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id;
      const messages = (value.messages ?? []) as Array<{ from?: string; id?: string; type?: string; text?: { body?: string } }>;
      for (const m of messages) {
        if (m.type === 'text' && m.text?.body && m.from && m.id && phoneNumberId) {
          out.push({ phoneNumberId, from: m.from, text: m.text.body, messageId: m.id });
        }
      }
    }
  }
  return out;
}
