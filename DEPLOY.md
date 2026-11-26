# Deploying Credit Ledger everywhere

| Part | Where it runs | How |
| --- | --- | --- |
| **API + Postgres + web app** | A VPS (or Kubernetes) | Docker images from GitHub Actions, Caddy for HTTPS |
| **Android app** (salesmen, owners) | Google Play, or an APK | Expo EAS Build → Play Console |
| **iOS app** | App Store / TestFlight | Expo EAS Build → App Store Connect |
| **Tally sync agent** | The distributor's Windows PC | `cl-agent.exe` attached to each GitHub release |

The phone apps talk to the API at the address baked in when they are built (`EXPO_PUBLIC_API_URL` in `apps/mobile/eas.json`), so **deploy the server first**.

---

## 1. Server on a VPS with HTTPS

Customers' phone numbers are personal data under India's DPDP Act. Host in India: AWS Mumbai (ap-south-1), DigitalOcean Bangalore, Azure Central India, or E2E Networks. 2 vCPU and 2–4 GB RAM is enough to start.

**One-time setup**

1. Add a DNS **A record** for your domain (e.g. `ledger.example.in`) pointing to the server's IP address.
2. Install Docker: `curl -fsSL https://get.docker.com | sh`
3. Open ports 80 and 443. Keep 5432 closed: Postgres is reachable only inside Docker.

**Deploy**

```bash
git clone https://github.com/<you>/credit-ledger.git && cd credit-ledger/deploy/vps
./setup.sh                 # asks for the domain and GitHub user; writes .env with random secrets
docker compose up -d       # Postgres, API (runs migrations), web, and Caddy with automatic HTTPS
```

Open `https://ledger.example.in` and register your distributor account.

- Want demo data first? Run `docker compose exec api node dist/seed.js`.
- No images published yet? Use `docker compose up -d --build` to build them on the server.

**Update:** `docker compose pull && docker compose up -d`. Migrations run automatically when the API starts.

**Backups:** add `backup.sh` to cron (`0 2 * * * /path/to/deploy/vps/backup.sh`). It keeps 14 days of `pg_dump` files in `deploy/vps/backups`. Copy them off the server as well, and test a restore once (the command is at the top of `backup.sh`).

**Managed Postgres (later):** remove the `db` service and set `DATABASE_URL` in `.env` to the provider's address, e.g. AWS RDS Mumbai.

**Monitoring:** point an uptime checker (UptimeRobot, Better Stack) at `https://ledger.example.in/healthz`.

**WhatsApp webhook:** in Meta's developer console, set the callback URL to `https://ledger.example.in/webhooks/whatsapp`, with the `WHATSAPP_VERIFY_TOKEN` from `.env`.

**devnotes on the same server:** see `deploy/vps/caddy-extra/README.md`. Credit Ledger's Caddy can serve both sites.

**Kubernetes:** `deploy/k8s` (with `extras/ingress.yaml` and `extras/hpa.yaml`). For a real cluster, change the images to `ghcr.io/<you>/credit-ledger-api:<version>` and `-web:<version>`, then add cert-manager for HTTPS.

## 2. Automatic builds (GitHub Actions)

- `ci.yml`: typecheck and tests (with real Postgres), the mobile bundle, and the Go agent.
- `release.yml`:
  - On every push to `main`, it builds the API and web images for amd64 and arm64 → `ghcr.io/<you>/credit-ledger-api` and `credit-ledger-web`.
  - A `v1.2.0` tag also builds **cl-agent.exe** and attaches it to a GitHub release, ready for distributors to download.
- `mobile.yml`: phone builds on EAS. It needs an `EXPO_TOKEN` secret.

After the first image build, either make the two packages public on GitHub, or run `docker login ghcr.io` on the server.

## 3. Android app (Google Play)

**Before building:** in `apps/mobile/eas.json`, set `EXPO_PUBLIC_API_URL` to your real domain under `production` (and under `preview` if you use a staging server).

**Accounts:**
- Expo: free.
- Google Play Console: $25, paid once.
  - Personal accounts created after 13 Nov 2023 must run a **closed test with 12+ testers for 14 days in a row** before publishing to production. Your first distributors' salesmen make natural testers.
  - An organisation account (needs a D-U-N-S number) skips this rule.

```bash
cd apps/mobile
npm install -g eas-cli && eas login
eas init                                                        # once
eas build --profile preview --platform android                  # APK to hand to salesmen directly
eas build --profile production --platform android               # .aab for Play
eas submit --profile production --platform android              # after the first manual upload
```

**First upload (manual)**

1. Create the app in Play Console (package `in.creditledger.app`).
2. Upload the `.aab` to Internal testing, then Closed testing.
3. Fill in the store listing, content rating, privacy policy URL (`docs/PRIVACY.md`) and **Data safety**:
   - Data collected: name, phone number, approximate and precise location (only at check-in), financial info (ledger entries).
   - All of it is encrypted in transit, and none of it is sold.
4. The app asks for location in the foreground only; background location is explicitly blocked in `app.json`, so you don't need the background-location declaration.
5. For **App access**, give reviewers a demo login. Run `docker compose exec api node dist/seed.js` on a staging server and use `amit@creditledger.in / demo-password-123`.

**Automatic submits afterwards:** create a Google Cloud service account with Play access, then upload its JSON key with `eas credentials`.

**Skipping the store:** salesmen can install the preview APK directly. In that case, distribute it through a link (for example, attached to a GitHub release).

## 4. iOS app (App Store)

You need an Apple Developer account ($99/year). You don't need a Mac: EAS builds in the cloud.

```bash
cd apps/mobile
eas build --profile production --platform ios     # EAS creates the certificates
eas submit --profile production --platform ios    # uploads to TestFlight
```

In App Store Connect:
- Add the privacy details (same answers as for Play).
- Under App Review Information, add the demo login.

The location permission text and "no non-exempt encryption" are already set in `app.json`.

## 5. Tally agent for distributors

Tag a release (`git tag v1.0.0 && git push --tags`), and `cl-agent.exe` appears on the GitHub release page. Setup steps are in the README under **Tally sync agent**.

Before handing it to customers, sign the exe with a code-signing certificate. Otherwise Windows SmartScreen will warn when they run it.

## 6. Go-live checklist

- [ ] HTTPS works and `/healthz` returns 200.
- [ ] `.env` secrets were generated by `setup.sh`, and `.env` is not in git.
- [ ] Nightly backups run, a copy is kept off the server, and one restore has been tested.
- [ ] The uptime monitor is on `/healthz`.
- [ ] `eas.json` production URL is your real domain.
- [ ] The privacy policy and terms are live (DPDP Act).
- [ ] WhatsApp templates are approved, and `WHATSAPP_MODE=cloud` is set.
- [ ] A demo account is ready for store reviewers.
- [ ] You've checked your employer's policy on outside work before you start charging customers.
