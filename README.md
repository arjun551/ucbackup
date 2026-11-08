# UC ESPORTS TOURNAMENT — Full Version

This branch restores the full-featured UC Esports platform. The frontend is a static website deployed on Vercel; trusted wallet, payment, tournament, admin and scheduled operations run through Firebase Cloud Functions in `asia-south1`.

## Included features

- Google player sign-in; optional email/password sign-in for admins.
- Player profile: photo, mobile number, Free Fire/BGMI/Minecraft gamer IDs.
- Solo, Duo and Squad registration with 1, 2 or 4 individual player tags.
- Public joined-player roster; private Room ID/password returned only to registered players during the configured room-open window.
- Daily rewards, streaks, XP, levels and leaderboard.
- Wallet balances separated into deposit, winnings and non-withdrawable bonus credits.
- Razorpay single-use UPI QR deposits with server-side QR creation, webhook signature verification, amount/currency matching and idempotent wallet credit.
- Alternative manual UPI deposit with UTR and screenshot; admin verifies against the payment/bank record before approval.
- Transaction history and withdrawal requests; winnings are reserved on request and refunded if rejected.
- Admin dashboard, player edit/block/message/soft-delete, tournament management, room details, payments, withdrawals, results/prize distribution, promotions, announcements, settings and audit log.
- YouTube live spectating links.
- Firestore and Storage security rules; payment proof files are private to their owner and authorised staff.

## Architecture and plan requirement

This is the **full backend version**, not the Firebase Spark-only edition. Cloud Functions, Secret Manager and the scheduled function require a Firebase project on the **Blaze (pay-as-you-go) plan** with billing enabled. Vercel hosts the static frontend; it does not host or deploy the Firebase backend. Charges depend on actual usage and Google Cloud resources, so review the Firebase pricing/budget alerts before enabling production payments.

Do not deploy the Spark-only branch for this version.

## 1. Firebase setup

1. Open Firebase Console and select project `ucesportslast`.
2. Authentication → Sign-in providers: enable **Google**. Enable **Email/Password** if you want admin email/password sign-in.
3. Create Firestore in `asia-south1` and enable Firebase Storage.
4. Confirm `public/firebase-config.js` matches the Firebase web app config.
5. Upgrade the Firebase project to Blaze and attach a billing account before deploying Functions.
6. In Authentication, create or sign in to the intended owner account and verify its email.
7. Set the owner allowlist secret and payment secrets (the CLI prompts for each value; never paste secret values into source files):

```bash
firebase login
firebase use ucesportslast
firebase functions:secrets:set FIRST_ADMIN_EMAIL
firebase functions:secrets:set RZP_KEY_ID
firebase functions:secrets:set RZP_KEY_SECRET
firebase functions:secrets:set RZP_WEBHOOK_SECRET
```

For the first-admin secret, enter the exact email address of the verified owner account. For Razorpay, initially use **Test Mode** credentials and a test webhook secret.

8. Install and deploy:

```bash
npm run build
npm install --prefix functions
firebase deploy --only firestore,storage,functions
```

9. Open `/admin/`, sign in with the verified owner account and click **Run first-time admin setup** once. This creates the super-admin role. After setup, sign out and sign in again if the role claim has not refreshed.
10. In Firebase Authentication → Settings → Authorized domains, add the Vercel domain you will use.

## 2. Razorpay QR and webhook

The player Wallet page has two deposit paths:

- **Razorpay:** player enters an amount and requests a single-use QR. The server creates the QR using the Razorpay API; the player scans it and pays. The wallet is credited only after the signed webhook is verified and the payment ID, INR currency and exact amount match the pending deposit.
- **Manual UPI:** player scans the configured UPI QR, submits UTR and screenshot, and waits for admin approval. Admin must independently verify the payment in the bank/UPI statement before approving.

In the Razorpay Dashboard (use Test Mode first), create a webhook with this URL:

```
https://asia-south1-ucesportslast.cloudfunctions.net/paymentWebhook
```

Subscribe to the **`qr_code.credited`** event. Set the webhook secret in Firebase using `firebase functions:secrets:set RZP_WEBHOOK_SECRET`; the entered value must match the secret configured in Razorpay. After switching to Live Mode, replace the key ID, key secret and webhook secret with the approved live credentials, then redeploy Functions.

The Razorpay QR API must be enabled for your merchant account. Gateway approval for esports / entry-fee / prize-related flows is the merchant's responsibility; do not assume that a gateway account automatically permits every business model.

## 3. Admin payment and withdrawal workflow

- Razorpay QR deposits are automatically credited only after webhook verification. If a payment is delayed, mismatched or arrives after QR expiry, it is moved to review; an admin must inspect it in the Razorpay dashboard before taking action.
- Manual UPI deposits remain in review until an admin matches the UTR and amount against the actual payment record.
- Withdrawal requests reserve winnings from the available balance. Admin can move a request through Processing → Approved → Paid, or Reject it; rejection returns the reserved winnings to the wallet.
- Never credit wallet balances by editing Firestore documents manually. All wallet changes must go through trusted Cloud Functions.

## 4. Vercel deployment

1. Import GitHub repository `arjun551/ucbackup` into Vercel.
2. Select branch `full-version-razorpay` for the preview deployment.
3. Configure:
   - Framework Preset: **Other**
   - Root Directory: `./`
   - Build Command: `npm run build`
   - Output Directory: `public`
   - Node.js: **22.x**
4. No Razorpay secrets or Firebase service-account credentials belong in Vercel frontend environment variables. They stay in Firebase Secret Manager.
5. Deploy a Preview first. Test the site, then promote/merge only after backend checks pass. Firebase rules, Storage rules and Functions are deployed separately using the Firebase CLI.

The checked-in `vercel.json` already contains the static build/output configuration.

## 5. Local checks

Use Node.js 22 and Firebase CLI:

```bash
npm run build
node --check functions/index.js
npm install --prefix functions
firebase emulators:start --only auth,firestore,storage,functions
```

A successful syntax/build check does not prove that live Auth, Firestore rules, Storage permissions, Razorpay settlement or withdrawals work. Run end-to-end tests in a separate Firebase test project and Razorpay Test Mode before accepting real payments.

## 6. Production safety checklist

- Test Google login, first-admin setup, profile photo upload, gamer IDs and player registration.
- Test Solo/Duo/Squad seat counts, room access timing and roster visibility.
- Test daily reward duplicate prevention, XP/level progression and leaderboard updates.
- Test Razorpay QR creation, valid webhook, invalid signature, duplicate webhook, amount mismatch and expired QR.
- Test manual UTR proof, approval and rejection.
- Test withdrawal reserve, approval, payout marking and rejection refund.
- Test tournament cancellation/refunds, results publication and prize credit.
- Verify that a normal player cannot read another player's wallet, deposits, withdrawals, transactions or payment proof.
- Set billing budgets and alerts. Review legal, tax, age, consumer-protection and payment-provider requirements for real-money esports in India before launch.
- Keep financial records. Soft-delete users rather than deleting financial history.
