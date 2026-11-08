const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const b64url = (value) => {
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4)), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};
const base64urlBytes = (bytes) => {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const jsonResponse = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
const field = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value)
    ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(field) } };
  if (typeof value === "object") {
    if (value.__timestamp) return { timestampValue: value.__timestamp };
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, field(v)])) } };
  }
  return { stringValue: String(value) };
};
const unfield = (value) => {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, unfield(v)]));
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(unfield);
  return null;
};
const fields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, field(v)]));
const readFields = (doc) => Object.fromEntries(Object.entries(doc?.fields || {}).map(([k, v]) => [k, unfield(v)]));
const pemBytes = (pem) => Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")), c => c.charCodeAt(0));

async function verifyFirebaseIdToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Firebase ID token.");
  const header = JSON.parse(b64url(parts[0]));
  const claims = JSON.parse(b64url(parts[1]));
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported token signature.");
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId || claims.iss !== "https://securetoken.google.com/" + projectId ||
      !claims.sub || claims.sub.length > 128 || claims.exp <= now || claims.iat > now + 60 ||
      !claims.auth_time || claims.auth_time > now + 60) throw new Error("Firebase session is invalid or expired.");

  const jwksResponse = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!jwksResponse.ok) throw new Error("Could not load Firebase signing keys.");
  const jwks = await jwksResponse.json();
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Firebase signing key was not found.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
    Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "===".slice((parts[2].length + 3) % 4)), c => c.charCodeAt(0)),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!valid) throw new Error("Firebase token signature is invalid.");
  return claims;
}

async function googleAccessToken(env) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  if (!sa.client_email || !sa.private_key || !sa.token_uri) throw new Error("Firebase service account secret is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = base64urlBytes(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64urlBytes(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600
  })));
  const unsigned = header + "." + payload;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const assertion = unsigned + "." + base64urlBytes(signature);
  const response = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error("Google service-account authorization failed.");
  return result.access_token;
}

const firestoreBase = (projectId) =>
  "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectId) +
  "/databases/(default)/documents";
async function firestoreRequest(env, path, options = {}) {
  const token = await googleAccessToken(env);
  const response = await fetch(firestoreBase(env.FIREBASE_PROJECT_ID) + path, {
    ...options,
    headers: { authorization: "Bearer " + token, ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || "Firestore request failed.");
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}
async function getDocument(env, path) {
  try { return await firestoreRequest(env, "/" + path); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
async function createDocument(env, collection, id, data) {
  const query = "?documentId=" + encodeURIComponent(id);
  return firestoreRequest(env, "/" + collection + query, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: fields(data) })
  });
}
async function patchDocument(env, path, data) {
  const mask = Object.keys(data).map(k => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
  return firestoreRequest(env, "/" + path + (mask ? "?" + mask : ""), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: fields(data) })
  });
}
async function razorpayRequest(env, path, body) {
  const auth = btoa(env.RZP_KEY_ID + ":" + env.RZP_KEY_SECRET);
  const response = await fetch("https://api.razorpay.com/v1" + path, {
    method: "POST",
    headers: { authorization: "Basic " + auth, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Razorpay API rejected QR creation", response.status, result.error?.code || "unknown");
    throw new Error("Razorpay could not create the payment QR.");
  }
  return result;
}
async function verifyWebhookSignature(rawBody, signature, secret) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, rawBody);
  const expected = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  let diff = expected.length ^ signature.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return diff === 0;
}
function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  const permitted = !origin || allowed.includes(origin);
  return {
    "access-control-allow-origin": origin && permitted ? origin : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}
async function ensurePlayerProfile(claims, env) {
  const uid = claims.sub;
  let userDoc = await getDocument(env, "users/" + uid);
  if (!userDoc) {
    const rawName = String(claims.name || (claims.email || "player").split("@")[0]).replace(/[^\w ]/g, "").slice(0, 24);
    const username = rawName.length >= 3 ? rawName : "Player_" + uid.slice(0, 4);
    try {
      await createDocument(env, "users", uid, {
        username,
        email: claims.email || "",
        photoURL: claims.picture || "",
        mobile: "",
        gameIds: {},
        notify: { match: true, room: true, pay: true },
        blocked: false,
        deleted: false,
        wins: 0,
        joined: 0,
        xp: 0,
        level: 1,
        title: "Rookie",
        dailyStreak: 0,
        createdAt: { __timestamp: new Date().toISOString() },
        lastSeen: { __timestamp: new Date().toISOString() }
      });
    } catch (e) {
      if (e.status !== 409) throw e;
    }
    userDoc = await getDocument(env, "users/" + uid);
  }
  const walletDoc = await getDocument(env, "wallets/" + uid);
  if (!walletDoc) {
    try {
      await createDocument(env, "wallets", uid, {
        deposit: 0, winnings: 0, bonus: 0, earned: 0, withdrawn: 0
      });
    } catch (e) {
      if (e.status !== 409) throw e;
    }
  }
  const user = readFields(userDoc);
  if (!userDoc || user.blocked === true || user.deleted === true)
    throw new Error("This account is blocked or unavailable.");
  return { user: readFields(userDoc), walletReady: true };
}

async function handleEnsureProfile(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return jsonResponse({ error: "Sign in to continue." }, 401);
  try {
    const claims = await verifyFirebaseIdToken(authorization.slice(7), env.FIREBASE_PROJECT_ID);
    const result = await ensurePlayerProfile(claims, env);
    return jsonResponse({ success: true, profile: result.user });
  } catch (e) {
    console.error("Profile setup failed", e.message);
    return jsonResponse({ error: "Could not initialize your player profile." }, 403);
  }
}

async function handleCreateQr(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return jsonResponse({ error: "Sign in to continue." }, 401);
  let claims;
  try { claims = await verifyFirebaseIdToken(authorization.slice(7), env.FIREBASE_PROJECT_ID); }
  catch (e) { return jsonResponse({ error: "Your login session is invalid. Sign in again." }, 401); }

  let input;
  try { input = await request.json(); } catch { return jsonResponse({ error: "Invalid request body." }, 400); }
  const amount = input.amount;
  if (!Number.isInteger(amount) || amount < 10 || amount > 50000)
    return jsonResponse({ error: "Deposit amount must be between ₹10 and ₹50,000." }, 400);

  let profile;
  try { profile = await ensurePlayerProfile(claims, env); }
  catch { return jsonResponse({ error: "This account cannot add money." }, 403); }

  const depositId = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = Date.now() + 5 * 60 * 1000;
  await createDocument(env, "deposits", depositId, {
    uid: claims.sub,
    email: claims.email || "",
    amount,
    status: "creating",
    gateway: "razorpay",
    createdAt: { __timestamp: new Date().toISOString() },
    expiresAt: { __timestamp: new Date(expiresAt).toISOString() }
  });

  try {
    const qr = await razorpayRequest(env, "/payments/qr_codes", {
      type: "upi_qr",
      name: "UC ESPORTS",
      usage: "single_use",
      fixed_amount: true,
      payment_amount: amount * 100,
      description: "UC Esports wallet top-up",
      close_by: Math.floor(expiresAt / 1000),
      notes: { depositId, uid: claims.sub }
    });
    if (!qr.id || !qr.image_url) throw new Error("Razorpay QR response was incomplete.");
    await patchDocument(env, "deposits/" + depositId, {
      status: "pending",
      qrId: qr.id,
      qrImage: qr.image_url
    });
    return jsonResponse({ id: depositId, qr: qr.image_url, qrId: qr.id, expiresAt });
  } catch (e) {
    await patchDocument(env, "deposits/" + depositId, {
      status: "failed",
      failureReason: "Razorpay QR creation failed"
    }).catch(() => null);
    console.error("QR creation failed", e.message);
    return jsonResponse({ error: "Razorpay could not create a QR right now. Please try again." }, 502);
  }
}
async function commitVerifiedPayment(env, depositId, payment, deposit, status) {
  const project = env.FIREBASE_PROJECT_ID;
  const depositName = "projects/" + project + "/databases/(default)/documents/deposits/" + depositId;
  const walletName = "projects/" + project + "/databases/(default)/documents/wallets/" + deposit.uid;
  const seenName = "projects/" + project + "/databases/(default)/documents/payments_seen/" + payment.id;
  const transactionName = "projects/" + project + "/databases/(default)/documents/transactions/" + depositId;
  const now = new Date().toISOString();
  const writes = [
    {
      update: { name: depositName, fields: fields({
        status,
        paymentId: payment.id,
        ...(status === "success" ? { paidAt: { __timestamp: now } } : {
          paidAmount: Number(payment.amount || 0) / 100,
          paymentCurrency: payment.currency || ""
        })
      }) },
      updateMask: { fieldPaths: status === "success"
        ? ["status", "paymentId", "paidAt"]
        : ["status", "paymentId", "paidAmount", "paymentCurrency"] },
      currentDocument: { exists: true }
    },
    ...(status === "success" ? [{
      transform: {
        document: walletName,
        fieldTransforms: [{ fieldPath: "deposit", increment: { integerValue: String(deposit.amount) } }]
      }
    }] : []),
    {
      update: { name: seenName, fields: fields({ deposit: depositId, at: { __timestamp: now } }) },
      currentDocument: { exists: false }
    }
  ];
  if (status === "success") {
    writes.push({
      update: { name: transactionName, fields: fields({
        uid: deposit.uid, type: "deposit", amount: deposit.amount,
        method: "razorpay", status: "success", ref: depositId,
        at: { __timestamp: now }
      }) },
      currentDocument: { exists: false }
    });
  }
  return firestoreRequest(env, ":commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ writes })
  });
}
async function handleWebhook(request, env) {
  const raw = await request.arrayBuffer();
  const signature = request.headers.get("x-razorpay-signature") || "";
  if (!await verifyWebhookSignature(raw, signature, env.RZP_WEBHOOK_SECRET || ""))
    return new Response("bad signature", { status: 401 });
  let event;
  try { event = JSON.parse(new TextDecoder().decode(raw)); }
  catch { return new Response("invalid JSON", { status: 400 }); }
  if (event.event !== "qr_code.credited") return new Response("ignored", { status: 200 });

  const payment = event.payload?.payment?.entity;
  const qr = event.payload?.qr_code?.entity;
  const depositId = qr?.notes?.depositId;
  if (!payment?.id || !qr?.id || !depositId || !/^[a-f0-9]{32}$/i.test(depositId))
    return new Response("invalid event payload", { status: 400 });

  const [depositDoc, seenDoc] = await Promise.all([
    getDocument(env, "deposits/" + depositId),
    getDocument(env, "payments_seen/" + payment.id)
  ]);
  if (seenDoc) return new Response("duplicate", { status: 200 });
  if (!depositDoc) return new Response("unknown deposit", { status: 200 });
  const deposit = readFields(depositDoc);
  if (deposit.qrId !== qr.id || !["pending", "expired"].includes(deposit.status))
    return new Response("deposit not eligible", { status: 200 });

  const validPayment = payment.status === "captured" &&
    Number(payment.amount) === Number(deposit.amount) * 100 &&
    payment.currency === "INR";
  const status = validPayment && deposit.status === "pending" ? "success" : "review";
  try {
    await commitVerifiedPayment(env, depositId, payment, deposit, status);
    return new Response(status === "success" ? "credited" : "sent to review", { status: 200 });
  } catch (e) {
    // A concurrent/retried webhook may lose the create-only payments_seen race.
    const nowSeen = await getDocument(env, "payments_seen/" + payment.id).catch(() => null);
    if (nowSeen) return new Response("duplicate", { status: 200 });
    console.error("Webhook Firestore commit failed", e.message);
    return new Response("temporary processing failure", { status: 500 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && url.pathname === "/health")
      return jsonResponse({ success: true, service: "UC Esports Razorpay Backend", status: "online" }, 200, cors);
    if (request.method === "POST" && url.pathname === "/ensure-profile") {
      if (request.headers.get("origin") && cors["access-control-allow-origin"] === "null")
        return jsonResponse({ error: "Origin not allowed." }, 403, cors);
      const response = await handleEnsureProfile(request, env);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    }
    if (request.method === "POST" && url.pathname === "/create-qr") {
      if (request.headers.get("origin") && cors["access-control-allow-origin"] === "null")
        return jsonResponse({ error: "Origin not allowed." }, 403, cors);
      const response = await handleCreateQr(request, env);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    }
    if (request.method === "POST" && url.pathname === "/razorpay-webhook")
      return handleWebhook(request, env);
    return jsonResponse({ error: "Not found." }, 404, cors);
  }
};
