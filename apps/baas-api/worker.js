// apps/baas-api/worker.js

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
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret, X-Razorpay-Signature',
        },
    });
}

const router = Router();

// Handle CORS preflight requests.
router.options('*', (request, env) => {
    return jsonResponse(null, 204, env);
});

// --- UTILITY FUNCTIONS ---
const encodeBase64Url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
async function signJwt(payload, privateJwk) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const encodedHeader = encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const data = `${encodedHeader}.${encodedPayload}`;
    const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data));
    return `${data}.${encodeBase64Url(signature)}`;
}

// --- DEVELOPER AUTH ENDPOINTS ---

// 1. Redirect to Google for login
router.get('/auth/developer/login/google', (request, env) => {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', `${env.PUBLIC_BASE_URL}/auth/developer/callback/google`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email');
    return Response.redirect(url.toString(), 302);
});

// 2. Google OAuth2 callback
router.get('/auth/developer/callback/google', async (request, env) => {
    const { query } = request;
    const code = query.code;

    // Exchange code for token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${env.PUBLIC_BASE_URL}/auth/developer/callback/google`,
            grant_type: 'authorization_code',
        }),
    });
    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
        return jsonResponse({ error: 'Failed to retrieve access token.' }, 400, env);
    }

    // Get user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userResponse.json();

    // Upsert developer into DB
    await env.DB.prepare(
        "INSERT INTO developers (id, email, name) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name"
    ).bind(userData.id, userData.email, userData.name).run();

    // Create a session JWT for the developer
    const privateJwk = JSON.parse(env.PRIVATE_JWK);
    const sessionToken = await signJwt({ 
        sub: userData.id, 
        email: userData.email,
        name: userData.name,
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    }, privateJwk);

    // TODO: Redirect to the developer dashboard with the token
    return jsonResponse({ message: "Login successful!", sessionToken }, 200, env);
});


// --- DEVELOPER API ENDPOINTS (Require Developer JWT) ---

const developerAuth = async (request, env) => {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return jsonResponse({ error: 'Unauthorized' }, 401, env);
    }
    const token = authHeader.substring(7);
    try {
        // TODO: Implement full JWT verification using PUBLIC_JWK_JSON
        const decoded = JSON.parse(atob(token.split('.')[1]));
        if (decoded.exp < Date.now() / 1000) {
            return jsonResponse({ error: 'Token expired' }, 401, env);
        }
        request.developer = decoded; // Attach developer info to the request
    } catch (e) {
        return jsonResponse({ error: 'Invalid token' }, 401, env);
    }
};

router.post('/api/v1/developer/projects', developerAuth, async (request, env) => {
    const { name } = await request.json();
    const developerId = request.developer.sub;
    const projectId = crypto.randomUUID(); // Generate a unique project ID

    await env.DB.prepare(
        "INSERT INTO projects (id, developer_id, name) VALUES (?1, ?2, ?3)"
    ).bind(projectId, developerId, name).run();

    return jsonResponse({ id: projectId, name }, 201, env);
});

router.get('/api/v1/developer/projects', developerAuth, async (request, env) => {
    const developerId = request.developer.sub;
    const { results } = await env.DB.prepare("SELECT * FROM projects WHERE developer_id = ?1").bind(developerId).all();
    return jsonResponse(results, 200, env);
});


// ... (All previous public and admin endpoints remain here) ...


// Catch-all for 404s
router.all('*', () => new Response('Not Found.', { status: 404 }));

export default {
    fetch: (request, env, ctx) => router.handle(request, env, ctx),
};