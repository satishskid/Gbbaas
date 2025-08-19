-- BAAS Schema for Cloudflare D1 - Multi-Tenant

-- Drop tables in reverse order of creation due to foreign key constraints
DROP TABLE IF EXISTS trial_redemptions;
DROP TABLE IF EXISTS payment_gateways;
DROP TABLE IF EXISTS trial_plans;
DROP TABLE IF EXISTS coupon_codes;
DROP TABLE IF EXISTS users_seen;
DROP TABLE IF EXISTS usage;
DROP TABLE IF EXISTS activations;
DROP TABLE IF EXISTS activation_sessions;
DROP TABLE IF EXISTS licenses;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS developers;
DROP TABLE IF EXISTS agencies; -- Legacy, may be deprecated

-- Core Multi-Tenant Tables
CREATE TABLE developers (
    id TEXT PRIMARY KEY, -- User ID from an auth provider like Google or GitHub
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY, -- The unique project_id, e.g., 'inkwell-app'
    developer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (developer_id) REFERENCES developers(id) ON DELETE CASCADE
);

-- Legacy table, may be deprecated in favor of the developer/project model
CREATE TABLE agencies (
    agency_id TEXT PRIMARY KEY,
    name TEXT,
    seat_quota INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Project-Scoped Resources
CREATE TABLE licenses (
    jti TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('seat', 'individual')),
    agency_id TEXT, -- Legacy
    seat_index INTEGER, -- Legacy
    quotas TEXT,
    issued_at INTEGER DEFAULT (strftime('%s', 'now')),
    exp INTEGER NOT NULL,
    revoked INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE coupon_codes (
    code TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    plan_details_json TEXT NOT NULL,
    max_uses INTEGER NOT NULL,
    current_uses INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE trial_plans (
    project_id TEXT PRIMARY KEY,
    duration_days INTEGER NOT NULL,
    quotas_json TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE trial_redemptions (
    user_email TEXT NOT NULL,
    project_id TEXT NOT NULL,
    license_jti TEXT NOT NULL,
    redeemed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (user_email, project_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE payment_gateways (
    project_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL, -- e.g., 'razorpay'
    api_key TEXT NOT NULL,
    api_secret TEXT NOT NULL,
    webhook_secret TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Usage & Activation Tables (Linked to Licenses)
CREATE TABLE activation_sessions (
    activation_id TEXT PRIMARY KEY,
    jti TEXT NOT NULL,
    challenge TEXT NOT NULL,
    device_info TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (jti) REFERENCES licenses(jti) ON DELETE CASCADE
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
    FOREIGN KEY (jti) REFERENCES licenses(jti) ON DELETE CASCADE
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
    FOREIGN KEY (jti) REFERENCES licenses(jti) ON DELETE CASCADE
);

CREATE TABLE users_seen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jti TEXT NOT NULL,
    device_id TEXT NOT NULL,
    user_hash TEXT NOT NULL,
    ts INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(jti, device_id, user_hash),
    FOREIGN KEY (jti) REFERENCES licenses(jti) ON DELETE CASCADE
);