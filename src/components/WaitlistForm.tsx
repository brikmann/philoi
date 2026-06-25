"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import ShareRow from "./ShareRow";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; referralCode: string }
  | { status: "duplicate"; referralCode: string }
  | { status: "error"; message: string };

export default function WaitlistForm({
  referredBy,
  variant = "light",
}: {
  referredBy?: string;
  variant?: "light" | "dark";
}) {
  const [email, setEmail] = useState("");
  const [goal, setGoal] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.status === "loading") return;
    setState({ status: "loading" });

    const { data, error } = await supabase
      .from("waitlist")
      .insert({
        email: email.trim().toLowerCase(),
        goal: goal.trim() || null,
        referred_by: referredBy || null,
      })
      .select("referral_code")
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await supabase
          .from("waitlist")
          .select("referral_code")
          .eq("email", email.trim().toLowerCase())
          .single();
        setState({ status: "duplicate", referralCode: existing?.referral_code ?? "" });
      } else {
        setState({ status: "error", message: "Something went wrong. Try again?" });
      }
      return;
    }

    setState({ status: "success", referralCode: data.referral_code });
  }

  const siteOrigin =
    typeof window !== "undefined" ? window.location.origin : "https://getphiloi.com";

  if (state.status === "success" || state.status === "duplicate") {
    const shareUrl = `${siteOrigin}/?ref=${state.referralCode}`;
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="rounded-2xl bg-card border border-line p-6 flex flex-col gap-4">
          {state.status === "duplicate" ? (
            <>
              <p className="font-display text-xl font-semibold text-plum">You&apos;re already in!</p>
              <p className="font-body text-sm text-muted">Here&apos;s your personal share link:</p>
            </>
          ) : (
            <>
              <p className="font-body text-sm font-semibold text-green flex items-center gap-1.5">
                <span>🔥</span>
                <span>Founding member locked in.</span>
              </p>
              <p className="font-display text-xl font-semibold text-plum">
                Philoi works better with your people.
              </p>
              <p className="font-body text-sm text-muted">
                Pull 3 friends in — share your link:
              </p>
            </>
          )}
          <ShareRow shareUrl={shareUrl} />
        </div>
      </div>
    );
  }

  const inputClass =
    variant === "dark"
      ? "w-full rounded-2xl border-2 border-white/20 bg-white/10 px-4 py-3 font-body text-base text-cream placeholder:text-cream/40 focus:outline-none focus:border-amber transition-colors"
      : "w-full rounded-2xl border-2 border-line bg-white px-4 py-3 font-body text-base text-ink placeholder:text-muted focus:outline-none focus:border-coral transition-colors";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full max-w-md mx-auto">
      <input
        type="email"
        required
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={inputClass}
      />
      <input
        type="text"
        placeholder="What's your #1 goal? (optional)"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        className={inputClass}
      />
      <button
        type="submit"
        disabled={state.status === "loading"}
        className="w-full rounded-2xl bg-coral text-white font-display font-semibold text-lg py-3.5 px-6 shadow-[0_8px_22px_rgba(224,97,44,0.30)] hover:opacity-90 active:scale-[0.98] transition-all disabled:bg-[#D8C9BC] disabled:shadow-none disabled:cursor-not-allowed"
      >
        {state.status === "loading" ? "Saving…" : "Save my spot"}
      </button>
      {state.status === "error" && (
        <p className="text-center text-sm text-coral font-body">{state.message}</p>
      )}
    </form>
  );
}
