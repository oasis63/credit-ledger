# Credit Ledger: Android app (React Native + Expo SDK 58)

The field app for salesmen and owners. It shares money formatting, API types, the API client and the offline outbox with the web app through `packages/shared`.

## What it does

- **Today:** the salesman's route for the day (beats planned on the web), in visiting order, with the next stop, collected vs daily target and overdue on the route.
- **Check in** at a shop: what happened (collected, promised, order taken, no payment, owner absent, shop closed), a note and a GPS fix. The first check-in pins the shop on the office map.
- **Collect** cash, UPI or cheque. The shop gets a WhatsApp receipt; the salesman can also share a PDF receipt.
- **Customers:** balance, ageing, credit limit, statement, bills, visits. Call, WhatsApp the statement link, directions, and a **UPI QR** to scan and pay on the spot.
- **Bills:** view any GST bill and share it as a PDF.
- **Works offline.** Collections and visits are saved on the phone and sync in order when the connection returns. A retried sync can never record a payment twice.

Location is only read while checking in ("while using the app"); the app never asks for background location.

## Run it during development

```bash
cd apps/mobile
npm install
npx expo start
```

- **Backend:** start it with `make dev` in the repo root (Docker; no Postgres install needed). Find your Mac's IP with `ipconfig getifaddr en0`.
- **Phone on the same Wi-Fi:** sign in with server address `http://<your-laptop-ip>:4000`. Against `make prod` or `make k8s-up`, use `http://<your-laptop-ip>:8080` instead (the web server forwards `/api`) (the API must allow it; for plain `http` on Android use a development build, see below).
- **Android emulator:** the default server `http://10.0.2.2:4000` points at your computer's API.
- **Expo Go vs development build:** if the Play Store version of Expo Go doesn't support SDK 58 yet, use a development build instead: `npx eas-cli@latest build --profile development --platform android`, install the APK, then `npx expo start`.

Checks: `npx tsc --noEmit` and `npx expo export --platform android` (bundles the app exactly like a release build's JavaScript step).

## Build for Google Play

1. **Set your identity** in `app.json`: change `android.package` from `in.creditledger.app` to a name you own (e.g. `com.yourname.creditledger`). It can never change after the first upload.
2. **Set your API address** in `eas.json` → `build.production.env.EXPO_PUBLIC_API_URL` (must be `https://`).
3. **Replace the icons** in `assets/` (`icon.png` 1024×1024, `android-icon-foreground.png` etc.).
4. **Build in the cloud** (no Android Studio needed):

   ```bash
   npm install -g eas-cli      # or use npx eas-cli@latest
   eas login
   eas build:configure         # links the project to your Expo account (first time only)
   eas build --profile preview --platform android      # APK to install on test phones
   eas build --profile production --platform android   # .aab for the Play Store
   ```

   EAS creates and stores the upload signing key for you. Back it up (`eas credentials`).

5. **Submit**: upload the `.aab` in Play Console, or run `eas submit --profile production --platform android` (needs a Google service account key; see Expo's submit docs). The profile uploads to the **internal** track as a draft.

### Play Store checklist

- [ ] Google Play developer account ($25 one-time). New **personal** accounts must run a **closed test with at least 12 testers for 14 continuous days** before production. Recruit 15–20 distributors and salesmen before starting the clock. Organisation accounts (D-U-N-S number) are exempt.
- [ ] Privacy policy URL (the app stores retailers' names, phone numbers and balances).
- [ ] Data safety form: collects contact info (phone numbers) and financial info (amounts owed/paid) of your customers' retailers; data is encrypted in transit; users can request deletion through the business.
- [ ] Content rating questionnaire, target audience (adults, business use), app category (Business or Finance).
- [ ] Store listing: short and full description, at least 2 phone screenshots, feature graphic (1024×500).
- [ ] Production API on HTTPS with backups, and the web app for the office.

## Project layout

```
src/app/              Expo Router screens (file = route)
  _layout.tsx         Session provider + protected routes
  login.tsx
  (tabs)/             Customers, Collect, Sync, Account
  customer/[id].tsx   Customer detail
src/lib/
  session.tsx         Auth, API client, offline cache, auto-sync
  storage.ts          SQLite cache + outbox (storage.web.ts for browser preview)
  secure.ts           Token in Keystore (secure.web.ts for browser preview)
src/components/ui.tsx Buttons, fields, badges, banners
```

## After updating

This version adds native modules (location, PDF printing, sharing, SVG). Build a new development build (`eas build --profile development --platform android`) before running it on a phone.

## Next steps

- Cheque photos (needs file storage on the API side, e.g. S3-compatible bucket).
- Push notifications for promises due today.
- Hindi translations of the UI (customer messages are already per-customer language).
