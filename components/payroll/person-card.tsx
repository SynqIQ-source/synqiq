import type { ReactNode } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { money } from "@/lib/payroll/details";

// One person's section in a payroll detail report. The id lets Payroll link
// straight to it (#p-<staff id>).
export function PersonCard({
  staffId,
  name,
  totalCents,
  summary,
  children,
}: {
  staffId: string;
  name: string;
  totalCents: number;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <Card id={`p-${staffId}`} className="scroll-mt-20 gap-0 py-0">
      <CardHeader className="flex flex-row items-baseline justify-between gap-4 border-b py-4">
        <div>
          <CardTitle>{name}</CardTitle>
          {summary ? <CardDescription>{summary}</CardDescription> : null}
        </div>
        <span className="text-lg font-semibold tabular-nums">{money(totalCents)}</span>
      </CardHeader>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

export function EmptyReport({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border bg-card px-6 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
