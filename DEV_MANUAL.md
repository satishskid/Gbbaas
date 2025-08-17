# Gb-Baas: Developer Manual

---

## 1. Introduction

Welcome, developer. This guide will walk you through integrating your application with the Gb-Baas platform.

Our philosophy is simple: we handle the complex, tedious backend logic for software licensing and monetization, so you can focus on building your core product. The BAAS is "headless," meaning you control the full user experience in your application.

This manual covers the three ways your application can receive and activate a license from the BAAS.

---

## 2. The "One-Click Trial" Flow (Recommended)

This is the most seamless way for users to start a trial. Your app will have a "Sign in with Google" button, and everything else happens automatically.

**Your Task:**

1.  **Implement Social Sign-In:** In your application, use a standard library (e.g., Google Identity Services) to implement a "Sign in with Google" button.

2.  **Request a Trial License:** After a user successfully signs in, your application's backend will receive their verified email. Your backend should then make a `POST` request to the BAAS `/v1/trials/request` endpoint.

    ```javascript
    // This code runs in YOUR application's backend
    async function requestTrial(userEmail, projectId) {
        const response = await fetch('https://<your-baas-api-url>/v1/trials/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userEmail: userEmail,
                projectId: projectId
            })
        });

        if (!response.ok) {
            // Handle errors, e.g., user already has a trial
            const error = await response.json();
            throw new Error(error.error);
        }

        const { licenseToken } = await response.json();
        return licenseToken;
    }
    ```

3.  **Activate the License:** Your backend passes the `licenseToken` it received back to your frontend. Your frontend then passes this token to the `baas-sdk.js` to activate the license.

---

## 3. Coupon Redemption Flow

If the admin has created coupon codes (e.g., `WEBINAR_SPECIAL`), your application needs a way for users to redeem them.

**Your Task:**

1.  **Create a Redeem UI:** Add a simple text input and a button in your app where a user can enter their coupon code.

2.  **Call the Redeem Endpoint:** When the user submits the code, your frontend or backend should make a `POST` request to the `/v1/coupons/redeem` endpoint.

    ```javascript
    async function redeemCoupon(couponCode, projectId) {
        const response = await fetch('https://<your-baas-api-url>/v1/coupons/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                couponCode: couponCode,
                projectId: projectId
            })
        });
        // ... handle response and get licenseToken ...
    }
    ```

3.  **Activate the License:** Just like the trial flow, pass the returned `licenseToken` to the SDK.

---

## 4. Integrating the SDK & Handling Status

This is the core of the frontend integration.

1.  **Include the SDK:** Add the `baas-sdk.js` script to your HTML.

2.  **Initialize on Load:** When your app loads, you need to initialize the SDK and tell it how to get the license token (which your backend will provide after one of the flows above).

    ```javascript
    // This function is responsible for getting the token
    async function getLicenseToken() {
        // This is where you implement your logic.
        // e.g., call your backend to check if the user is logged in
        // and has a license token stored against their session.
        const response = await fetch('/api/get-my-license');
        const { token } = await response.json();
        return token;
    }

    // Initialize the SDK
    BAAS.license.ensure({
        onRequestLicense: getLicenseToken,
        onStatus: handleLicenseStatus // IMPORTANT! See below
    });
    ```

3.  **Handle License Status (Crucial for UX):** The `onStatus` callback is how your app knows whether to show premium features or an upgrade message. It runs every time the license state changes.

    ```javascript
    function handleLicenseStatus(status) {
        const upgradeBanner = document.getElementById('upgrade-banner');

        if (!status.valid) {
            // License is not active or has expired
            upgradeBanner.textContent = 'Your trial has expired. Please upgrade to continue.';
            upgradeBanner.style.display = 'block';
            // --> Here you would also call the /v1/plans endpoint
            // --> to fetch the paid plans and display them to the user.
            return;
        }

        // License is valid!
        upgradeBanner.style.display = 'none';

        const expirationDate = new Date(status.license.exp * 1000);
        const daysLeft = Math.ceil((expirationDate - new Date()) / (1000 * 60 * 60 * 24));

        if (daysLeft <= 7) {
            // Show a gentle reminder if expiring soon
            console.log(`Your license expires in ${daysLeft} days.`);
        }
    }
    ```

---

## 5. Protecting Features with Quotas

To limit access to certain features based on the user's plan, use the quota metering functions.

```javascript
// Wrap a function to protect it
const runAiFeature = BAAS.quota.wrap('runAiFeature', async () => {
    // ... logic for your expensive AI feature ...
}, {
    bucket: 'ai', // This must match a bucket in the license's quota
    cost: 1
});

try {
    await runAiFeature();
} catch (e) {
    // This error is thrown if the user is over their quota
    alert("You have reached your daily limit for this feature.");
}
```

