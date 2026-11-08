# UC ESPORTS TOURNAMENT — Firebase Spark Free Edition

This branch is a Spark-compatible rebuild of the existing UC ESPORTS TOURNAMENT website. It keeps the existing dark gaming UI and uses Firebase Authentication + Cloud Firestore only. It does not deploy Cloud Functions or Firebase Storage.

## Included features

### Player website
- Google sign-in and automatic player profile creation.
- Player profile: username, mobile, Google profile photo, Free Fire UID, BGMI UID and Minecraft gamertag.
- Tournament listing for Free Fire, BGMI and Minecraft.
- Solo (1 tag), Duo (2 tags) and Squad (4 tags) registration.
- Free entry only; one team registration per player per tournament.
- Private Room ID/password shown only to registered players after the configured room-open window.
- XP: +50 for joining, +50 for completing a match, +200 for a published result plus the XP prize assigned by admin.
- Daily XP rewards with a 7-day sequence and 24-hour claim cooldown.
- Levels every 500 XP, player titles, wins and XP leaderboard.
- Player notifications, match status and YouTube spectate links.
- Wallet page/navigation retained and clearly marked Coming Soon.

### Admin panel (/admin/)
- Verified owner/admin/moderator access.
- Dashboard: player count, active players, tournament totals, registered teams and XP awarded.
- Player search, profile view/edit, messages, block/unblock and soft-delete.
- Create/edit/delete tournaments, start/complete/cancel matches, set private room credentials.
- Publish match ranks and XP prizes; results, XP and leaderboard changes are committed in a Firestore transaction.
- Promotions and announcements (image URL fields instead of Storage uploads).
- Public settings, room-open timing, staff roles and audit log.
- No deposit, UPI, payment-proof, withdrawal or cash-payout controls.

## What changed for Firebase Spark

- Cloud Functions and their dependency folder were removed from this branch.
- Firebase Storage and its rules were removed from the deployment config.
- Tournament entry fees are forced to 0; prize pools and results are XP, not rupees.
- Cash wallet balances are never writable by the website. Deposits and withdrawals are disabled.
- Daily rewards and tournament operations use Firestore transactions with restrictive security rules.
- Admin authorization uses a verified owner email allowlist and owner-managed admin_roles documents. Firestore rules enforce privileged writes.
- The player/admin frontends use public/spark-api.js instead of callable Cloud Functions.

**Important architecture limitation:** Spark has no trusted Cloud Functions runtime. Firestore Security Rules enforce permitted data changes, but operations requiring trusted server-only execution (Firebase Auth account disabling, FCM push delivery, scheduled reminders/expiry, external payment webhooks, and authoritative anti-cheat) are not part of this free edition. Admin block/unblock and soft-delete are application-level access flags, not Firebase Authentication account disablement. Do not use this edition for real-money tournaments.

## Firebase setup

1. Open Firebase Console and select project ucesportslast.
2. In Authentication → Sign-in method, enable Google. If you want email/password sign-in for the admin page, enable Email/Password too.
3. In Authentication → Settings → Authorized domains, add your deployed domain.
4. Confirm public/firebase-config.js contains the correct Firebase web-app config for ucesportslast.
5. Create/enable Cloud Firestore in the same region as your existing database. Do not create Firebase Storage or enable billing for this branch.
6. Verify that the owner account ucwebdeveloper07@gmail.com can sign in with Google and that its email is verified.
7. Deploy Firestore rules and Hosting from this branch.

The owner email is an allowlist identifier, not a password or API secret. To change the owner account, update the email in both firestore.rules and public/spark-api.js before deploying. Staff roles can then be assigned by the owner from /admin/ using the target user's Firebase Auth UID.

## Local build and deploy

Requirements: Node.js 20.19+ and Firebase CLI.

```bash
npm install
npm run build
firebase login
firebase use ucesportslast
firebase deploy --only firestore:rules
firebase deploy --only hosting
```

For a combined deployment:

```bash
firebase deploy --only hosting,firestore
```

For Vercel, import the repository and keep vercel.json pointing at public/. The npm run build script validates required project files and parses inline JavaScript in the player page, admin page and Spark API. It does not prove that a live Firebase project has the right Auth provider, rules deployment, indexes, or permissions; complete the manual smoke tests below.

## Required first-run checks

1. Google sign-in creates a profile with level 1 and 0 XP.
2. Profile name, mobile and game IDs save and remain after sign-out/sign-in.
3. Create a future Solo, Duo and Squad tournament in /admin/.
4. Join with exactly 1, 2 or 4 player tags; verify team count and +50 XP.
5. Try joining twice and try joining a full/started tournament; both must be rejected.
6. Before the room-open window, room details must be denied; after it opens, only registered players and staff can read them.
7. Claim daily XP once; a second claim within 24 hours must be rejected.
8. Start and complete a tournament; completion XP must be awarded only once.
9. Publish results; verify rank, XP prize, wins, leaderboard and public result document.
10. Verify announcements, promotions, admin role access and audit logs.
11. Confirm wallet actions are disabled and no deposit/withdrawal/cash-prize flow is exposed.
12. Verify a normal signed-in player cannot create tournaments, set rooms, publish results, edit other users, change roles or write wallet balances.

## Existing data and compatibility

This branch does not delete existing Firestore collections. Old wallets, transactions, deposits, withdrawals, payment records and tournament data may remain in the database, but the Spark UI does not process or credit money. Existing paid tournaments should be reviewed and recreated as free-entry XP tournaments before public use. Existing custom-claim staff roles from the old Functions version are not automatically migrated; the owner must assign staff documents from the new admin panel.

The current build is a static Firebase web app and can later be wrapped as a PWA/Capacitor Android app after the web smoke tests pass.
