"use client";

import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { MAX_ROOM_NAME } from "../lib/logic";
import { Button } from "./ui";

export function RenameRoomModal({
  name,
  shareCode,
  onSubmit,
  onCancel,
}: {
  name: string | null;
  shareCode: string;
  // Hands up the raw field value, as EditPlayerModal does — `useSession`
  // normalizes, so the form and the write can't disagree about the rules.
  onSubmit: (raw: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name ?? "");

  useEscapeKey(onCancel);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(draft);
  };

  return (
    <div className="modal-scrim z-40">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-room-title"
        onSubmit={handleSubmit}
      >
        <div className="modal-grab" aria-hidden="true" />

        <h3 id="rename-room-title" className="heading text-base">
          {name ? "Rename room" : "Name this room"}
        </h3>

        <div className="modal-field">
          <label className="lbl" htmlFor="rename-room-name">
            Room name
          </label>
          <input
            autoFocus
            id="rename-room-name"
            className="modal-input"
            maxLength={MAX_ROOM_NAME}
            placeholder={`Tuesday club · ${shareCode}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {/* An empty field being the *clear* action is invisible otherwise —
              and it's the reason Save below is never disabled. */}
          <p className="tiny">Leave it empty to remove the name.</p>
        </div>

        <div className="modal-actions">
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          {/* Deliberately not disabled on an empty field, unlike
              EditPlayerModal: a player must be called something, so there blank
              means "don't write", while here it is the only way to unname a
              room. Disabling it would make that unreachable. */}
          <Button type="submit">Save</Button>
        </div>
      </form>
    </div>
  );
}
