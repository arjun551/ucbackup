# UC ESPORTS TOURNAMENT — Website Edition (Firebase Spark + Vercel)

This branch is the pure responsive website edition. Android, Capacitor, installable PWA and Firebase Cloud Functions deployment have been removed from the deployment path.

## Architecture
- Website: static HTML/CSS/JavaScript in `public/`, served by Vercel.
- Identity and data: Firebase Authentication and Cloud Firestore on the Firebase Spark project. Profile photos and manual payment proofs are compressed and stored as Firestore documents; Firebase Storage is not used.
- Trusted server operations: Vercel Node.js API routes in `api/`, using Firebase Admin SDK.
- Payments: Razorpay QR creation on the server and signature-verified webhook at `/api/razorpay-webhook`.
- Source: GitHub branch `spark-vercel-website`.

Wallet balances, tournament entry charges, withdrawals, room credentials, result publication and payment verification must only be mutated by server-side API routes. Do not grant clients direct write access to those records.

## Local setup (Windows)
1. Install Node.js 22 LTS and Git.
2. Clone and switch branch:
   ```powershell
   git clone https://github.com/arjun551/ucbackup.git
   cd ucbackup
   git checkout spark-vercel-website
   npm install
   ```
3. Create a local `.env.local` file (never commit it). Add the environment variables below.
4. Run `npm test`, then `npx vercel dev`.
5. Open the local URL printed by Vercel CLI. Player site: `/`; admin: `/admin/`.

## Required environment variables
Set these in local `.env.local` and later in Vercel Project Settings → Environment Variables:
- `FIREBASE_SERVICE_ACCOUNT_JSON`: complete JSON of a **newly generated, unrevoked** Firebase service-account key. Store it as one JSON string. Never paste it into source code, GitHub, or chat.
- `FIRST_ADMIN_EMAIL`: `ucwebdeveloper07@gmail.com`
- `RZP_KEY_ID`: Razorpay Test Mode key ID while developing.
- `RZP_KEY_SECRET`: Razorpay Test Mode secret.
- `RZP_WEBHOOK_SECRET`: webhook secret configured in Razorpay and identical here.
- `CRON_SECRET`: long random value for protected maintenance tasks if an external scheduler is configured.

Do not reuse any previously exposed Firebase service-account private key. Revoke the exposed key in Google Cloud IAM and generate a new one. Never expose Razorpay secrets in browser JavaScript.

## Firebase setup
- Enable Google provider in Firebase Authentication.
- Add `localhost` and the deployed website domain to Authorized domains.
- Publish `firestore.rules` to the existing Firebase project.
- The public Firebase Web config is in `public/firebase-config.js`; it is not a service-account credential.
- First-admin setup requires the exact verified email in `FIRST_ADMIN_EMAIL`. Sign in with that account and use the setup control once.

## Razorpay setup
- Develop only with Razorpay Test Mode credentials.
- Configure webhook URL as `https://YOUR_DOMAIN/api/razorpay-webhook`.
- Subscribe to `qr_code.credited`.
- Use the exact same webhook secret in `RZP_WEBHOOK_SECRET`.
- Test success, duplicate, wrong-amount, expired and invalid-signature events before live credentials.
- Live payments and real-money esports operations require Razorpay's explicit business-model approval and a hosting arrangement whose terms permit the commercial activity. Do not enable live keys until approval is confirmed.

## Verification scope
Images are compressed in the browser before upload. Manual payment proof data is limited to 500 KB and stored in a private Firestore collection to stay within the document-size limit. This is suitable for low-volume proof review, not bulk image hosting.

The project check validates repository structure and JavaScript syntax. It does not prove Firebase credentials, Google OAuth, Firestore deployment, Razorpay merchant approval, webhook delivery or live-money settlement. Those require local integration tests and provider-side configuration.

## Pages and features
Player site: Google sign-in, profile and game IDs, tournaments, Solo/Duo/Squad registration, joined-player roster, gated room details, daily rewards, XP/levels, wallet, Razorpay QR deposits, manual UPI review, winnings withdrawal requests, transaction history and leaderboard.

Admin site: first-admin setup, staff roles, user moderation and soft-delete, tournament management, room credentials, deposits, withdrawals, result/prize publication, promotions, announcements, settings and audit log.

## Important
This branch does not deploy Firebase Cloud Functions. Website callable operations route through `/api/call`; the webhook routes through `/api/razorpay-webhook`. Keep Firebase rules restrictive. Never open wallet, deposit, withdrawal, private room or prize writes to clients.
