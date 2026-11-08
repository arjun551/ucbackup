# UC ESPORTS TOURNAMENT — upgraded web project

This project targets the Firebase project `ucesportslast`. The player website is a static Firebase/Vercel-hostable frontend; wallet, tournament registration, rewards, results, withdrawals and admin actions are handled by Firebase Cloud Functions in `asia-south1`.

## Included

- Google sign-in for players; Firebase Auth session.
- Player profile: username, mobile, profile image, Free Fire/BGMI/Minecraft IDs.
- Tournament list with Solo (1 tag), Duo (2 tags) and Squad (4 tags) registration.
- Server-side wallet charging and tournament seat registration.
- Manual UPI deposits: QR generated from the admin-configured UPI ID, player submits UTR + screenshot, admin manually verifies before credit.
- Winnings withdrawal requests; server reserves winnings, admin marks paid or rejects (refunds the reservation).
- Daily reward sequence ₹2, ₹4, ₹6, ₹8, ₹3, ₹7, ₹3; claim once per India-local day. These are non-withdrawable bonus credits.
- XP: +50 for joining, +50 when a match is completed, +200 for a published winner. Levels every 500 XP; level rewards are non-withdrawable bonus credits, ₹2–₹8 per level.
- Leaderboard, transaction history, live stream URL / spectate link, room details for registered players.
- Admin panel: dashboard, users, block/unblock, edit profile, message, soft-delete, tournaments, rooms, stream URLs, results, payments, withdrawals, promotions, settings and audit log.
- Firestore and Storage rules keep wallets and payment records server-write-only; player payment proof uploads are owner-scoped.

## 1. Firebase setup

1. Open Firebase Console and select `ucesportslast`.
2. Authentication → Sign-in providers → enable **Google**. For the admin panel, also enable Email/Password if you want password login.
3. Create Firestore in `asia-south1` and enable Firebase Storage.
4. Confirm the web app config in `public/firebase-config.js` matches this project.
5. Copy `functions/.env.example` to `functions/.env`. Keep `FIRST_ADMIN_EMAIL=ucwebdeveloper07@gmail.com` and do not add passwords or gateway secrets to this file.
6. In Authentication, create/sign in to the admin account with that email and verify the email address.
7. Deploy Functions and rules, then open `/admin/` and sign in with Google or Email/Password. Click **Run first-time admin setup** once.

The admin password is never stored in this project. If a password was shared in chat, change it in Firebase Authentication before using the live site.

## 2. Configure UPI

In `/admin/` → Settings → Edit platform settings, set:
- **UPI ID**: the merchant UPI ID that receives deposits.
- **UPI merchant name**: the payee name displayed in the QR.
- Minimum withdrawal and room-open minutes as required.

Players create a UPI QR, pay externally, then submit the UTR and payment screenshot. The deposit remains in **review** until an admin checks the bank/UPI statement and approves it. Never approve from screenshot alone if the UTR/payment cannot be independently matched.

## 3. Install and deploy

Use Node.js 22 for Cloud Functions (and Node 20.19+ for the root build check).

```bash
npm install
npm run build
npm install --prefix functions
npm install -g firebase-tools
firebase login
firebase use ucesportslast
firebase deploy
```

For Vercel, import the repository. `vercel.json` serves the `public/` folder. Cloud Functions and Firebase rules must still be deployed separately with the Firebase CLI; Vercel does not deploy them.

## 4. Optional Razorpay adapter

The legacy Razorpay callable/webhook adapter remains in `functions/index.js` but is not used by the manual-UPI player flow. Only configure it if your approved payment gateway account supports this business category. Store keys with Firebase Secret Manager:

```bash
firebase functions:secrets:set RZP_KEY_ID
firebase functions:secrets:set RZP_KEY_SECRET
firebase functions:secrets:set RZP_WEBHOOK_SECRET
```

Never place secret values in frontend files, GitHub, Vercel public variables, or chat.

## 5. Important checks before real-money launch

- Test Google Auth, first-admin setup, rules, UPI proof upload, manual approval/rejection, withdrawal reserve/refund, tournament join/refund, results and room access in a Firebase test project first.
- The `npm run build` check validates project structure and JavaScript syntax; it does **not** prove live Firebase deployment or payment settlement.
- Real-money esports entry fees and prizes can trigger legal, tax and payment-provider restrictions in India. Get qualified legal advice and written gateway approval before accepting real payments.
- Financial records are preserved on user soft-delete. Do not manually delete wallet/transaction/deposit records.
