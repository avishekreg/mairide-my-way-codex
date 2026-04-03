# MaiRide My Way

This version of the app has been reworked for a Supabase-backed environment while preserving the existing frontend flow as closely as possible.

## What changed

- Firebase client dependencies were replaced with a Supabase-backed compatibility layer.
- Firebase Admin routes were replaced with Supabase admin APIs.
- Plaintext password storage was removed from admin/user flows.
- A starter Supabase SQL schema lives in [supabase/schema.sql](/Users/avishek/Documents/Playground/mairide-my-way/supabase/schema.sql).
- Local development still runs on `http://localhost:3002`.

## Required Supabase setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run [supabase/schema.sql](/Users/avishek/Documents/Playground/mairide-my-way/supabase/schema.sql).
3. Create a public storage bucket named `mairide-assets`, or set a different bucket name in `VITE_SUPABASE_STORAGE_BUCKET`.
4. In Supabase Auth:
   - Enable `Email` auth
   - Enable `Google` if you want Google sign-in
   - Enable `Anonymous sign-ins` if you want the OTP-assisted signup/login flow to keep working as designed
5. Add your local and deployed callback URLs in Supabase Auth URL settings.

## Environment

Create `.env.local` from `.env.example` and fill in:

```env
PORT=3002
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
VITE_SUPABASE_STORAGE_BUCKET=mairide-assets
VITE_SUPER_ADMIN_EMAIL=admin@example.com
VITE_APP_VERSION=v2.0.1-beta
VITE_GOOGLE_MAPS_API_KEY=...
TWO_FACTOR_API_KEY=
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Do not expose it in the browser.
- `TWO_FACTOR_API_KEY` is optional for local testing. If omitted, the app uses mock OTP value `123456`.
- Use a browser-safe Google Maps key and allow your actual domains as referrers.

## Run locally

```bash
npm install
npm run dev
```

Then open:

[http://localhost:3002](http://localhost:3002)

## Verification

The current codebase passes:

```bash
npm run lint
npm run build
```

## Important production notes

- Rotate any API keys that were ever pasted into chat or shared outside your secure vault.
- Admin-created users are marked `forcePasswordChange`, but passwords are no longer stored in the database.
- This project is now Supabase-ready locally. Before a Vercel launch, you will still need to configure the same environment variables in Vercel and verify the API runtime/deployment shape you want to use.
