"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type StaffProfile = {
  id: string;
  display_name: string;
  title: string | null;
  photo_url: string | null;
  role: string;
  email: string | null;
};

type SaveStatus = "idle" | "saving" | "success" | "error";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

export function AccountForm({ staff }: { staff: StaffProfile }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [photoUrl, setPhotoUrl] = useState(staff.photo_url);
  const [avatarStatus, setAvatarStatus] = useState<SaveStatus>("idle");
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(staff.display_name);
  const [title, setTitle] = useState(staff.title ?? "");
  const [profileStatus, setProfileStatus] = useState<SaveStatus>("idle");
  const [profileError, setProfileError] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<SaveStatus>("idle");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setAvatarStatus("saving");
    setAvatarError(null);

    try {
      const formData = new FormData();
      formData.append("avatar", file);

      const response = await fetch("/api/staff/me/avatar", { method: "POST", body: formData });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setAvatarStatus("error");
        setAvatarError(result?.error ?? "Failed to upload photo.");
        return;
      }

      setPhotoUrl(result.photoUrl);
      setAvatarStatus("success");
      router.refresh();
    } catch (error) {
      setAvatarStatus("error");
      setAvatarError(error instanceof Error ? error.message : "Failed to upload photo.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleProfileSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileStatus("saving");
    setProfileError(null);

    try {
      const response = await fetch("/api/staff/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, title: title.trim() || null }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setProfileStatus("error");
        setProfileError(result?.error ?? "Failed to save.");
        return;
      }

      setProfileStatus("success");
      router.refresh();
    } catch (error) {
      setProfileStatus("error");
      setProfileError(error instanceof Error ? error.message : "Failed to save.");
    }
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      setPasswordStatus("error");
      setPasswordError("Passwords don't match.");
      return;
    }

    setPasswordStatus("saving");
    setPasswordError(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setPasswordStatus("error");
      setPasswordError(error.message);
      return;
    }

    setPasswordStatus("success");
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-950">Photo</h2>
        <div className="mt-4 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-primary-subtle text-lg font-semibold text-primary">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(displayName)
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarStatus === "saving"}
              className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            >
              {avatarStatus === "saving" ? "Uploading..." : "Change photo"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleAvatarChange}
              className="hidden"
            />
            <p className="mt-1 text-xs text-zinc-500">PNG, JPEG, or WebP. Up to 2MB.</p>
            {avatarStatus === "error" && <p className="mt-1 text-xs text-red-600">{avatarError}</p>}
          </div>
        </div>
      </div>

      <form onSubmit={handleProfileSubmit} className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-950">Profile</h2>

        <label className="mt-4 block text-sm font-medium text-zinc-700">
          Name
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-zinc-700">
          Title
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Yoga Instructor"
            className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
          />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-700">Email</p>
            <p className="mt-1 text-sm text-zinc-600">{staff.email ?? "Not set"}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-700">Access</p>
            <p className="mt-1 text-sm capitalize text-zinc-600">{staff.role}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="submit"
            disabled={profileStatus === "saving"}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {profileStatus === "saving" ? "Saving..." : "Save changes"}
          </button>
          {profileStatus === "success" && <p className="text-sm text-emerald-700">Saved.</p>}
          {profileStatus === "error" && <p className="text-sm text-red-600">{profileError}</p>}
        </div>
      </form>

      <form onSubmit={handlePasswordSubmit} className="rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-950">Change login</h2>
        <p className="mt-1 text-sm text-zinc-600">Set a new password for signing in.</p>

        <label className="mt-4 block text-sm font-medium text-zinc-700">
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            minLength={6}
            className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-zinc-700">
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={6}
            className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
          />
        </label>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="submit"
            disabled={passwordStatus === "saving"}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {passwordStatus === "saving" ? "Saving..." : "Update password"}
          </button>
          {passwordStatus === "success" && <p className="text-sm text-emerald-700">Password updated.</p>}
          {passwordStatus === "error" && <p className="text-sm text-red-600">{passwordError}</p>}
        </div>
      </form>
    </div>
  );
}
