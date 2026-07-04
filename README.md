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

3. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000), create a room, and share
   the room link with your club.

## Scripts

| Command         | Description                 |
| --------------- | --------------------------- |
| `npm run dev`   | Start the dev server        |
| `npm run build` | Production build            |
| `npm run start` | Build then start production |
| `npm run lint`  | Run ESLint                  |

## Roadmap

Product direction, phases, and open decisions live in [ROADMAP.md](ROADMAP.md).
