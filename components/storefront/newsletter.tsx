"use client";

import { useState } from "react";

export function Newsletter() {
  const [submitted, setSubmitted] = useState(false);
  return <section className="border-y bg-surface-muted">
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Stay in the loop</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Good finds, occasionally.</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted">New arrivals, thoughtful deals and the occasional thing worth knowing.</p></div>
        {submitted
          ? <p role="status" className="max-w-md text-sm font-medium text-muted">Demo mode — newsletter integration is coming soon. No email was stored.</p>
          : <form className="flex w-full max-w-md gap-2" onSubmit={event => { event.preventDefault(); setSubmitted(true); }}>
            <label className="sr-only" htmlFor="newsletter">Email address</label>
            <input id="newsletter" type="email" required autoComplete="email" placeholder="you@example.com" className="h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-sm" />
            <button type="submit" className="rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground">Notify me</button>
          </form>}
      </div>
    </div>
  </section>;
}
