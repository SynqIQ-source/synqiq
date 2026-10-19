import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Headline metric card used across the report pages (Overview, Instructors,
// Heat Map, ...): icon + label, big number, one muted line of context.
export function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {label}
        </CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      {detail ? <CardContent className="text-xs text-muted-foreground">{detail}</CardContent> : null}
    </Card>
  );
}
