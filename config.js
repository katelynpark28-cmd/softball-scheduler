// ============================================================
// Brown Softball — config
// ============================================================
//
// GOOGLE OAUTH SETUP
// ------------------
// To enable "Continue with Google", you need a Google Cloud OAuth
// Client ID. Setup takes about 5 minutes:
//
// 1. Go to: https://console.cloud.google.com/
// 2. Create a project (top bar dropdown → "New Project")
//    Name it "Brown Softball" or anything you like.
// 3. With the project selected, search "OAuth consent screen"
//    at the top, open it.
//    - User Type: External
//    - App name: Brown Softball
//    - User support email: your email
//    - Developer contact: your email
//    - Skip scopes (or add email/profile/openid)
//    - Add test users: your email + any teammates' emails
//      (until you publish, only test users can sign in)
//    - Save and continue through all steps.
// 4. Search "Credentials" at the top.
//    - Click "+ CREATE CREDENTIALS" → "OAuth client ID"
//    - Application type: Web application
//    - Name: "Brown Softball web"
//    - Authorized JavaScript origins:
//        http://localhost:5173
//        (and later, your real domain if you deploy)
//    - Click Create
//    - Copy the Client ID (ends with .apps.googleusercontent.com)
// 5. Paste it below, replacing the placeholder.
//
// That's it. Reload signin.html — the Google button will work.
// ============================================================

window.GOOGLE_CLIENT_ID = '720692345301-8n6nbu101caqnqqqjjokbsrpltpei0t2.apps.googleusercontent.com';
