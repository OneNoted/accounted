"use client";

import { useEffect, useState } from "react";

// Last-resort boundary: only fires when the root layout itself throws, so it
// renders its own <html> and must stay free of app providers/components
// (NextIntlClientProvider, CompanyContext, etc. are not mounted here). It is
// also server-rendered when the root layout throws during SSR, so the lazy
// initializer must never touch window without a guard.
//
// Like app/error.tsx, transient failures here (e.g. a token race in the first
// request after login) heal on a fresh request, so auto-reload ONCE before
// showing the manual fallback. A per-path, per-tab-session flag (a monotonic
// one-shot, not a time window that could still loop on a slow failing render)
// keeps the single reload from becoming a loop on a genuinely broken root layout.
const RELOAD_FLAG_PREFIX = "accounted:global-error-reloaded:";

function reloadKey(): string {
  return (
    RELOAD_FLAG_PREFIX +
    (typeof window !== "undefined" ? window.location.pathname : "")
  );
}

function decideInitialPhase(): "reloading" | "fallback" {
  if (typeof window === "undefined") return "reloading";
  try {
    return window.sessionStorage.getItem(reloadKey()) ? "fallback" : "reloading";
  } catch {
    return "fallback";
  }
}

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [phase] = useState<"reloading" | "fallback">(decideInitialPhase);

  useEffect(() => {
    console.error("[global] Unhandled error:", error);
    if (phase !== "reloading") return;
    try {
      window.sessionStorage.setItem(reloadKey(), "1");
    } catch {
      // Worst case: no flag written, and a later error reloads again.
    }
    window.location.reload();
  }, [phase, error]);

  return (
    <html lang="sv" translate="no">
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body>
        {phase === "fallback" ? (
          <div className="flex min-h-screen items-center justify-center p-8">
            <div className="text-center space-y-4">
              <h2 className="text-xl font-semibold">Något gick fel</h2>
              <p className="text-muted-foreground">
                Ett oväntat fel inträffade. Försök igen.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
              >
                Försök igen
              </button>
            </div>
          </div>
        ) : null}
      </body>
    </html>
  );
}
