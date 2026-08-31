// Shown above the card on every pre-auth page (/login, /forgot-password,
// /reset-password). These pages previously had no logo or company identity
// -- just a bare email/password form -- which is indistinguishable from a
// generic phishing-kit template to both visitors and automated scanners.
export function AuthHeader() {
  return (
    <div className="mb-6 flex items-center gap-3">
      <img src="/icons/icon-192.png" alt="SynqIQ" className="h-10 w-10 rounded-md" />
      <div>
        <p className="text-lg font-semibold text-zinc-950">SynqIQ</p>
        <p className="text-xs text-zinc-500">Studio operations platform</p>
      </div>
    </div>
  );
}
