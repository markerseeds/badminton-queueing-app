# Badminton Queue

A real-time badminton court queueing tool for club nights. An organizer adds
players (each with a skill level), sets the number of courts (1–6), and builds a
queue. The app auto-picks fair, skill-matched groups of four — fewest games
played first, kept within one skill band — and syncs live across every device
looking at the same room.

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

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React + TypeScript
- [Tailwind CSS](https://tailwindcss.com) v4
- [Supabase](https://supabase.com) — Postgres, Realtime, and Row-Level Security

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

4. **Run the dev server**

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

The RLS and RPC tests run against the local stack. Start it, then write the
connection details the tests read:

```bash
npm run db:start
npx supabase status -o env > .env.test
npm test
```

## Roadmap

Product direction, phases, and open decisions live in [ROADMAP.md](ROADMAP.md).
