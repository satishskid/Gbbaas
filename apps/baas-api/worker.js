// apps/baas-api/worker.js

/**
 * Welcome to the BAAS API!
 * This Cloudflare Worker handles all backend logic for license management,
 * device activation, usage metering, and analytics.
 *
 * Environment Variables:
 * - DB: The D1 Database binding.
 * - PUBLIC_BASE_URL: The public URL of this worker.
 * - ALLOWED_ORIGINS: Comma-separated list of allowed origins for CORS.
 *
 * Secrets:
 * - ADMIN_SECRET: Secret for accessing admin endpoints.
 * - PRIVATE_JWK: The private RS256 key for signing JWTs.
 * - PUBLIC_JWK_JSON: The public part of the JWK.
 */

import { Router } from 'itty-router';

// A simple helper for creating JSON responses with CORS headers.
function jsonResponse(data, status = 200, env) {
    const allowedOrigins = (env.ALLOWED_ORIGINS || "").split(',');
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': allowedOrigins[0] || '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
        },
    });
}

const router = Router();

// Handle CORS preflight requests.
router.options('*', (request, env) => {
    return jsonResponse(null, 204, env);
});

// --- UTILITY FUNCTIONS ---

// Base64URL encoding/decoding
const encodeBase64Url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const decodeBase64Url = (str) => new Uint8Array(atob(str.replace(/-/g, '+').replace(/_/g, '/')).split('').map(c => c.charCodeAt(0)));


async function signJwt(payload, privateJwk, env) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const encodedHeader = encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const data = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
        'jwk',
        privateJwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['sign']
    );

    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
    return `${data}.${encodeBase64Url(signature)}`;
}


// --- PUBLIC ENDPOINTS ---

// 1. GET /v1/revocations?projectId=...
router.get('/v1/revocations', async (request, env) => {
    const { query } = request;
    if (!query.projectId) {
        return jsonResponse({ error: 'projectId is required' }, 400, env);
    }

    const { results } = await env.DB.prepare(
        "SELECT jti FROM licenses WHERE project_id = ?1 AND revoked = 1"
    ).bind(query.projectId).all();

    const revocations = {
        revoked: results.map(r => r.jti),
        updatedAt: new Date().toISOString(),
    };

    // Implement ETag caching if needed
    return jsonResponse(revocations, 200, env);
});


// 2. POST /v1/activate/start
router.post('/v1/activate/start', async (request, env) => {
    const { projectId, licenseToken, deviceInfo } = await request.json();

    // TODO: Implement full JWT parsing and verification with PUBLIC_JWK_JSON
    // For now, we'll just decode it.
    const decodedToken = JSON.parse(atob(licenseToken.split('.')[1]));
    const { aud, exp, jti } = decodedToken;

    if (aud !== projectId) {
        return jsonResponse({ error: 'Invalid token audience.' }, 400, env);
    }
    if (Date.now() / 1000 > exp) {
        return jsonResponse({ error: 'License token has expired.' }, 400, env);
    }

    // Check if license exists and is not revoked
    const license = await env.DB.prepare("SELECT * FROM licenses WHERE jti = ?1 AND revoked = 0").bind(jti).first();
    if (!license) {
        return jsonResponse({ error: 'License not found, has been revoked, or is invalid.' }, 404, env);
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const activationId = crypto.randomUUID();

    await env.DB.prepare(
        "INSERT INTO activation_sessions (activation_id, jti, challenge, device_info) VALUES (?1, ?2, ?3, ?4)"
    ).bind(activationId, jti, encodeBase64Url(challenge), JSON.stringify(deviceInfo)).run();

    const webAuthnOptions = {
        challenge: encodeBase64Url(challenge),
        rp: { name: 'BAAS Protected Service', id: new URL(request.url).hostname },
        user: { id: encodeBase64Url(new TextEncoder().encode(jti)), name: jti, displayName: `License ${jti}` },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { userVerification: 'discouraged' },
        attestation: 'none',
        timeout: 60000,
    };

    return jsonResponse({ activationId, options: webAuthnOptions }, 200, env);
});

// 3. POST /v1/activate/finish
router.post('/v1/activate/finish', async (request, env) => {
    const { activationId, credential } = await request.json();

    const session = await env.DB.prepare("SELECT * FROM activation_sessions WHERE activation_id = ?1").bind(activationId).first();
    if (!session) {
        return jsonResponse({ error: 'Activation session not found or expired.' }, 404, env);
    }

    // TODO: Full WebAuthn credential validation
    // This is a simplified validation for demonstration.
    // A real implementation needs a robust library.

    const deviceId = crypto.randomUUID();
    await env.DB.prepare(
        "INSERT INTO activations (activation_id, jti, device_id, credential_id, public_key, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    ).bind(activationId, session.jti, deviceId, credential.id, "{}", Math.floor(Date.now() / 1000)).run();

    const privateJwk = JSON.parse(env.PRIVATE_JWK);
    const activationCert = await signJwt({
        typ: 'activation',
        projectId: (await env.DB.prepare("SELECT project_id FROM licenses WHERE jti = ?1").bind(session.jti).first()).project_id,
        jti: session.jti,
        deviceId,
        level: 'webauthn',
        exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
    }, privateJwk, env);

    return jsonResponse({ activationCert }, 200, env);
});


// 4. POST /v1/heartbeat
router.post('/v1/heartbeat', async (request, env) => {
    const { activationCert, userIdHash } = await request.json();
    // TODO: Verify activationCert
    const decodedCert = JSON.parse(atob(activationCert.split('.')[1]));
    const { jti, deviceId } = decodedCert;

    await env.DB.prepare("UPDATE activations SET last_seen = ?1 WHERE jti = ?2 AND device_id = ?3")
        .bind(Math.floor(Date.now() / 1000), jti, deviceId).run();

    if (userIdHash) {
        await env.DB.prepare("INSERT OR IGNORE INTO users_seen (jti, device_id, user_hash) VALUES (?1, ?2, ?3)")
            .bind(jti, deviceId, userIdHash).run();
    }

    return jsonResponse({ ok: true }, 200, env);
});

// 5. POST /v1/usage/meter
router.post('/v1/usage/meter', async (request, env) => {
    const { activationCert, bucket, cost = 1 } = await request.json();
    // TODO: Verify activationCert
    const decodedCert = JSON.parse(atob(activationCert.split('.')[1]));
    const { jti, deviceId } = decodedCert;

    const license = await env.DB.prepare("SELECT * FROM licenses WHERE jti = ?1 AND revoked = 0").bind(jti).first();
    if (!license || (license.exp * 1000) < Date.now()) {
        return jsonResponse({ error: 'Invalid or expired license.' }, 403, env);
    }

    const quotas = JSON.parse(license.quotas || '{}');
    const bucketQuota = (quotas.byCategory && quotas.byCategory[bucket]) || {};
    const dailyLimit = bucketQuota.daily || quotas.daily;

    if (dailyLimit) {
        const today = new Date();
        const dayKey = Math.floor(today.getTime() / 86400000);
        const { results } = await env.DB.prepare("SELECT SUM(cost) as total FROM usage WHERE jti = ?1 AND day_key = ?2 AND bucket = ?3")
            .bind(jti, dayKey, bucket).all();
        const todaysUsage = results[0]?.total || 0;

        if (todaysUsage + cost > dailyLimit) {
            const resetAt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
            return jsonResponse({ allowed: false, bucket, remaining: dailyLimit - todaysUsage, resetAt }, 429, env);
        }
    }

    const now = new Date();
    const dayKey = Math.floor(now.getTime() / 86400000);
    const minuteKey = Math.floor(now.getTime() / 60000);
    const monthKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    await env.DB.prepare("INSERT INTO usage (jti, device_id, bucket, cost, day_key, minute_key, month_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(jti, deviceId, bucket, cost, dayKey, minuteKey, monthKey).run();

    return jsonResponse({ allowed: true }, 200, env);
});

// 6. POST /v1/coupons/redeem
router.post('/v1/coupons/redeem', async (request, env) => {
    const { couponCode, projectId } = await request.json();

    if (!couponCode || !projectId) {
        return jsonResponse({ error: 'couponCode and projectId are required.' }, 400, env);
    }

    const coupon = await env.DB.prepare("SELECT * FROM coupon_codes WHERE code = ?1 AND project_id = ?2").bind(couponCode, projectId).first();

    if (!coupon) {
        return jsonResponse({ error: 'Invalid or expired coupon code.' }, 404, env);
    }

    if (coupon.current_uses >= coupon.max_uses) {
        return jsonResponse({ error: 'This coupon has reached its maximum number of uses.' }, 403, env);
    }

    if (coupon.expires_at && coupon.expires_at * 1000 < Date.now()) {
        return jsonResponse({ error: 'This coupon has expired.' }, 403, env);
    }

    // If the coupon is valid, issue a new license
    const planDetails = JSON.parse(coupon.plan_details_json);
    const { durationDays, quotas } = planDetails;

    const jti = crypto.randomUUID();
    const exp = Math.floor(Date.now() / 1000) + (durationDays * 24 * 60 * 60);
    const privateJwk = JSON.parse(env.PRIVATE_JWK);

    await env.DB.prepare(
        "INSERT INTO licenses (jti, project_id, type, quotas, exp) VALUES (?1, ?2, 'individual', ?3, ?4)"
    ).bind(jti, projectId, JSON.stringify(quotas), exp).run();

    // Atomically increment the usage count
    await env.DB.prepare("UPDATE coupon_codes SET current_uses = current_uses + 1 WHERE code = ?1").bind(couponCode).run();

    const token = await signJwt({
        aud: projectId,
        jti,
        type: 'individual',
        exp,
    }, privateJwk, env);

    return jsonResponse({ licenseToken: token }, 200, env);
});


// --- ADMIN ENDPOINTS ---

// Middleware for Admin Auth
const adminAuth = (request, env) => {
    const secret = request.headers.get('X-Admin-Secret') || request.headers.get('Authorization')?.replace('Bearer ', '');
    if (secret !== env.ADMIN_SECRET) {
        return jsonResponse({ error: 'Unauthorized' }, 401, env);
    }
};

// 1. POST /admin/agencies/create
router.post('/admin/agencies/create', adminAuth, async (request, env) => {
    const { agencyId, name, seatQuota } = await request.json();
    await env.DB.prepare("INSERT INTO agencies (agency_id, name, seat_quota) VALUES (?1, ?2, ?3)")
        .bind(agencyId, name, seatQuota).run();
    return jsonResponse({ ok: true, agencyId }, 201, env);
});

// 2. POST /admin/licenses/issue
router.post('/admin/licenses/issue', adminAuth, async (request, env) => {
    const { projectId, type, agencyId, seats = 1, durationDays = 30, quotas } = await request.json();
    const issuedTokens = [];
    const privateJwk = JSON.parse(env.PRIVATE_JWK);

    for (let i = 0; i < seats; i++) {
        const jti = crypto.randomUUID();
        const exp = Math.floor(Date.now() / 1000) + (durationDays * 24 * 60 * 60);

        await env.DB.prepare(
            "INSERT INTO licenses (jti, project_id, type, agency_id, seat_index, quotas, exp) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        ).bind(jti, projectId, type, agencyId, type === 'seat' ? i + 1 : null, JSON.stringify(quotas), exp).run();

        const token = await signJwt({
            aud: projectId,
            jti,
            type,
            agency_id: agencyId,
            seat_index: type === 'seat' ? i + 1 : null,
            exp,
        }, privateJwk, env);
        issuedTokens.push(token);
    }

    return jsonResponse({ licenseTokens: issuedTokens }, 201, env);
});

// 3. POST /admin/licenses/revoke
router.post('/admin/licenses/revoke', adminAuth, async (request, env) => {
    const { jti } = await request.json();
    await env.DB.batch([
        env.DB.prepare("UPDATE licenses SET revoked = 1 WHERE jti = ?1").bind(jti),
        env.DB.prepare("UPDATE activations SET revoked = 1 WHERE jti = ?1").bind(jti)
    ]);
    return jsonResponse({ ok: true, jti }, 200, env);
});

// 4. GET /admin/analytics/summary?agencyId=...
router.get('/admin/analytics/summary', adminAuth, async (request, env) => {
    const { query } = request;
    if (!query.agencyId) {
        return jsonResponse({ error: 'agencyId is required' }, 400, env);
    }

    const { results: seats } = await env.DB.prepare(
        `SELECT
            l.jti, l.seat_index, l.exp, l.revoked,
            a.device_id, a.last_seen
         FROM licenses l
         LEFT JOIN activations a ON l.jti = a.jti
         WHERE l.agency_id = ?1`
    ).bind(query.agencyId).all();

    const todayKey = Math.floor(new Date().getTime() / 86400000);
    const { results: usage } = await env.DB.prepare(
        `SELECT l.jti, u.bucket, SUM(u.cost) as total_usage
         FROM usage u
         JOIN licenses l ON u.jti = l.jti
         WHERE l.agency_id = ?1 AND u.day_key = ?2
         GROUP BY l.jti, u.bucket`
    ).bind(query.agencyId, todayKey).all();

    const usageByJti = usage.reduce((acc, row) => {
        if (!acc[row.jti]) acc[row.jti] = {};
        acc[row.jti][row.bucket] = row.total_usage;
        return acc;
    }, {});

    const summary = seats.map(seat => {
        let status = 'issued';
        if (seat.revoked) status = 'revoked';
        else if (seat.device_id) status = 'active';
        else if (seat.exp * 1000 < Date.now()) status = 'expired';

        return {
            ...seat,
            status,
            todays_usage: usageByJti[seat.jti] || {},
        };
    });

    return jsonResponse({ summary }, 200, env);
});

// 5. POST /admin/coupons/create
router.post('/admin/coupons/create', adminAuth, async (request, env) => {
    const { code, projectId, durationDays, quotas, maxUses, expiresAt } = await request.json();

    if (!code || !projectId || !durationDays || !quotas || !maxUses) {
        return jsonResponse({ error: 'Missing required fields.' }, 400, env);
    }

    const plan_details_json = JSON.stringify({ durationDays, quotas });

    await env.DB.prepare(
        "INSERT INTO coupon_codes (code, project_id, plan_details_json, max_uses, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)"
    ).bind(code, projectId, plan_details_json, maxUses, expiresAt || null).run();

    return jsonResponse({ ok: true, code }, 201, env);
});


// Catch-all for 404s
router.all('*', () => new Response('Not Found.', { status: 404 }));

export default {
    fetch: (request, env, ctx) => router.handle(request, env, ctx),
};