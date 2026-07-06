-- Explicit table privileges for the PostgREST API roles.
--
-- Production granted these implicitly (via Supabase's platform default
-- privileges), but a fresh `supabase start` — used for local dev and CI — does
-- not reproduce that, leaving anon / authenticated / service_role with only
-- REFERENCES / TRIGGER / TRUNCATE and no DML. Declaring the grants here keeps
-- every environment in parity and makes the Phase 1 capability-URL posture
-- explicit: anon may read/write any room; the unguessable share_code is the
-- gate. Idempotent — re-granting in production is a no-op. RLS still applies on
-- top of these grants (it is enabled on both tables in the init migration).

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.sessions
  to anon, authenticated, service_role;

grant select, insert, update, delete on public.players
  to anon, authenticated, service_role;
