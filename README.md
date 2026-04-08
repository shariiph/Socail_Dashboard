# Social message aggregator

Android app (Wallet Hub) syncs notifications, SMS, and call log to **Supabase**; the **web dashboard** (`web-dashboard`) is a Next.js app for inbox, orders, SMS, and calls.

## Web dashboard on Netlify

1. Push this repository to GitHub (or GitLab / Bitbucket).
2. In [Netlify](https://app.netlify.com) → **Add new site** → **Import an existing project** → pick the repo.
3. Netlify reads `netlify.toml` at the repo root (`base = web-dashboard`). No need to change the build command unless you customize it.
4. Under **Site settings → Environment variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL  
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — **anon** public key (same as local `.env.local`; never commit `.env.local`)
5. Deploy. After the first build, open the site URL.

**Supabase:** enable Realtime for your tables if you want live updates (see `supabase/enable_realtime.sql`).

## Local dashboard

```bash
cd web-dashboard
cp .env.example .env.local
# Edit .env.local with your Supabase URL and anon key
PATH="$(pwd)/node-bin/bin:$PATH" npm install   # if npm is not global
npm run dev
```

## Android app

See `android-app/build-apk.sh` and `android-app/supabase.properties.example`. Do not commit `supabase.properties` or `local.properties` (they are gitignored).

## Git

A repo is initialized here with a first commit. To push to GitHub:

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Before committing locally, run `git status` and confirm `.env.local`, `node_modules`, and `web-dashboard/node-bin` are **not** listed (they are in `.gitignore`).

After pulling on another machine, run `cd web-dashboard && npm install` so `package-lock.json` matches `package.json` (Netlify also runs `npm install` on each deploy).

## Possible improvements later

- **Custom domain** on Netlify (DNS → Netlify).
- **Supabase**: tighten RLS policies; rotate keys if they were ever committed by mistake.
- **Android**: CI build (GitHub Actions) to produce signed release APKs.
- **Dashboard**: error boundary, loading skeletons, optional Sentry for client errors.
