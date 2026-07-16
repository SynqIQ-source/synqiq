import Link from "next/link";

const navigation = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/classes", label: "Classes" },
  { href: "/dashboard/schedule", label: "My Schedule" },
  { href: "/dashboard/heatmap", label: "Heat Map" },
  { href: "/dashboard/instructors", label: "Instructors" },
  { href: "/dashboard/substitutions", label: "Substitutions" },
];

type DashboardShellProps = {
  children: React.ReactNode;
  title: string;
  description: string;
};

export function DashboardShell({
  children,
  title,
  description,
}: DashboardShellProps) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-zinc-200 bg-white px-5 py-6 md:block">
        <Link href="/" className="text-xl font-semibold text-zinc-950">
          Synq
        </Link>
        <nav className="mt-8 flex flex-col gap-1">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="md:pl-64">
        <header className="border-b border-zinc-200 bg-white px-6 py-5">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-medium text-teal-700">Dashboard</p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-950">
              {title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              {description}
            </p>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
