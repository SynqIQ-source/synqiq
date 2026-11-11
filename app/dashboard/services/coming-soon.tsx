import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Shared layout for Services & Pricing pages that aren't built yet: what
// will live there and what it depends on.
export function ComingSoon({ items, note }: { items: string[]; note: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Coming next</CardTitle>
        <CardDescription>{note}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
