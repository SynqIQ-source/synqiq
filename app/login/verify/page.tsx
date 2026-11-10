import type { Metadata } from "next";
import { AuthHeader } from "@/components/auth-header";
import { SiteFooter } from "@/components/site-footer";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = {
  title: "Enter your code | SynqIQ",
  description: "Two-step sign-in for your SynqIQ staff account.",
  robots: { index: false },
};

// Second step of sign-in for accounts with an authenticator app set up.
// The dashboard middleware sends any such session here until it enters a code.
export default function VerifyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <AuthHeader />
        <VerifyForm />
      </div>
      <SiteFooter />
    </div>
  );
}
