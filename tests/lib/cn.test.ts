import { describe, expect, it } from "vitest";
import { cn } from "../../app/lib/cn";

// Pure-logic unit test — no Supabase. `cn` only wraps clsx + tailwind-merge.
describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    expect(cn("px-3", "py-1")).toBe("px-3 py-1");
    expect(cn("px-3", false && "hidden", undefined, null, "py-1")).toBe(
      "px-3 py-1",
    );
  });

  it("lets a later Tailwind class override an earlier conflicting one", () => {
    // The whole point of the refactor: a passed override must beat the base.
    expect(cn("bg-black", "bg-red-600")).toBe("bg-red-600");
    expect(cn("w-full", "w-20")).toBe("w-20");
  });
});
