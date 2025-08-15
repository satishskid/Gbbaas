# Minimal, Production-Ready BAAS for License Management

This repository contains a complete Backend-as-a-Service (BAAS) for software license management, built to run on Cloudflare Workers. It features strong device binding via WebAuthn, usage analytics, and flexible request quotas.

## Core Goals

- **Simplicity**: The developer (you) owns the UI, local storage strategy (beyond the SDK's caching), and multi-user flow. The BAAS handles the core backend tasks: licensing, device binding, quotas, and analytics.
- **Non-transferable Licenses**: Strong device binding is enforced via WebAuthn on first activation, making licenses difficult to transfer.
- **Flexible Plans**: Supports duration-based licenses with configurable request quotas (daily, monthly, RPM).
- **Agency Model**: Allows for issuing licenses to an agency with a specific number of seats, with analytics rolling up to the agency level.
- **Privacy-Focused**: No application content is ever collected. The service only tracks usage counts and hashed user identifiers.

## Repository Structure

```
.
├── apps/
│   ├── baas-api/worker.js   # Cloudflare Worker Edge API (D1 SQLite)
│   └── dashboard/index.html # Minimal admin UI
├── db/
│   └── schema.sql           # D1 database schema
├── sdk/
│   └── baas-sdk.js          # Headless-first, paste-in SDK
├── wrangler.toml              # Cloudflare config (D1 + vars + secrets)
└── README.md                  # This file
```

## Setup Instructions

1.  **Clone the Repository**: Get the code on your local machine.

2.  **Install Wrangler CLI**: If you don't have it, install the Cloudflare command-line tool:
    ```sh
    npm install -g wrangler
    ```

3.  **Create a D1 Database**:
    ```sh
    wrangler d1 create baas-db
    ```
    This command will output the database ID. Open `wrangler.toml` and replace `your-d1-database-id` with this ID.

4.  **Apply the Database Schema**:
    ```sh
    wrangler d1 execute baas-db --file=./db/schema.sql
    ```

5.  **Set Secrets**:
    You need to configure three secrets for the worker. Generate these values and set them using the `wrangler secret put` command.

    -   `ADMIN_SECRET`: A secret for accessing the admin API.
        ```sh
        # Generate a secret
        openssl rand -base64 32
        # Set the secret (replace <value> with the generated string)
        wrangler secret put ADMIN_SECRET
        ```

    -   `PRIVATE_JWK` & `PUBLIC_JWK_JSON`: An RS256 key pair for signing and verifying JWTs. You can use a library like `jose` in Node.js to generate these.
        *   The `PRIVATE_JWK` is the full private key, stringified.
        *   The `PUBLIC_JWK_JSON` is the public part of the key, stringified.

        ```sh
        # Example of setting the secrets
        wrangler secret put PRIVATE_JWK -- '{"kty":"RSA","n":"...","e":"AQAB","d":"..."}'
        wrangler secret put PUBLIC_JWK_JSON -- '{"kty":"RSA","n":"...","e":"AQAB"}'
        ```

6.  **Update `wrangler.toml`**: 
    - Set `PUBLIC_BASE_URL` to the URL where your worker will be deployed.
    - Set `ALLOWED_ORIGINS` to a comma-separated list of domains where your application will run.

7.  **Update the SDK**: 
    - Open `sdk/baas-sdk.js`.
    - Replace the placeholder `PUBLIC_JWK` with the actual public key you generated.
    - Replace the placeholder `apiBase` with your worker's public URL.

8.  **Publish the Worker**:
    ```sh
    wrangler deploy
    ```

9.  **Use the Dashboard**:
    Open `apps/dashboard/index.html` in your browser. Enter your worker URL and admin secret to start managing your licenses.

## How to Use the SDK

The SDK is designed to be headless-first. You can integrate it into your application with just a few lines of code.

```html
<script src="path/to/baas-sdk.js"></script>
<script>
    // 1. Ensure the license is active
    BAAS.license.ensure({
        // This function is called when the SDK needs a license token.
        // You should fetch this from your backend, which authenticates the user.
        onRequestLicense: async () => {
            // Example: return "ey...your.license.token";
            const res = await fetch('/api/get-license-token');
            const { token } = await res.json();
            return token;
        },
        // Optional: Get status updates
        onStatus: (status) => console.log('BAAS Status:', status)
    });

    // 2. (Optional) Provide a user identifier for analytics
    // The SDK will hash this value, so the raw ID is never sent.
    BAAS.context.setUserProvider(() => {
        // Return the current user's unique ID, or null/undefined if logged out
        return getCurrentUserId(); 
    });

    // 3. Meter usage with wrappers or direct calls

    // Wrap a function to meter its execution
    const myExpensiveFunction = BAAS.quota.wrap('myFunc', () => {
        console.log('Doing expensive work!');
    }, { bucket: 'ai', cost: 5 });

    // Use the metered fetch wrapper
    BAAS.quota.fetch('https://api.example.com/data', {}, { bucket: 'api-calls' });

</script>
```

## How It Works

### Analytics

-   **Heartbeat**: The SDK sends a heartbeat every 60 seconds with the `activationCert` and an optional hashed `userId`. This updates the `last_seen` timestamp for the device and logs the user hash for unique user counts.
-   **Usage Metering**: Every call to `BAAS.quota.meter` or a wrapped function sends a record to the backend, incrementing usage in a named bucket.
-   **Privacy**: All analytics are based on counts, device IDs, and hashed user IDs. No PII or application content is collected.

### Quotas

Quotas are defined in a JSON object when you issue a license. They can be global or per-bucket.

```json
{
  "daily": 5000, // Global daily limit
  "byCategory": {
    "ai": { "daily": 100 }, // Limit for the 'ai' bucket
    "general": { "daily": 4900 } // Limit for the 'general' bucket
  }
}
```

If a metered request exceeds a quota, the API returns a `429 Too Many Requests` error, and the SDK throws an error containing the limit information.

### Security

-   **WebAuthn**: Device binding is handled by the browser's WebAuthn API, creating a strong, non-transferable link between a license and a device.
-   **JWTs**: License tokens and activation certificates are signed with RS256. The public key is embedded in the SDK for client-side verification of license tokens.
-   **No Content Collection**: The BAAS is fundamentally unaware of your application's content.
