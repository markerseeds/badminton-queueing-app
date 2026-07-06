"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, Input } from "./components/ui";
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
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="p-8 w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">
            <span aria-hidden="true">🏸</span> Badminton Queue
          </h1>
          <p className="text-sm text-gray-500">
            Create a room and share the link with your club.
          </p>
        </div>

        <Button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="w-full py-2"
        >
          {creating ? "Creating…" : "Create a room"}
        </Button>

        <div
          aria-hidden="true"
          className="flex items-center gap-3 text-xs text-gray-500"
        >
          <div className="h-px bg-gray-200 flex-1" />
          OR
          <div className="h-px bg-gray-200 flex-1" />
        </div>

        <form onSubmit={handleJoin} className="space-y-2">
          <label htmlFor="join-code" className="text-sm font-medium">
            Join with a room code
          </label>
          <div className="flex gap-2">
            <Input
              id="join-code"
              placeholder="e.g. ABCD2345"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            <Button type="submit" className="bg-gray-700 whitespace-nowrap">
              Join
            </Button>
          </div>
        </form>

        {error && (
          <p role="alert" className="text-red-600 text-sm">
            <span aria-hidden="true">⚠️</span> {error}
          </p>
        )}
      </Card>
    </div>
  );
}
