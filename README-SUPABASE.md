# Setting up Supabase (one-time, ~5 minutes)

The app's code is fully wired for auth + real data — it just needs a live
Supabase project to point at. Nothing will actually save until you do this.

## 1. Create the project

1. Go to [supabase.com](https://supabase.com) and sign up / log in.
2. Click **New Project**. Pick any name (e.g. `assist-ride`), a database
   password (save it somewhere — you likely won't need it again), and the
   region closest to you. Free tier is fine.
3. Wait ~2 minutes for it to finish provisioning.

## 2. Get your credentials

In your new project: **Settings → API**.
- Copy the **Project URL** (looks like `https://xxxxx.supabase.co`)
- Copy the **anon public** key (a long string starting with `eyJ...`)

## 3. Add them to the app

In `assist-ride/`, create a file named `.env` (copy `.env.example`) with:

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Restart the dev server after adding/changing `.env` (`npm run web`) — Expo
only reads it at startup.

## 4. Run the schema

In your Supabase project: **SQL Editor → New query**. Paste the entire
contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
and click **Run**. This creates the tables (`rider_profiles`,
`driver_profiles`, `emergency_contacts`, `medical_contacts`, `ride_requests`)
and the row-level-security policies so each user can only read/write their
own data.

## 5. Turn off email confirmation (recommended for testing)

By default Supabase requires clicking a confirmation link before a new
sign-up gets a live session — inconvenient during development.

**Authentication → Providers → Email** → toggle off **Confirm email**.

With it off, sign-up logs a user in immediately. With it on, the app will
show a "check your email" screen after sign-up and the user has to click
the link before they can log in (this is the safer setting for a real
deployment later).

## That's it

Once `.env` has real values and the schema is run, sign-up/sign-in/profile
saving should all work against the live database — no code changes needed.
