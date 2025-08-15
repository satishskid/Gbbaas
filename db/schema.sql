-- BAAS Schema for Cloudflare D1
DROP TABLE IF EXISTS users_seen;
DROP TABLE IF EXISTS usage;
DROP TABLE IF EXISTS activations;
DROP TABLE IF EXISTS activation_sessions;
DROP TABLE IF EXISTS licenses;
DROP TABLE IF EXISTS agencies;

CREATE TABLE agencies (
    agency_id TEXT PRIMARY KEY,
    name TEXT,
    seat_quota INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE licenses (
    jti TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('seat', 'individual')),
    agency_id TEXT,
    seat_index INTEGER,
    quotas TEXT,
    issued_at INTEGER DEFAULT (strftime('%s', 'now')),
    exp INTEGER NOT NULL,
    revoked INTEGER DEFAULT 0,
    FOREIGN KEY (agency_id) REFERENCES agencies(agency_id)
);
CREATE TABLE activation_sessions (
    activation_id TEXT PRIMARY KEY,
    jti TEXT NOT NULL,
    challenge TEXT NOT NULL,
    device_info TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (jti) REFERENCES licenses(jti)
);
CREATE TABLE activations (
    activation_id TEXT PRIMARY KEY,
    jti TEXT NOT NULL,
    device_id TEXT NOT NULL,
    credential_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    last_seen INTEGER,
    revoked INTEGER DEFAULT 0,
    UNIQUE(jti, device_id),
    FOREIGN KEY (jti) REFERENCES licenses(jti)
);
CREATE TABLE usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jti TEXT NOT NULL,
    device_id TEXT NOT NULL,
    bucket TEXT NOT NULL,
    cost INTEGER DEFAULT 1,
    day_key INTEGER NOT NULL,
    minute_key INTEGER NOT NULL,
    month_key TEXT NOT NULL,
    ts INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (jti) REFERENCES licenses(jti)
);
CREATE TABLE users_seen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jti TEXT NOT NULL,
    device_id TEXT NOT NULL,
    user_hash TEXT NOT NULL,
    ts INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(jti, device_id, user_hash)
);

-- Coupon codes for bulk license generation
CREATE TABLE coupon_codes (
    code TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    plan_details_json TEXT NOT NULL, -- Stores duration, quotas, etc.
    max_uses INTEGER NOT NULL,
    current_uses INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER
);