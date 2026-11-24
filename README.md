# Badminton Queue

A real-time badminton court queueing tool for club nights. An organizer adds
players (each with a skill level), sets the number of courts (1–6), and builds a
queue. The app auto-picks fair, skill-matched groups of four — fewest games
played first, kept within one skill band — and syncs live across every device
looking at the same room.

https://badminton-queueing-app.vercel.app/

## Features

- **Auto-pick** balanced groups of four (fewest games first, one skill band).
- **Live sync** across devices in real time.
- **Queue management** — add/remove players, shuffle the front four into new teams.
- **Court board** — Team 1 vs Team 2 per court, start/end games.
- **Batch add** players ("Name, Skill" per line) and delete-all with confirmation.
- **Per-player games-played** tracking with quick steppers.
- **Your rooms, saved** — creating a room claims it for you (no sign-up prompt), and `/rooms` lists
  everything you've made. Sign in with Google to keep them across devices.
- **Room lock** — rooms are open by default so the courtside tablet and co-organizers can all edit;
  the owner can lock a room to restrict editing to themselves.
- **Free and Pro** — free rooms get 2 courts and 10 players, and an account keeps 2 saved rooms;
  Pro, a one-time purchase through Paddle, lifts that to 6 courts and unlimited players and rooms.
  The limits are enforced in Postgres, not in the browser.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React + TypeScript
- [Tailwind CSS](https://tailwindcss.com) v4
- [Supabase](https://supabase.com) — Postgres, Realtime, Row-Level Security, Auth and Edge Functions
- [Paddle](https://www.paddle.com) — checkout and payments, as merchant of record
- [Sentry](https://sentry.io) — error reports from the payment Edge Functions

## Getting started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure Supabase**

   Copy the example env file and fill in your project's URL and anon key
   (Supabase dashboard → Project Settings → API):

   ```bash
   cp .env.local.example .env.local
   ```

   Both values are public identifiers; Row-Level Security is what protects the
   data. Never put the `service_role` key in a `NEXT_PUBLIC_*` variable.

3. **Enable sign-in providers** (Supabase dashboard → Authentication → Providers)

   - **Anonymous sign-ins** — required. Creating a room signs the organizer in
     anonymously so the room has an owner without a sign-up wall.
   - **Google** — optional but recommended, so organizers can keep their rooms
     across devices. Create a Web application OAuth client in the Google Cloud
     Console with the redirect URI
     `https://<project-ref>.supabase.co/auth/v1/callback`, then paste the client
     ID and secret into the dashboard.

   For the local stack these live in `supabase/config.toml` instead — anonymous
   sign-ins are already enabled there; set
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` and flip
   `[auth.external.google] enabled = true` to test Google locally.

4. **Checkout (optional)**

   Without the three `NEXT_PUBLIC_PADDLE_*` variables in `.env.local` the
   pricing page says "Checkout unavailable" and everything else works. To try
   checkout against Paddle's sandbox, set them (see `.env.local.example`), give
   the Edge Functions their secrets in `supabase/functions/.env` (see
   `supabase/functions/.env.example`), and serve them with
   `npx supabase functions serve`.

5. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000), create a room, and share
   the room link with your club.

## Scripts

| Command             | Description                             |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Start the dev server                    |
| `npm run build`     | Production build                        |
| `npm run start`     | Build then start production             |
| `npm run lint`      | Run ESLint                              |
| `npm test`          | Run the test suite                      |
| `npm run db:start`  | Start the local Supabase stack (Docker) |
| `npm run db:reset`  | Re-apply all migrations locally         |
| `npm run db:stop`   | Stop the local Supabase stack           |
| `npm run functions:check` | Type-check the Edge Functions (Deno) |

The RLS and RPC tests run against the local stack. Start it, then write the
connection details the tests read:

```bash
npm run db:start
npx supabase status -o env > .env.test
npm test
```

The Edge Function HTTP tests (`tests/functions/`) skip themselves unless the
functions are being served with the test fixture, and that fixture is loaded
into the test run:

```bash
npx supabase functions serve --env-file tests/fixtures/functions.env   # in one terminal
set -a; . tests/fixtures/functions.env; set +a; npm test              # in another
```

CI does both on every push.

## Deploying

Pushing `main` deploys production on Vercel, and the production build applies
pending migrations and deploys the Edge Functions first
([scripts/vercel-migrate.mjs](scripts/vercel-migrate.mjs)). Previews do neither.
It needs `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`
in Vercel's Production environment; the functions' own secrets are set once,
by hand, with `supabase secrets set` and are never pushed by a build.

## Roadmap

Product direction, phases, and open decisions live in [ROADMAP.md](ROADMAP.md).
