
// sdk/baas-sdk.js

/**
 * BAAS SDK
 * A headless-first SDK for interacting with the BAAS API.
 * It handles license activation, heartbeats, and usage metering.
 */

const BAAS = (() => {
    // --- SDK Configuration ---
    // TODO: This public key should be replaced during the build process or configured dynamically.
    const PUBLIC_JWK = {"kty":"RSA","n":"ril6_Su4sI7PUnXDQaUE1a8Yobc3SZYjGkGxhps0HnC89UHJNRIpBA17w2aY0p9IgAeTyF9JHjcfPEvzqTw7xWDSh86rjbiMnRG70tTc2c3l2E0v-wYoqVBcMMXBrXsptuCTqKd82l1_Qnyri_hXL4E5AA0_eRS8mhIY1A5Xd8T1YcIeeIHA2E0JnZ58ujLE2yx01LFF72oB2xvRZst9WMqQNBDhhUGVUUyIvtl6-pvVewupxrkwY4KniuluqLOyvCmTaPALUltvFKM4oW_zuAJ7nq0jcGUmBWsreB6Tc9wJ4EhLTbb7sVkECMNbCxQnGvMs0UiuZA26Mm56yIG0YQ","e":"AQAB"};

    let config = {
        apiBase: 'https://baas-api.satish-9f4.workers.dev', // <-- REPLACE THIS
        projectId: null,
        ui: 'headless', // or 'prompt'
        onRequestLicense: async () => { throw new Error('onRequestLicense not configured'); },
        onStatus: () => {},
        userProvider: () => null,
    };

    const storage = {
        get: (key) => JSON.parse(localStorage.getItem(`baas:${config.projectId}:${key}`)),
        set: (key, value) => localStorage.setItem(`baas:${config.projectId}:${key}`, JSON.stringify(value)),
    };

    // --- Internal State ---
    let state = {
        license: null,
        activation: null,
        heartbeatTimer: null,
    };

    // --- Internal Helpers ---
    const base64UrlToUint8Array = (str) => new Uint8Array(atob(str.replace(/-/g, '+').replace(/_/g, '/')).split('').map(c => c.charCodeAt(0)));

    async function verifyJwt(token) {
        // Simplified JWT verification. A more robust solution would use a library.
        try {
            const [headerB64, payloadB64, signatureB64] = token.split('.');
            const payload = JSON.parse(atob(payloadB64));

            // Check expiration
            if (payload.exp * 1000 < Date.now()) {
                console.error("BAAS Error: Token has expired.");
                return null;
            }
            // Check audience
            if (payload.aud !== config.projectId) {
                console.error("BAAS Error: Token audience does not match projectId.");
                return null;
            }

            // TODO: Add full signature verification using PUBLIC_JWK
            return payload;
        } catch (e) {
            console.error("BAAS Error: Invalid JWT", e);
            return null;
        }
    }

    async function activate(licenseToken) {
        try {
            const startRes = await fetch(`${config.apiBase}/v1/activate/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: config.projectId, licenseToken, deviceInfo: { userAgent: navigator.userAgent } }),
            });
            if (!startRes.ok) throw new Error('Activation start failed');
            const { activationId, options } = await startRes.json();

            // Convert challenge and user.id from base64url to ArrayBuffer
            options.challenge = base64UrlToUint8Array(options.challenge);
            options.user.id = base64UrlToUint8Array(options.user.id);

            const credential = await navigator.credentials.create({ publicKey: options });

            const finishRes = await fetch(`${config.apiBase}/v1/activate/finish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activationId, credential: { id: credential.id, rawId: credential.rawId, type: credential.type, response: { clientDataJSON: new TextDecoder().decode(credential.response.clientDataJSON), attestationObject: new TextDecoder().decode(credential.response.attestationObject) } } }),
            });
            if (!finishRes.ok) throw new Error('Activation finish failed');
            const { activationCert } = await finishRes.json();

            const decodedCert = await verifyJwt(activationCert);
            state.activation = { deviceId: decodedCert.deviceId, activationCert, level: 'webauthn' };
            storage.set('activation', state.activation);
            return true;
        } catch (error) {
            console.error('BAAS Activation Error:', error);
            return false;
        }
    }

    async function startHeartbeat() {
        if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);

        const beat = async () => {
            if (!state.activation) return;
            let userIdHash = null;
            const userId = config.userProvider();
            if (userId) {
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${config.projectId}:${userId}`));
                userIdHash = btoa(String.fromCharCode(...new Uint8Array(digest)));
            }

            fetch(`${config.apiBase}/v1/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activationCert: state.activation.activationCert, userIdHash }),
            });
            updateStatus();
        };

        beat(); // Immediate heartbeat
        state.heartbeatTimer = setInterval(beat, 60000); // And every 60 seconds
    }

    function updateStatus() {
        const status = {
            valid: !!(state.license && state.activation),
            projectId: config.projectId,
            license: state.license ? { jti: state.license.jti, type: state.license.type, agency_id: state.license.agency_id, exp: state.license.exp } : null,
            activation: state.activation ? { deviceId: state.activation.deviceId, level: state.activation.level } : null,
        };
        config.onStatus(status);
    }

    // --- Public API ---
    const publicApi = {
        license: {
            async ensure(opts) {
                Object.assign(config, opts);
                config.projectId = (await verifyJwt(await config.onRequestLicense()))?.aud;
                if (!config.projectId) {
                    console.error("Could not determine projectId from license token.");
                    return;
                }

                state.activation = storage.get('activation');
                const storedLicense = storage.get('license');

                if (storedLicense) {
                    state.license = await verifyJwt(storedLicense.token);
                }

                if (!state.license) {
                    const token = await config.onRequestLicense();
                    state.license = await verifyJwt(token);
                    if (state.license) {
                        storage.set('license', { token });
                    } else {
                        updateStatus();
                        return;
                    }
                }

                if (!state.activation) {
                    const success = await activate(storage.get('license').token);
                    if (!success) {
                        updateStatus();
                        return;
                    }
                }

                startHeartbeat();
                updateStatus();
            },
        },
        context: {
            setUserProvider: (provider) => {
                config.userProvider = provider;
            },
        },
        quota: {
            async meter(bucket, cost = 1) {
                if (!state.activation) throw new Error('SDK not activated');
                const res = await fetch(`${config.apiBase}/v1/usage/meter`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ activationCert: state.activation.activationCert, bucket, cost }),
                });
                if (!res.ok) {
                    const errorData = await res.json();
                    throw { limit: errorData };
                }
                return await res.json();
            },
            wrap(name, fn, { bucket = 'general', cost = 1 } = {}) {
                return async (...args) => {
                    await publicApi.quota.meter(bucket, cost);
                    return fn(...args);
                };
            },
            fetch(input, init, { bucket = 'general', cost = 1 } = {}) {
                return publicApi.quota.wrap('fetch', window.fetch, { bucket, cost })(input, init);
            },
        },
        onStatus: (callback) => {
            config.onStatus = callback;
        },
    };

    return publicApi;
})();
