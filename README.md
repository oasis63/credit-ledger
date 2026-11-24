# Credit Ledger

Credit and collections software for distributors and wholesalers who sell to retailers on credit. It works like Khatabook or OkCredit on the surface, and adds what a distributor with 100–500 retailers and a field sales team needs:

- **Immutable ledger** per retailer: invoices, payments, credit notes, adjustments, bounced cheques. Corrections are new entries; history can't be edited or deleted (enforced by a database trigger).
- **Aging and risk flags.** FIFO allocation of payments to the oldest bills, 0/30/60/90+ aging, and a transparent green/amber/red risk score with plain-language reasons ("Balance is above the credit limit").
- **Two-sided ledger.** Each retailer gets a signed WhatsApp link to their live statement, with a **Pay with UPI** button and a **Report a problem** button on every line. Disputes land in a queue for the office.
- **Salesman collections with instant receipts.** When a salesman records cash, cheque or UPI, the retailer immediately gets a WhatsApp receipt with the amount and the salesman's name. The office closes each salesman's day and the system records any shortfall.
- **WhatsApp reminders** (single or bulk, with a 72-hour cooldown) through the official WhatsApp Cloud API.
- **Payment promises from replies.** A reply like "kal 10000 rs bhej dunga" becomes a promise dated tomorrow for ₹10,000, later marked kept or broken. Works in English and romanised Hindi.
- **UPI to the distributor's own UPI ID.** No payment gateway, no fees, and this system never holds money.
- **Tally sync agent** (Go, read-only) that mirrors Sundry Debtors balances from TallyPrime so the app and the books can be reconciled.
- **Roles:** owner, accountant, salesman. Salesmen can only record collections and see their own.
- **Multi-tenant** with Postgres **row-level security**: tenant isolation is enforced by the database, not just application code.

## Architecture

```
apps/api     Fastify + TypeScript + Postgres (RLS). REST API, WhatsApp webhook, agent endpoint.
apps/web     React + Vite. Owner/staff app, salesman screens, public retailer statement page.
agent        Go. Runs on the office PC next to Tally; outbound-only HTTPS to the API.
```

Money is stored as integer **paise** everywhere. Dates are `YYYY-MM-DD` in India time.

## Quick start (Docker)

```bash
cp .env.example .env
# Fill in POSTGRES_PASSWORD, JWT_SECRET and STATEMENT_LINK_SECRET:
#   openssl rand -hex 32
docker compose up --build
```

Open http://localhost:8080, create your business account, then in **Settings** add your UPI ID and a salesman. With `WHATSAPP_MODE=console` (the default), messages are written to the API logs instead of being sent.

## Local development

Requirements: Node 20+, Postgres 14+, Go 1.22+ (for the agent).

```bash
npm install
createdb ledger
export DATABASE_URL=postgres://localhost/ledger
export JWT_SECRET=$(openssl rand -hex 32) STATEMENT_LINK_SECRET=$(openssl rand -hex 32)
npm run dev:api     # http://localhost:4000 (runs migrations on start)
npm run dev:web     # http://localhost:5173 (proxies /api to the API)
```

### Tests

```bash
createdb ledger_test
TEST_DATABASE_URL=postgres://localhost/ledger_test npm test   # unit + integration (real Postgres)
cd agent && go test ./...
```

The integration suite drops and recreates the `public` schema of the test database. **Never point `TEST_DATABASE_URL` at real data.**

What the tests cover: money parsing and formatting, FIFO aging, risk rules, UPI links, signed statement tokens (tampering and expiry), the Hindi/English promise parser, password hashing, webhook signatures, and an end-to-end API run covering registration, roles, RLS isolation between tenants, ledger immutability, collections with receipts and day close, the public statement and disputes, reminders with cooldown, the signed webhook, the dashboard, and Tally sync.

## WhatsApp setup (Meta Cloud API)

1. Create a Meta Business account and a WhatsApp Business app; add your business number.
2. Create two **Utility** message templates (Hindi and English versions under the same name):
   - `payment_reminder`, body variables: `{{1}}` customer name, `{{2}}` business name, `{{3}}` amount due, `{{4}}` statement link.
     Example: *Namaste {{1}}, {{2}} se aapka {{3}} baaki hai. Apna khata dekhein aur UPI se payment karein: {{4}}*
   - `payment_receipt`, body variables: `{{1}}` customer, `{{2}}` amount, `{{3}}` mode, `{{4}}` collected by, `{{5}}` receipt number, `{{6}}` business.
3. Set in `.env`: `WHATSAPP_MODE=cloud`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
4. Point the app's webhook at `https://<your-domain>/webhooks/whatsapp` with your verify token, and subscribe to `messages`.
5. In the app's **Settings**, enter the same WhatsApp phone number ID so replies are routed to your business.

Utility messages are billed per message by Meta (about ₹0.15 each in India at the time of writing). In production, the webhook rejects unsigned requests.

## Tally sync agent

1. In TallyPrime: **Help → Settings → Advanced Configuration**, enable the HTTP server (port 9000), and keep the company loaded.
2. In the app: **Settings → Tally sync agent keys → Create key**. Copy the key (shown once).
3. On the Tally PC:

```bat
set CL_API_URL=https://your-domain
set CL_AGENT_KEY=clk_...
set SYNC_INTERVAL=15m
cl-agent.exe
```

Build it with `cd agent && GOOS=windows GOARCH=amd64 go build -o cl-agent.exe ./cmd/agent`. Run it as a Windows service with a tool like NSSM or Task Scheduler.

The agent matches ledgers by name, links them to existing customers by mobile number, and creates customers for new ledgers that have a mobile number. Balances appear in the **Tally** column of the customer list; a highlighted value means the app and Tally disagree.

> **Verify on your Tally first:** the agent assumes Tally's XML convention that debit balances are negative. Run it once with `SYNC_INTERVAL=once` and compare a few balances.

## Security notes

- Tenant isolation: every tenant query runs as the `app_user` role with `app.tenant_id` set, under Postgres row-level security. Only registration, login, webhook routing and agent-key lookup use the owner role.
- Passwords: scrypt. Agent keys: stored as SHA-256 hashes, shown once.
- Statement links: HMAC-signed, expiring (default 30 days), scoped to one customer, read-only plus disputes, rate-limited.
- Every write is recorded in `audit_log`.
- Helmet headers, CORS allow-list, rate limiting (stricter on login and public links), 1 MB body limit.

## Before you go live (things only you can do)

- [ ] Real WhatsApp Business account, approved templates, and Meta Tech Provider status if you send from each distributor's own number.
- [ ] A domain with HTTPS (e.g. Caddy or a cloud load balancer in front of the `web` container), hosted in India.
- [ ] Managed Postgres with daily backups and a tested restore.
- [ ] Error monitoring (e.g. Sentry) and uptime alerts on `/healthz`.
- [ ] Privacy policy and terms (DPDP Act): retailer phone numbers are personal data.
- [ ] Code-signing certificate for the Windows agent, so SmartScreen and antivirus don't block it.
- [ ] Security review / penetration test before onboarding paying customers.
- [ ] Check your employer's policy on outside work before selling.

## Known limitations and next steps

- Reminders are sent synchronously; move bulk sending to a job queue (e.g. pg-boss) as volume grows.
- The salesman experience is the responsive web app; a native offline-first app (React Native) is the next big step for poor-signal markets.
- Promise parsing is rule-based; an LLM can be added behind `parsePromise` for messier replies.
- Tally sync is balances only; invoice-level sync would let the app post invoices automatically.
- Marg ERP integration (for pharma distributors) needs API access through a Marg partner.
- JWTs are stored in `localStorage`; consider httpOnly cookies with CSRF protection for higher security.
