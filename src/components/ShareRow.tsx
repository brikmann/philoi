"use client";

import { useState } from "react";

export default function ShareRow({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const msg = encodeURIComponent(
    `Join me on Philoi — lock in with your people: ${shareUrl}`
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-cream px-3 py-2.5">
        <span className="flex-1 truncate font-body text-sm text-ink">{shareUrl}</span>
        <button
          onClick={handleCopy}
          className="shrink-0 font-body font-semibold text-sm text-coral hover:opacity-70 transition-opacity"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="flex gap-2">
        <a
          href={`sms:?body=${msg}`}
          className="flex-1 text-center rounded-xl border-2 border-line text-ink font-body font-semibold text-sm py-2.5 hover:bg-line transition-colors"
        >
          Text a friend
        </a>
        <a
          href={`https://wa.me/?text=${msg}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center rounded-xl border-2 border-line text-ink font-body font-semibold text-sm py-2.5 hover:bg-line transition-colors"
        >
          WhatsApp
        </a>
      </div>
    </div>
  );
}
