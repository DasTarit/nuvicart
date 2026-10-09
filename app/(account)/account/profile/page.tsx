
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Profile = {
  userId: string;
  email: string;
  displayName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
};

type ProfileResponse = {
  profile?: Profile | null;
  error?: string;
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/customer/profile", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });

      const data: ProfileResponse = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || `Unable to load your profile (${response.status}).`
        );
      }

      if (!data.profile) {
        throw new Error("Your customer profile could not be found.");
      }

      setProfile(data.profile);
      setDisplayName(data.profile.displayName ?? "");
      setPhone(data.profile.phone ?? "");
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;

      setError(
        cause instanceof Error
          ? cause.message
          : "Something went wrong while loading your profile."
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);

    return () => controller.abort();
  }, [loadProfile]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) return;

    const name = displayName.trim();
    const phoneNumber = phone.trim();

    if (name.length < 2 || name.length > 80) {
      setError("Your name must be between 2 and 80 characters.");
      setSuccess("");
      return;
    }

    if (phoneNumber.length > 30) {
      setError("Your phone number cannot exceed 30 characters.");
      setSuccess("");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/customer/profile", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: name,
          phone: phoneNumber || null,
        }),
      });

      const data: ProfileResponse = await response.json().catch(() => ({}));

      if (!response.ok || !data.profile) {
        throw new Error(
          data.error || `Unable to save your profile (${response.status}).`
        );
      }

      setProfile(data.profile);
      setDisplayName(data.profile.displayName ?? "");
      setPhone(data.profile.phone ?? "");
      setSuccess("Your profile has been saved successfully.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn't save your changes. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="w-full max-w-2xl">
      <div className="overflow-hidden rounded-3xl border border-border bg-background shadow-sm">
        <div className="border-b border-border px-6 py-6 sm:px-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
              </svg>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Your account
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                Personal profile
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Keep your contact information up to date for a smoother
                shopping experience.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div
            className="space-y-6 px-6 py-8 sm:px-8"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3 text-sm text-muted">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
              Loading your profile…
            </div>
            <div className="space-y-2">
              <div className="h-4 w-24 animate-pulse rounded bg-surface-muted" />
              <div className="h-12 animate-pulse rounded-xl bg-surface-muted" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-16 animate-pulse rounded bg-surface-muted" />
              <div className="h-12 animate-pulse rounded-xl bg-surface-muted" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-20 animate-pulse rounded bg-surface-muted" />
              <div className="h-12 animate-pulse rounded-xl bg-surface-muted" />
            </div>
          </div>
        ) : error && !profile ? (
          <div className="px-6 py-8 sm:px-8">
            <div
              className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4"
              role="alert"
            >
              <p className="font-medium">We couldn't load your profile</p>
              <p className="mt-1 text-sm text-muted">{error}</p>
              <button
                type="button"
                onClick={() => void loadProfile()}
                className="mt-4 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6 px-6 py-7 sm:px-8">
            {profile && (
              <div className="flex items-center gap-3 rounded-2xl bg-surface-muted/60 p-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {(displayName.trim() || profile.email || "U")
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {displayName.trim() || "Your profile"}
                  </p>
                  <p className="truncate text-sm text-muted">
                    Customer account
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div
                className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm"
                role="alert"
              >
                {error}
              </div>
            )}

            {success && (
              <div
                className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm"
                role="status"
                aria-live="polite"
              >
                {success}
              </div>
            )}

            <div className="space-y-2">
              <label
                htmlFor="displayName"
                className="block text-sm font-medium"
              >
                Full name <span className="text-primary">*</span>
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                placeholder="Enter your full name"
                autoComplete="name"
                minLength={2}
                maxLength={80}
                required
                disabled={saving}
                className="w-full rounded-xl border border-border bg-background px-4 py-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
              />
              <p className="text-xs leading-5 text-muted">
                This name is associated with your customer account.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                value={profile?.email ?? ""}
                placeholder="Your sign-in email"
                autoComplete="email"
                readOnly
                disabled
                className="w-full cursor-not-allowed rounded-xl border border-border bg-surface-muted px-4 py-3.5 text-sm text-muted"
              />
              <p className="text-xs leading-5 text-muted">
                Your sign-in email cannot be changed here.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="phone" className="block text-sm font-medium">
                Phone number{" "}
                <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                placeholder="Enter your phone number"
                autoComplete="tel"
                maxLength={30}
                disabled={saving}
                className="w-full rounded-xl border border-border bg-background px-4 py-3.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
              />
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted">
                Your information is used to manage your customer account.
              </p>

              <button
                type="submit"
                disabled={saving || !profile}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                )}
                {saving ? "Saving changes…" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
