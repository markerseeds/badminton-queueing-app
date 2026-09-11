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

// The design tokens in globals.css generate utilities tailwind-merge has never
// heard of (`bg-surface`, `text-ink-2`). These tests pin down which of those it
// can still arbitrate, because the answer is what decides where a design value
// is allowed to live.
describe("cn with design tokens", () => {
  it("treats two token colours on the same property as conflicting", () => {
    // tailwind-merge's colour validator accepts any unknown name, so this works
    // with no configuration. Asserted anyway: a dependency bump that tightened
    // the rule would break every `className` override in the app silently, and
    // these tests turn that into a failing build instead.
    expect(cn("bg-surface", "bg-danger")).toBe("bg-danger");
    expect(cn("text-ink-2", "text-danger")).toBe("text-danger");
    expect(cn("border-line", "border-danger")).toBe("border-danger");
    expect(cn("bg-ink/40", "bg-ink/60")).toBe("bg-ink/60");
  });

  it("mixes token and stock colours in either direction", () => {
    expect(cn("bg-black", "bg-surface")).toBe("bg-surface");
    expect(cn("bg-surface", "bg-red-600")).toBe("bg-red-600");
  });

  it("keeps a font size and a text colour side by side", () => {
    // Why there are no custom `--text-*` tokens: tailwind-merge scores an
    // unknown `text-foo` as a *colour*, so a custom text size would be silently
    // swallowed by a later text colour. Sizes stay in the component classes.
    expect(cn("text-sm", "text-ink")).toBe("text-sm text-ink");
  });

  it("arbitrates non-colour design values written as arbitrary variables", () => {
    // And why radius/shadow/sizing are never named theme entries either:
    // `rounded-card` would not conflict with `rounded-lg` — both would survive
    // and stylesheet order would decide. The arbitrary-variable form does.
    expect(cn("rounded-lg", "rounded-(--bq-radius)")).toBe(
      "rounded-(--bq-radius)",
    );
    expect(cn("min-h-11", "min-h-(--bq-touch)")).toBe("min-h-(--bq-touch)");
  });

  it("lets a passed button variant beat the base one", () => {
    // `.btn-*` are hand-written component classes, so tailwind-merge can only
    // know they conflict if we tell it — see the class groups in cn.ts.
    expect(cn("btn btn-primary", "btn-danger")).toBe("btn btn-danger");
    expect(cn("btn btn-primary btn-sm", "btn-lg")).toBe(
      "btn btn-primary btn-lg",
    );
  });

  it("leaves component classes it doesn't know about alone", () => {
    // A utility still beats a component class at runtime — not by winning a
    // merge, but because Tailwind's `utilities` layer outranks `components`.
    expect(cn("prow-acts", "hidden")).toBe("prow-acts hidden");
    expect(cn("btn btn-primary", "bg-danger")).toBe("btn btn-primary bg-danger");
  });
});
