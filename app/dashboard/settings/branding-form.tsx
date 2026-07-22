"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ALLOWED_FONTS } from "@/lib/fonts";

type Organization = {
  id: string;
  name: string;
  primary_color: string;
  accent_color: string;
  font_family: string;
  logo_url: string | null;
};

type SaveStatus = "idle" | "saving" | "error";

export function BrandingForm({ organization }: { organization: Organization }) {
  const router = useRouter();
  const [primaryColor, setPrimaryColor] = useState(organization.primary_color);
  const [accentColor, setAccentColor] = useState(organization.accent_color);
  const [fontFamily, setFontFamily] = useState(organization.font_family);
  const [logoUrl, setLogoUrl] = useState(organization.logo_url);
  const [colorStatus, setColorStatus] = useState<SaveStatus>("idle");
  const [colorError, setColorError] = useState<string | null>(null);
  const [logoStatus, setLogoStatus] = useState<SaveStatus>("idle");
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleColorFontSave(event: React.FormEvent) {
    event.preventDefault();
    setColorStatus("saving");
    setColorError(null);

    try {
      const response = await fetch("/api/organizations/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryColor, accentColor, fontFamily }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Failed to save branding.");
      }

      setColorStatus("idle");
      // Colors/font are resolved server-side in the root layout on every
      // request -- a client-side save needs a real round-trip for the new
      // values to actually show up.
      router.refresh();
    } catch (error) {
      setColorStatus("error");
      setColorError(error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function handleLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setLogoStatus("saving");
    setLogoError(null);

    try {
      const formData = new FormData();
      formData.append("logo", file);

      const response = await fetch("/api/organizations/branding/logo", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Failed to upload logo.");
      }

      setLogoUrl(result.logoUrl);
      setLogoStatus("idle");
      router.refresh();
    } catch (error) {
      setLogoStatus("error");
      setLogoError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={handleColorFontSave}
        className="flex flex-col gap-5 rounded-lg border border-zinc-200 bg-white p-6"
      >
        <h2 className="text-sm font-semibold text-zinc-950">Colors &amp; font</h2>

        <div className="flex flex-wrap gap-6">
          <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
            Primary color
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor}
                onChange={(event) => setPrimaryColor(event.target.value)}
                className="h-9 w-9 cursor-pointer rounded border border-zinc-200"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(event) => setPrimaryColor(event.target.value)}
                pattern="^#[0-9a-fA-F]{6}$"
                className="w-28 rounded-md border border-zinc-200 px-2 py-1 text-sm"
              />
            </div>
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
            Accent color
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
                className="h-9 w-9 cursor-pointer rounded border border-zinc-200"
              />
              <input
                type="text"
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
                pattern="^#[0-9a-fA-F]{6}$"
                className="w-28 rounded-md border border-zinc-200 px-2 py-1 text-sm"
              />
            </div>
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
            Font
            <select
              value={fontFamily}
              onChange={(event) => setFontFamily(event.target.value)}
              className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
            >
              {ALLOWED_FONTS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </label>
        </div>

        {colorError && <p className="text-sm text-red-600">{colorError}</p>}

        <button
          type="submit"
          disabled={colorStatus === "saving"}
          className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {colorStatus === "saving" ? "Saving..." : "Save colors & font"}
        </button>
      </form>

      <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-zinc-950">Logo</h2>

        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local/optimizable asset
          <img
            src={logoUrl}
            alt={`${organization.name} logo`}
            // Inline style, not Tailwind's h-16/w-auto utilities: something
            // in the cascade (confirmed via computed style, not just
            // guessed) was resolving width to a literal 100%-of-container
            // pixel value instead of "auto", stretching any non-square logo
            // -- inline style always wins regardless of that conflict.
            style={{ height: "4rem", width: "auto", objectFit: "contain" }}
          />
        ) : (
          <p className="text-sm text-zinc-500">No logo uploaded yet.</p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          onChange={handleLogoUpload}
          disabled={logoStatus === "saving"}
          className="text-sm"
        />

        {logoStatus === "saving" && <p className="text-sm text-zinc-500">Uploading...</p>}
        {logoError && <p className="text-sm text-red-600">{logoError}</p>}
      </div>
    </div>
  );
}
