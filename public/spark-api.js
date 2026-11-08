/* UC ESPORTS TOURNAMENT — Firebase Spark client API.
 * All privileged writes are protected by firestore.rules. No Cloud Functions,
 * Firebase Storage, wallet credits, payment processing or cash payouts.
 */
(function (global) {
  'use strict';
  const OWNER_EMAIL = 'ucwebdeveloper07@gmail.com';
  const DAILY_XP = [20, 25, 30, 35, 40, 45, 50];
  const GAME_KEYS = ['ff', 'bg', 'mc'];
  const F = () => firebase.firestore.FieldValue;
  const T = () => firebase.firestore.Timestamp;
  const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 3000);
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const titleFor = level => level >= 20 ? 'Legend' : level >= 10 ? 'Elite' : level >= 5 ? 'Veteran' : 'Rookie';
  const levelFor = xp => Math.floor(Number(xp || 0) / 500) + 1;
  const expectedSeats = type => {
    const s = String(type || '').toLowerCase();
    return s.includes('squad') ? 4 : s.includes('duo') ? 2 : 1;
  };
  const fail = message => { throw new Error(message); };

  function create(db, auth) {
    const now = () => Date.now();
    const uid = () => {
      const u = auth.currentUser;
      if (!u) fail('Please sign in first.');
      return u.uid;
    };
    const userRef = id => db.doc('users/' + id);
    const tournamentRef = id => db.doc('tournaments/' + id);
    const registrationRef = (tid, id) => db.doc('registrations/' + tid + '_' + id);
    const leaderboardRef = id => db.doc('leaderboards/' + id);

    async function profile() {
      const u = auth.currentUser;
      if (!u) fail('Please sign in first.');
      const ref = userRef(u.uid);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          const name = clean(u.displayName || (u.email || 'Player').split('@')[0], 24);
          tx.set(ref, {
            uid: u.uid, email: u.email || '', username: name.length >= 3 ? name : 'Player_' + u.uid.slice(0, 4),
            photoURL: u.photoURL || '', mobile: '', gameIds: { ff: '', bg: '', mc: '' },
            notify: { match: true, room: true }, blocked: false, deleted: false,
            wins: 0, joined: 0, xp: 0, level: 1, title: 'Rookie', dailyStreak: 0,
            createdAt: F().serverTimestamp(), lastSeen: F().serverTimestamp()
          });
        } else {
          tx.update(ref, { lastSeen: F().serverTimestamp() });
        }
      });
    }

    async function getRole() {
      const u = auth.currentUser;
      if (!u || !u.emailVerified) return '';
      if (String(u.email || '').toLowerCase() === OWNER_EMAIL) return 'superadmin';
      const snap = await db.doc('admin_roles/' + u.uid).get();
      return snap.exists ? String((snap.data() || {}).role || '') : '';
    }

    async function requireRole(min) {
      const role = await getRole();
      const rank = { moderator: 1, admin: 2, superadmin: 3 };
      if (!rank[role] || rank[role] < (rank[min] || 1)) fail('This account does not have permission for that action.');
      return role;
    }

    async function audit(action, data) {
      const u = auth.currentUser;
      await db.collection('audit_logs').add({
        uid: u.uid, email: u.email || '', action: clean(action, 100),
        data: data || {}, at: F().serverTimestamp()
      });
    }

    async function note(targetUid, title, body) {
      await db.collection('notifications').add({
        uid: targetUid, title: clean(title, 80), body: clean(body, 1000),
        read: false, at: F().serverTimestamp()
      });
    }

    function validateMembers(players, seats) {
      if (!Array.isArray(players) || players.length !== seats) fail('This tournament requires exactly ' + seats + ' player tag(s).');
      return players.map(p => {
        const ign = clean(p && p.ign, 24), gameId = clean(p && p.gameId, 20);
        if (!/^[\w ]{3,24}$/.test(ign) || !/^[\w -]{3,20}$/.test(gameId)) fail('Check every in-game name and game ID (3–24 characters).');
        return { ign: ign, gameId: gameId };
      });
    }

    async function joinTournament(data) {
      const id = clean(data.tid, 120), me = uid();
      if (!id) fail('Tournament ID is missing.');
      if (data.age18 !== true) fail('You must confirm that you are 18 or older.');
      const tr = tournamentRef(id), rr = registrationRef(id, me), ur = userRef(me), lr = leaderboardRef(me);
      let awarded = 0;
      await db.runTransaction(async tx => {
        const values = await Promise.all([tx.get(tr), tx.get(rr), tx.get(ur), tx.get(lr)]);
        const ts = values[0], rs = values[1], us = values[2], ls = values[3];
        if (!ts.exists) fail('Tournament not found.');
        const tour = ts.data(), user = us.data() || {};
        const seats = expectedSeats(tour.type);
        const members = validateMembers(data.players || [], seats);
        if (!us.exists || user.blocked || user.deleted) fail('Your account cannot join tournaments.');
        if (rs.exists && rs.data().status === 'registered') fail('You have already joined this tournament.');
        if (tour.status !== 'upcoming' || !tour.startAt || tour.startAt.toMillis() <= now()) fail('Registration is closed.');
        if (Number(tour.joined || 0) >= Number(tour.max || 0)) fail('This tournament is full.');
        const xp = Number(user.xp || 0) + 50, level = levelFor(xp);
        const regData = {
          tid: id, uid: me, ign: members[0].ign, gameId: members[0].gameId,
          members: members, seatCount: seats, fee: 0, status: 'registered',
          completionXpAwarded: false, resultPublished: false,
          at: F().serverTimestamp()
        };
        tx.set(rr, regData);
        tx.set(db.doc('tournament_rosters/' + id + '/teams/' + me), {
          uid: me, username: user.username || 'Player', members: members,
          seatCount: seats, status: 'registered', at: F().serverTimestamp()
        });
        tx.update(tr, { joined: F().increment(1), playerCount: F().increment(seats) });
        tx.update(ur, {
          joined: F().increment(1), xp: xp, level: level, title: titleFor(level),
          lastJoinId: id + '_' + me
        });
        tx.set(lr, {
          uid: me, username: user.username || 'Player', photoURL: user.photoURL || '',
          xp: xp, wins: Number(user.wins || 0)
        }, { merge: true });
        tx.set(db.collection('notifications').doc(), {
          uid: me, title: 'Registration confirmed', body: 'You joined ' + clean(tour.title, 100) + '. +50 XP earned.',
          read: false, at: F().serverTimestamp()
        });
        awarded = 50;
      });
      return { ok: true, xp: awarded };
    }

    async function getRoom(data) {
      const id = clean(data.tid, 120), me = uid();
      const values = await Promise.all([
        registrationRef(id, me).get(), tournamentRef(id).get(),
        db.doc('tournaments/' + id + '/private/room').get(),
        db.doc('settings/public').get()
      ]);
      const reg = values[0], tour = values[1], room = values[2], settings = values[3].data() || {};
      if (!reg.exists || reg.data().status !== 'registered') fail('Join this tournament to see the room.');
      if (!tour.exists || !['upcoming', 'live'].includes(tour.data().status)) fail('This match is over.');
      const openMinutes = Math.max(0, Math.min(180, Number(settings.roomOpenMinutes || 15)));
      if (now() < tour.data().startAt.toMillis() - openMinutes * 60000) fail('The room opens ' + openMinutes + ' minutes before the match.');
      if (!room.exists) fail('The organiser has not added the room yet.');
      return { roomId: room.data().roomId || '', roomPass: room.data().roomPass || '' };
    }

    async function claimDailyReward() {
      const me = uid(), ur = userRef(me), lr = leaderboardRef(me);
      let result = null;
      await db.runTransaction(async tx => {
        const values = await Promise.all([tx.get(ur), tx.get(lr)]);
        const us = values[0], ls = values[1];
        if (!us.exists) fail('Player profile not found. Please sign in again.');
        const user = us.data();
        if (user.blocked || user.deleted) fail('Your account cannot claim rewards.');
        const last = user.lastDailyClaimAt && user.lastDailyClaimAt.toMillis ? user.lastDailyClaimAt.toMillis() : 0;
        if (last && now() - last < 24 * 60 * 60 * 1000) fail('Your daily XP reward has already been claimed. Try again after 24 hours.');
        const streak = (Number(user.dailyStreak || 0) % 7) + 1;
        const reward = DAILY_XP[streak - 1];
        const xp = Number(user.xp || 0) + reward, level = levelFor(xp);
        tx.update(ur, {
          xp: xp, level: level, title: titleFor(level), dailyStreak: streak,
          lastDailyClaimAt: F().serverTimestamp()
        });
        tx.set(lr, {
          uid: me, username: user.username || 'Player', photoURL: user.photoURL || '',
          xp: xp, wins: Number(user.wins || 0)
        }, { merge: true });
        tx.set(db.collection('notifications').doc(), {
          uid: me, title: 'Daily XP claimed', body: '+' + reward + ' XP. Streak: ' + streak + '/7.',
          read: false, at: F().serverTimestamp()
        });
        result = { reward: reward, streak: streak };
      });
      return result;
    }

    async function saveProfile(data) {
      const me = uid(), ur = userRef(me), lr = leaderboardRef(me);
      const username = clean(data.username, 24), mobile = clean(data.mobile, 18);
      if (username.length < 3) fail('Username must be 3–24 characters.');
      if (mobile && !/^[+0-9 -]{7,18}$/.test(mobile)) fail('Check the mobile number.');
      const gameIds = {};
      GAME_KEYS.forEach(k => { gameIds[k] = clean(data.gameIds && data.gameIds[k], 40); });
      const photoURL = clean(data.photoURL, 1500);
      const batch = db.batch();
      batch.update(ur, { username: username, mobile: mobile, photoURL: photoURL, gameIds: gameIds });
      const snap = await ur.get();
      const old = snap.data() || {};
      batch.set(lr, {
        uid: me, username: username, photoURL: photoURL,
        xp: Number(old.xp || 0), wins: Number(old.wins || 0)
      }, { merge: true });
      await batch.commit();
      return { ok: true };
    }

    async function adminUpsert(data) {
      const col = clean(data.col, 40), id = clean(data.id, 140);
      const minRole = col === 'promotions' || col === 'settings' ? 'admin' : 'moderator';
      await requireRole(data.del ? 'admin' : minRole);
      if (!['tournaments', 'announcements', 'promotions', 'settings'].includes(col)) fail('Unsupported admin collection.');
      const docId = col === 'settings' ? 'public' : (id || db.collection(col).doc().id);
      const ref = db.doc(col + '/' + docId), oldSnap = await ref.get();
      if (data.del) {
        if (col === 'tournaments' && oldSnap.exists && Number(oldSnap.data().joined || 0) > 0) fail('This tournament already has players. Cancel it instead.');
        await ref.delete();
        if (col === 'tournaments') await db.doc('tournaments/' + docId + '/private/room').delete().catch(() => {});
        await audit('delete.' + col, { id: docId });
        return { ok: true };
      }
      const raw = data.data || {}, x = {};
      if (col === 'tournaments') {
        const title = clean(raw.title, 100), game = clean(raw.game, 40), type = clean(raw.type || 'Solo', 30);
        const max = Number(raw.max), prize = Number(raw.prize || 0), startMs = Number(raw.startAt);
        if (!title || !game || !Number.isInteger(max) || max < 1 || !Number.isFinite(startMs) || startMs <= now()) fail('Add a title, game, future date and valid slots.');
        if (!Number.isInteger(prize) || prize < 0) fail('XP prize pool must be a non-negative whole number.');
        const streamUrl = clean(raw.streamUrl, 500);
        if (streamUrl) {
          let url;
          try { url = new URL(streamUrl); } catch (_) { fail('Enter a valid YouTube URL.'); }
          if (!['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com', 'youtube-nocookie.com'].includes(url.hostname)) fail('Only YouTube URLs are allowed.');
        }
        Object.assign(x, {
          title: title, game: game, gameKey: slug(game), type: type,
          map: clean(raw.map, 80), poster: clean(raw.poster, 1500),
          fee: 0, prize: prize, max: max, startAt: T().fromMillis(startMs),
          rules: clean(raw.rules, 3000), split: clean(raw.split, 300),
          featured: raw.featured === true, streamUrl: streamUrl
        });
        if (!oldSnap.exists) Object.assign(x, {
          status: 'upcoming', joined: 0, playerCount: 0, resultsPublished: false,
          createdAt: F().serverTimestamp()
        });
        else if (max < Number(oldSnap.data().joined || 0)) fail('Slots cannot be lower than the number of teams already registered.');
      } else if (col === 'announcements') {
        x.title = clean(raw.title, 80); x.text = clean(raw.text, 1000);
        x.enabled = raw.enabled === true; x.pinned = raw.pinned === true;
        if (!x.title || !x.text) fail('Announcement title and message are required.');
      } else if (col === 'promotions') {
        x.title = clean(raw.title, 100); x.kind = clean(raw.kind, 30);
        x.link = clean(raw.link, 500); x.image = clean(raw.image, 1500);
        x.enabled = raw.enabled === true; x.order = Number(raw.order || 0);
        if (!x.title) fail('Promotion title is required.');
        if (x.link && !/^https:\/\//i.test(x.link)) fail('Promotion links must use HTTPS.');
      } else {
        const allowed = ['brandName', 'games', 'supportWhatsapp', 'supportEmail', 'supportUrl', 'helpUrl', 'roomOpenMinutes'];
        allowed.forEach(k => { if (raw[k] !== undefined) x[k] = clean(raw[k], 500); });
        if (raw.roomOpenMinutes !== undefined) x.roomOpenMinutes = Math.max(0, Math.min(180, Number(raw.roomOpenMinutes) || 15));
      }
      await ref.set(x, { merge: true });
      await audit('save.' + col, { id: docId });
      return { id: docId };
    }

    async function adminSetRoom(data) {
      await requireRole('moderator');
      const id = clean(data.tid, 120);
      const snap = await tournamentRef(id).get();
      if (!snap.exists) fail('Tournament not found.');
      const roomId = clean(data.roomId, 40), roomPass = clean(data.roomPass, 40);
      if (!roomId || !roomPass) fail('Room ID and password are required.');
      await db.doc('tournaments/' + id + '/private/room').set({
        roomId: roomId, roomPass: roomPass, at: F().serverTimestamp()
      });
      await audit('setRoom', { tid: id });
      return { ok: true };
    }

    async function updateLeaderboard(tx, uidValue, user) {
      const xp = Number(user.xp || 0), wins = Number(user.wins || 0);
      tx.set(leaderboardRef(uidValue), {
        uid: uidValue, username: user.username || 'Player',
        photoURL: user.photoURL || '', xp: xp, wins: wins
      }, { merge: true });
    }

    async function adminTournamentAction(data) {
      await requireRole('moderator');
      const id = clean(data.tid, 120), action = clean(data.action, 20), tr = tournamentRef(id);
      const snap = await tr.get();
      if (!snap.exists) fail('Tournament not found.');
      const status = snap.data().status;
      if (action === 'start') {
        if (status !== 'upcoming') fail('Only upcoming tournaments can be started.');
        await tr.update({ status: 'live' });
      } else if (action === 'complete') {
        if (!['live', 'completed'].includes(status)) fail('Only live tournaments can be completed.');
        const regs = await db.collection('registrations').where('tid', '==', id).where('status', '==', 'registered').get();
        for (const doc of regs.docs) {
          await db.runTransaction(async tx => {
            const rr = doc.ref, ur = userRef(doc.data().uid), lr = leaderboardRef(doc.data().uid);
            const vals = await Promise.all([tx.get(rr), tx.get(ur), tx.get(lr)]);
            const r = vals[0], u = vals[1];
            if (!r.exists || r.data().status !== 'registered' || r.data().completionXpAwarded || !u.exists) return;
            const user = u.data(), xp = Number(user.xp || 0) + 50, level = levelFor(xp);
            const next = Object.assign({}, user, { xp: xp, level: level, title: titleFor(level) });
            tx.update(ur, { xp: xp, level: level, title: titleFor(level) });
            tx.update(rr, { completionXpAwarded: true });
            await updateLeaderboard(tx, doc.data().uid, next);
            tx.set(db.collection('notifications').doc(), {
              uid: doc.data().uid, title: 'Match completed', body: 'You earned +50 XP for completing ' + clean(snap.data().title, 100) + '.',
              read: false, at: F().serverTimestamp()
            });
          });
        }
        await tr.update({ status: 'completed' });
      } else if (action === 'cancel') {
        if (!['upcoming', 'live'].includes(status)) fail('This tournament cannot be cancelled.');
        await tr.update({ status: 'cancelled' });
        const regs = await db.collection('registrations').where('tid', '==', id).where('status', '==', 'registered').get();
        for (let i = 0; i < regs.docs.length; i += 350) {
          const batch = db.batch();
          regs.docs.slice(i, i + 350).forEach(doc => {
            batch.update(doc.ref, { status: 'cancelled' });
            batch.set(db.doc('tournament_rosters/' + id + '/teams/' + doc.data().uid), { status: 'cancelled' }, { merge: true });
            batch.set(db.collection('notifications').doc(), {
              uid: doc.data().uid, title: 'Tournament cancelled',
              body: clean(snap.data().title, 100) + ' was cancelled by the organiser.',
              read: false, at: F().serverTimestamp()
            });
          });
          await batch.commit();
        }
      } else fail('Unknown tournament action.');
      await audit('tournament.' + action, { tid: id });
      return { ok: true };
    }

    async function adminPublishResults(data) {
      await requireRole('admin');
      const id = clean(data.tid, 120), winners = Array.isArray(data.winners) ? data.winners : [];
      if (!winners.length || winners.length > 50) fail('Add between 1 and 50 winners.');
      const seen = new Set();
      winners.forEach(w => {
        if (!w || typeof w.uid !== 'string' || seen.has(w.uid) || !Number.isInteger(w.rank) || w.rank < 1 || !Number.isInteger(w.prize) || w.prize < 0) fail('Each winner needs a unique player, a whole-number rank and a whole-number XP prize.');
        seen.add(w.uid);
      });
      const tr = tournamentRef(id), tourSnap = await tr.get();
      if (!tourSnap.exists) fail('Tournament not found.');
      const tour = tourSnap.data();
      if (!['live', 'completed'].includes(tour.status) || tour.resultsPublished) fail('Results cannot be published for this tournament.');
      if (winners.reduce((sum, w) => sum + w.prize, 0) > Number(tour.prize || 0)) fail('XP prizes add up to more than the tournament XP pool.');
      const results = [];
      for (const winner of winners) {
        await db.runTransaction(async tx => {
          const rr = registrationRef(id, winner.uid), ur = userRef(winner.uid), lr = leaderboardRef(winner.uid);
          const vals = await Promise.all([tx.get(rr), tx.get(ur), tx.get(lr)]);
          const reg = vals[0], us = vals[1];
          if (!reg.exists || reg.data().status !== 'registered') fail('A selected winner is not registered in this tournament.');
          if (reg.data().resultPublished) {
            results.push({ uid: winner.uid, rank: winner.rank, prize: winner.prize });
            return;
          }
          if (!us.exists) fail('A selected player profile is missing.');
          const user = us.data(), bonusXp = 200 + winner.prize;
          const xp = Number(user.xp || 0) + bonusXp;
          const wins = Number(user.wins || 0) + (winner.rank === 1 ? 1 : 0);
          const level = levelFor(xp);
          const next = Object.assign({}, user, { xp: xp, wins: wins, level: level, title: titleFor(level) });
          tx.update(ur, { xp: xp, wins: wins, level: level, title: titleFor(level) });
          tx.update(rr, { rank: winner.rank, prizeXp: winner.prize, resultPublished: true });
          await updateLeaderboard(tx, winner.uid, next);
          tx.set(db.collection('notifications').doc(), {
            uid: winner.uid, title: 'Tournament result',
            body: 'You placed #' + winner.rank + ' in ' + clean(tour.title, 100) + ' and earned ' + bonusXp + ' XP.',
            read: false, at: F().serverTimestamp()
          });
          results.push({ uid: winner.uid, rank: winner.rank, prize: winner.prize });
        });
      }
      await db.runTransaction(async tx => {
        const current = await tx.get(tr);
        if (!current.exists || current.data().resultsPublished) fail('Results were already published.');
        tx.set(db.doc('results/' + id), {
          tid: id, title: clean(tour.title, 100), game: clean(tour.game, 40),
          winners: results, at: F().serverTimestamp()
        });
        tx.update(tr, { status: 'completed', resultsPublished: true });
      });
      await audit('publishResults', { tid: id, winners: results.length });
      return { ok: true };
    }

    async function adminStats() {
      await requireRole('moderator');
      const values = await Promise.all([
        db.collection('users').get(), db.collection('tournaments').get(),
        db.collection('registrations').where('status', '==', 'registered').get()
      ]);
      const tours = values[1].docs.map(d => d.data());
      return {
        users: values[0].size,
        active: values[0].docs.filter(d => {
          const t = d.data().lastSeen;
          return t && t.toMillis && now() - t.toMillis() <= 7 * 86400000;
        }).length,
        tours: tours.length,
        live: tours.filter(t => t.status === 'live').length,
        done: tours.filter(t => t.status === 'completed').length,
        registeredTeams: values[2].size,
        xpAwarded: values[0].docs.reduce((a, d) => a + Number(d.data().xp || 0), 0)
      };
    }

    async function adminMessageUser(data) {
      await requireRole('moderator');
      const target = clean(data.uid, 128), title = clean(data.title, 80), body = clean(data.body, 1000);
      if (!title || !body || !(await userRef(target).get()).exists) fail('Enter a title and message for an existing user.');
      await note(target, title, body);
      await audit('user.message', { uid: target, title: title });
      return { ok: true };
    }

    async function adminEditUser(data) {
      await requireRole('admin');
      const target = clean(data.uid, 128), src = data.data || {}, changes = {};
      if (typeof src.username === 'string' && clean(src.username, 24).length >= 3) changes.username = clean(src.username, 24);
      if (typeof src.mobile === 'string' && (!src.mobile || /^[+0-9 -]{7,18}$/.test(src.mobile))) changes.mobile = clean(src.mobile, 18);
      if (typeof src.photoURL === 'string' && src.photoURL.length <= 1500) changes.photoURL = clean(src.photoURL, 1500);
      if (src.gameIds && typeof src.gameIds === 'object' && !Array.isArray(src.gameIds)) {
        changes.gameIds = {};
        GAME_KEYS.forEach(k => { changes.gameIds[k] = clean(src.gameIds[k], 40); });
      }
      if (!Object.keys(changes).length) fail('No valid profile fields were supplied.');
      await userRef(target).update(changes);
      await audit('user.edit', { uid: target, fields: Object.keys(changes) });
      return { ok: true };
    }

    async function adminBlockUser(data) {
      await requireRole('admin');
      const target = clean(data.uid, 128), user = await userRef(target).get();
      if (!user.exists) fail('Player not found.');
      await userRef(target).update({ blocked: data.blocked === true });
      await audit(data.blocked === true ? 'user.block' : 'user.unblock', { uid: target });
      return { ok: true };
    }

    async function adminDeleteUser(data) {
      await requireRole('admin');
      const target = clean(data.uid, 128);
      if (target === uid()) fail('You cannot delete your own admin profile.');
      const user = await userRef(target).get();
      if (!user.exists) fail('Player not found.');
      await userRef(target).update({ blocked: true, deleted: true, deletedAt: F().serverTimestamp() });
      await audit('user.softDelete', { uid: target });
      return { ok: true };
    }

    async function setRole(data) {
      await requireRole('superadmin');
      const target = clean(data.uid, 128), role = clean(data.role, 20);
      if (!target || target === uid() || !['admin', 'moderator', 'none'].includes(role)) fail('Choose another account and a valid staff role.');
      const ref = db.doc('admin_roles/' + target);
      if (role === 'none') await ref.delete();
      else await ref.set({ role: role, by: uid(), at: F().serverTimestamp() });
      await audit('setRole', { uid: target, role: role });
      return { ok: true };
    }

    async function call(name, data) {
      const d = data || {};
      switch (name) {
        case 'ensurePlayerProfile': return profile();
        case 'joinTournament': return joinTournament(d);
        case 'getRoom': return getRoom(d);
        case 'claimDailyReward': return claimDailyReward();
        case 'adminUpsert': return adminUpsert(d);
        case 'adminSetRoom': return adminSetRoom(d);
        case 'adminTournamentAction': return adminTournamentAction(d);
        case 'adminPublishResults': return adminPublishResults(d);
        case 'adminStats': return adminStats();
        case 'adminMessageUser': return adminMessageUser(d);
        case 'adminEditUser': return adminEditUser(d);
        case 'adminBlockUser': return adminBlockUser(d);
        case 'adminDeleteUser': return adminDeleteUser(d);
        case 'setRole': return setRole(d);
        default: fail('This action is unavailable in the Firebase Spark version: ' + name);
      }
    }

    return { call: call, profile: profile, getRole: getRole, requireRole: requireRole, saveProfile: saveProfile };
  }

  global.UCEFirebaseSpark = { create: create, ownerEmail: OWNER_EMAIL, dailyXp: DAILY_XP.slice() };
})(window);
