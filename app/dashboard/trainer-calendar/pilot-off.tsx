import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Shown on the trainer sessions pilot pages when the studio hasn't turned the
// pilot on.
export function PilotOff({ admin }: { admin: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trainer sessions pilot is off</CardTitle>
        <CardDescription>
          Scheduling and completing trainer sessions in SynqIQ, with session balances and trainer pay, is a pilot that each studio turns on
          when it is ready to test it.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {admin ? (
          <p>
            Turn it on in{" "}
            <Link className="underline" href="/dashboard/settings#pt-sessions">
              Settings → PT sessions
            </Link>
            .
          </p>
        ) : (
          <p className="text-muted-foreground">Ask a Club Admin to turn it on.</p>
        )}
      </CardContent>
    </Card>
  );
}
