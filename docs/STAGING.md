# Staging setup for `develop`

Step-by-step setup of the staging environment: a separate MongoDB database, a second Heroku app that deploys `develop`, the Vercel preview pointed at it, and the built-in test accounts. Do this once. The overview and branch rules are in [BRANCHING.md](./BRANCHING.md).

```
dev.pairpocket.me (Vercel, branch develop) ──▶ pairpocket-api-staging (Heroku, branch develop) ──▶ Atlas database pairpocket_staging
www.pairpocket.me (Vercel, branch main)    ──▶ production Heroku app (branch main)             ──▶ Atlas database pairpocket
```

Staging never shares a database, secret key or encryption key with production.

## 1. MongoDB Atlas: database and user

The staging database can live in the same cluster as production. Separation comes from the database name and a user that can only reach that database.

1. Atlas → your project → **Database Access** → **Add New Database User**.
   - Authentication: Password. Username `pairpocket-staging`, autogenerate a password and keep it for step 3.
   - **Database User Privileges** → **Add Specific Privilege** → role `readWrite`, database `pairpocket_staging`. Do not grant `readWriteAnyDatabase`.
2. **Network Access**: Heroku dynos have changing IPs, so the list needs `0.0.0.0/0`. If production already works from Heroku, this is already in place.
3. **Database** → **Connect** → **Drivers** and copy the connection string with the new user, for example:

   ```
   mongodb+srv://pairpocket-staging:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   ```

   URL-encode the password if it contains `@ : / ? #`.

You do not create the `pairpocket_staging` database by hand: it appears on the first write, and the API creates its indexes at startup.

Transactions (partner linking, paired transfers) need a replica set, which every Atlas cluster, including the free M0 tier, provides.

## 2. Generate the secrets

Make new values; never copy production's. PowerShell:

```powershell
# SECRET_KEY and TEST_LOGIN_PASSWORD: 48 random bytes each, URL-safe
$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b).Replace('+','-').Replace('/','_').TrimEnd('=')

# SETTINGS_ENCRYPTION_KEY: a Fernet key (32 bytes, URL-safe base64 with padding)
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b).Replace('+','-').Replace('/','_')
```

macOS or Linux: `openssl rand -base64 48 | tr '+/' '-_' | tr -d '='` for the first two, and `openssl rand -base64 32 | tr '+/' '-_'` for the Fernet key.

Run the first command twice: once for `SECRET_KEY`, once for `TEST_LOGIN_PASSWORD`. Store `TEST_LOGIN_PASSWORD` in your password manager and share it only with testers.

## 3. Heroku: staging API app

1. Heroku dashboard → **New** → **Create new app**. Name: `pairpocket-api-staging` (or any free name), same region as production.
2. **Deploy** tab → Deployment method **GitHub** → connect `minsikpaul92/pair-pocket`.
   - **Automatic deploys**: choose branch `develop`, tick "Wait for CI to pass before deploy", then **Enable Automatic Deploys**.
   - Press **Deploy Branch** (`develop`) once for the first build.
   - The app builds from the repository root: `runtime.txt`, `requirements.txt` and `Procfile` there run the API from `backend/`. No buildpack setting is needed beyond Python, which Heroku detects.
3. **Resources** tab: one `web` dyno. The smallest paid type (Eco or Basic) is enough.
4. **Settings** tab → **Reveal Config Vars** and add:

   | Key | Value |
   | --- | --- |
   | `MONGODB_URI` | connection string from step 1 |
   | `MONGODB_DB_NAME` | `pairpocket_staging` |
   | `SECRET_KEY` | new value from step 2 |
   | `SETTINGS_ENCRYPTION_KEY` | new Fernet key from step 2 |
   | `TEST_LOGIN_PASSWORD` | new value from step 2 |
   | `FRONTEND_URL` | `https://dev.pairpocket.me` (or the Vercel develop preview URL until the domain exists) |
   | `CORS_ORIGINS` | the same URL as `FRONTEND_URL`; comma-separate if you also use the preview URL |

   Leave these unset on staging:

   | Key | Why |
   | --- | --- |
   | `CRON_SECRET` | Without it the reminder email job cannot run from staging. |
   | `ALLOW_DEV_LOGIN` | The test accounts replace it. |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI` | Optional, see step 5. Without them the Google button shows "not configured" and testers use the test accounts. |
   | `RESEND_API_KEY` | Optional. Without it invitations show a link instead of sending mail, which is what testers need anyway. |

   Saving config vars restarts the app.

Heroku CLI equivalent (after `heroku login`):

```bash
heroku config:set -a pairpocket-api-staging MONGODB_DB_NAME=pairpocket_staging MONGODB_URI="mongodb+srv://..." SECRET_KEY="..." SETTINGS_ENCRYPTION_KEY="..." TEST_LOGIN_PASSWORD="..." FRONTEND_URL="https://dev.pairpocket.me" CORS_ORIGINS="https://dev.pairpocket.me"
```

### Why `TEST_LOGIN_PASSWORD` is safe here and nowhere else

The API turns test login on only when `TEST_LOGIN_PASSWORD` is set **and** `MONGODB_DB_NAME` ends in `_staging`, `_test` or `_dev` (`backend/app/services/staging_login.py`). Production uses `pairpocket`, so even a stray `TEST_LOGIN_PASSWORD` on the production app does nothing. Still, keep it off production: the launch checklist in `ONBOARDING.md` checks this.

## 4. Vercel: point the develop preview at the staging API

1. Vercel → project `pair-pocket` → **Settings** → **Environment Variables** → add:
   - Key `NEXT_PUBLIC_API_BASE_URL`, value `https://<staging-app>.herokuapp.com` (from Heroku **Settings** → Domains).
   - Environment: **Preview** only, and set **Branch** to `develop`. Production keeps its own value.
2. **Settings** → **Domains** → add `dev.pairpocket.me` and assign it to the Git branch `develop`. Add the DNS record Vercel shows at your DNS provider.
3. Redeploy `develop` (Deployments → latest develop deployment → Redeploy). `NEXT_PUBLIC_*` values are baked in at build time, and the `/api/auth/*` proxy in `frontend/next.config.js` also reads this variable, so an old build keeps talking to the old API.

## 5. Optional: Google sign-in on staging

Only needed to test the real Google flow.

1. Google Cloud Console → **APIs & Services** → **Credentials** → the OAuth client → **Authorized redirect URIs** → add `https://<staging-app>.herokuapp.com/api/auth/callback`.
2. On Heroku add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (same client as production, or a separate staging client) and `OAUTH_REDIRECT_URI` set to that URI.
3. While the OAuth app is in Testing mode, only accounts listed under **Audience** → **Test users** can sign in.

## 6. Check that it works

1. `https://<staging-app>.herokuapp.com/health` returns `"status": "ok"` and `"db": "ok"`.
2. `https://<staging-app>.herokuapp.com/api/auth/test-login` returns the four test accounts. A 404 means `TEST_LOGIN_PASSWORD` is missing or `MONGODB_DB_NAME` does not end in `_staging`.
3. Open `https://dev.pairpocket.me`: the sign-in page shows the yellow **Test sign-in** box.
4. Enter the password and press **Reset to linked couples with accounts**, then sign in as Tester 1. The app opens in Korean with the shared ledger and three accounts ready. Tester 3 opens in English.
5. In Atlas, the data appears in `pairpocket_staging`, not `pairpocket`.
6. Production check: `https://<production-api>/api/auth/test-login` returns 404 and `www.pairpocket.me` shows no test box.

What each reset button does, and how to use the test accounts, is in [BRANCHING.md, Test accounts on staging](./BRANCHING.md#test-accounts-on-staging).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Test box missing on `dev.pairpocket.me` | Check step 6.2. If the API answers but the box is still missing, the frontend build points elsewhere: check `NEXT_PUBLIC_API_BASE_URL` for Preview/develop and redeploy. |
| "Wrong test account or password" | The value typed differs from the Heroku config var (watch for trailing spaces). |
| Sign-in loops back to the sign-in page | `FRONTEND_URL` or `CORS_ORIGINS` does not match the address in the browser exactly (scheme, no trailing slash). |
| `/health` shows a database error | Wrong `MONGODB_URI` password, user lacks `readWrite` on `pairpocket_staging`, or Atlas Network Access blocks Heroku. |
| Partner link or transfer fails with "can't be saved right now" | The cluster is not a replica set; use Atlas. |
