import { MarketingHeader } from "@/components/marketing-header";
import { SiteFooter } from "@/components/site-footer";

// Shared shell for /privacy and /terms -- plain readable prose, same
// header/footer as the rest of the public site.
export function LegalPage({
  title,
  updated,
  children,
}: Readonly<{ title: string; updated: string; children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold text-zinc-950 sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated {updated}</p>
        <div className="mt-8 space-y-6 text-base leading-7 text-zinc-600 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-950 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_a]:font-medium [&_a]:text-primary [&_a:hover]:underline">
          {children}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
