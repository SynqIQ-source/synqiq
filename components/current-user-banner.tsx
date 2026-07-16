"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type CurrentUserBannerProps = {
  displayName: string;
  role: "admin" | "instructor";
};

export function CurrentUserBanner({ displayName, role }: CurrentUserBannerProps) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 text-sm text-zinc-700">
      <span>
        Logged in as <span className="font-medium text-zinc-950">{displayName}</span>{" "}
        <span className="text-zinc-500">({role})</span>
      </span>
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      >
        Log out
      </button>
    </div>
  );
}
