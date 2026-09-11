"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AccountBar } from "./components/AccountBar";
import { ShuttleIcon, WarningIcon } from "./components/icons";
import { Button } from "./components/ui";
import { createSession } from "./lib/sessionStore";

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const { shareCode } = await createSession();
      router.push(`/s/${shareCode}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a room.");
      setCreating(false);
    }
  };

  const handleJoin = (e: FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code) router.push(`/s/${code}`);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 p-4 md:p-6">
      <AccountBar />

      <main className="hero flex-1 justify-center pb-8">
        <span className="flex items-center gap-2 text-accent">
          <ShuttleIcon size={20} />
          <span className="lbl text-accent">Badminton Queue</span>
        </span>

        <h1>Nobody sits out twice in a row.</h1>

        <p className="muted max-w-[46ch] text-[0.9375rem]">
          Add your players, set your courts, and let it pick fair,
          skill-matched fours all session. Share one link — the tablet by the
          courts and every co-organiser stay in sync.
        </p>

        <Button
          size="lg"
          block
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? "Creating…" : "Create a room"}
        </Button>

        <div aria-hidden="true" className="flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="lbl">or join one</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={handleJoin} className="flex flex-col gap-2">
          <label htmlFor="join-code" className="lbl">
            Room code
          </label>
          <div className="joinbox">
            <input
              id="join-code"
              className="field"
              placeholder="e.g. ABCD2345"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            <Button
              type="submit"
              variant="ghost"
              size="lg"
              disabled={!joinCode.trim()}
            >
              Join
            </Button>
          </div>
        </form>

        <div className="grid grid-cols-3 gap-2.5 pt-1">
          <div className="proof">
            <b className="num">6</b>
            <span className="tiny">courts at once</span>
          </div>
          <div className="proof">
            <b className="num">0</b>
            <span className="tiny">sign-ups for players</span>
          </div>
          <div className="proof">
            <b className="num">Live</b>
            <span className="tiny">on every device</span>
          </div>
        </div>

        {error && (
          <div role="alert" className="banner banner-danger">
            <WarningIcon size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </main>
    </div>
  );
}
