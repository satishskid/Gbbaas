# Gb-Baas: User Manual

---

## Introduction

Welcome to Gb-Baas! This is your guide to managing your software applications, licenses, and users. This dashboard is your central command center.

## 1. Initial Configuration

Before you can use the dashboard, you must configure it to connect to your BAAS API.

*   **API Base URL:** This is the public URL of your deployed Cloudflare Worker (e.g., `https://baas-api.your-name.workers.dev`).
*   **Admin Secret:** This is the secret password you created to protect your admin-level API endpoints.

**You must enter these two values every time you open the dashboard.** This is a security feature to ensure your secrets are never stored in the browser.

---

## 2. Managing Users & Licenses

There are three primary ways to get licenses to your end-users.

### Method A: The "One-Click" Self-Service Trial (Recommended for Growth)

This is the most powerful, automated way to let users start a free trial.

**Your Task:**
1.  Navigate to the **"Define Self-Service Trial Plan"** section.
2.  Enter the **Project ID** for your application (e.g., `geminix`).
3.  Define the trial: how many **days** it should last and what the **usage quotas** are.
4.  Click **"Set Trial Plan"**.

**What Happens Next:**
Your work is done. Your application can now automatically issue these trial licenses to new users who sign up. You do not need to be involved in the process.

### Method B: Coupon Campaigns (For Marketing)

This is perfect for marketing campaigns or giving a specific group of users a trial.

**Your Task:**
1.  Navigate to the **"Create Coupon Code"** section.
2.  Invent a **Coupon Code** (e.g., `WEBINAR_SPECIAL`).
3.  Define the plan that this coupon will grant (duration, quotas, etc.).
4.  Set a **Max Uses** limit for how many people can redeem the coupon.
5.  Click **"Create Coupon"**.

**What Happens Next:**
Share the coupon code (`WEBINAR_SPECIAL`) with your target audience. They can enter this code into your application to receive their license.

### Method C: The Manual Invite (For Specific Users)

Use this when you want to give a specific, non-trial license to an individual (e.g., a paid customer or a partner).

**Your Task:**
1.  Navigate to the **"Issue Individual License"** section.
2.  Enter the user's **email** and the **Project ID**.
3.  Select a pre-defined plan or create a custom one by setting the duration and quotas.
4.  Click **"Issue License"**.

**What Happens Next:**
An email body will be generated. Copy this and send it directly to the user. It contains their unique license key.

---

## 3. User Management

*   **Finding a User:** Use the **"User Analytics & Management"** section to look up a user by their email or license JTI (the unique ID for a license). *Note: The backend for this feature is still in development.*
*   **Revoking a License:** If you need to disable a user's access, get their license JTI and use the **"Revoke License"** form inside the "Agency & Advanced Tools" section.

