import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { PDF_ORIGIN } from "../lib/navigation";

export default function ConnectPdfPage() {
  const { session, user } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const query = new URLSearchParams(window.location.search);
  const state = query.get("state"),
    challenge = query.get("challenge");
  const valid =
    /^[a-f0-9]{64}$/.test(state || "") &&
    /^[a-f0-9]{64}$/.test(challenge || "");
  async function connect() {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pdf-auth/mint", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state, challenge }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not connect. Please try again.");
      const target = new URL(result.url);
      if (
        target.origin !== PDF_ORIGIN ||
        target.pathname !== "/api/auth/callback"
      )
        throw new Error("Invalid PDF sign-in destination.");
      window.location.assign(target.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect.");
      setBusy(false);
    }
  }
  return (
    <main className="min-h-dvh bg-paper text-ink grid place-items-center p-6">
      <section className="max-w-lg border-2 border-ink p-8">
        <p className="text-xs uppercase tracking-widest mb-4">Rovty account</p>
        <h1 className="text-3xl font-bold mb-5">Connect to Rovty PDF</h1>
        <p className="mb-4">
          Use {user?.email} for your optional PDF workspace in Rovty Cloud. Rovty PDF
          receives your account ID and email to keep your saved documents,
          templates and preferences together.
        </p>
        <p className="mb-6">
          Signing in does not upload any PDFs or saved signatures. Local editing
          stays free and works without an account. Cloud storage and sharing
          only upload the files you choose.
        </p>
        {!valid && (
          <p role="alert" className="mb-4">
            Start sign-in from Rovty Cloud in Rovty PDF.
          </p>
        )}
        {error && (
          <p role="alert" className="mb-4">
            {error}
          </p>
        )}
        <div className="flex gap-5 items-center flex-wrap">
          <button
            className="bg-ink text-paper px-5 py-3 font-bold disabled:opacity-50"
            disabled={!valid || busy}
            onClick={() => void connect()}
          >
            {busy ? "Connecting…" : "Connect Rovty PDF"}
          </button>
          <a href={`${PDF_ORIGIN}/cloud`} className="underline">
            Cancel
          </a>
          <a href={`${PDF_ORIGIN}/privacy`} className="underline">
            Privacy details
          </a>
        </div>
      </section>
    </main>
  );
}
