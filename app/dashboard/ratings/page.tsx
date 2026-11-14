import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin, isInstructorAccess } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { LOW_STARS, quarterLabel, quarterOf, quartersOf, score, type Score } from "@/lib/ratings/rules";
import { RatingsFilters, RatingsMode } from "./ratings-controls";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ instructor?: string; style?: string; year?: string; sort?: string }> };

type Rating = {
  id: string;
  staffId: string;
  clientName: string | null;
  className: string;
  classStyle: string;
  classStart: string;
  quarter: string;
  stars: number;
  comment: string | null;
};

// Teaching > Ratings. Club Admins: every instructor, with member names.
// Instructors: their own ratings and comments, never who left them, next to
// the club's and the class style's averages.
export default async function RatingsPage({ searchParams }: Props) {
  const staff = await requireAccess(isInstructorAccess);
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const isAdmin = isClubAdmin(staff);
  const params = await searchParams;
  const { data: orgRow } = await admin.from("organizations").select("timezone, ratings_mode").eq("id", org).maybeSingle();
  const zone = (orgRow?.timezone as string | null) ?? "America/Chicago";
  const now = DateTime.now().setZone(zone);
  const currentQuarter = quarterOf(now.toUTC().toISO()!, zone);
  const year = Number(params.year) >= 2020 && Number(params.year) <= now.year ? Number(params.year) : now.year;

  const ratingRows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("class_ratings")
      .select("id, staff_id, client_name, class_name, class_style, class_start, quarter, stars, comment")
      .eq("organization_id", org)
      .order("class_start", { ascending: false })
      .range(from, from + 999);
    ratingRows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const ratings: Rating[] = ratingRows.map((row) => ({
    id: row.id as string,
    staffId: row.staff_id as string,
    clientName: (row.client_name as string | null) ?? null,
    className: row.class_name as string,
    classStyle: row.class_style as string,
    classStart: row.class_start as string,
    quarter: row.quarter as string,
    stars: Number(row.stars),
    comment: (row.comment as string | null) ?? null,
  }));
  const [{ data: requestRows }, { data: people }] = await Promise.all([
    admin
      .from("rating_requests")
      .select("staff_id, quarter, status")
      .eq("organization_id", org)
      .in("status", ["sent", "rated", "expired"])
      .limit(20000),
    admin.from("staff").select("id, display_name, is_instructor").eq("organization_id", org),
  ]);
  const nameOf = new Map((people ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? "Instructor"]));

  // Instructors are locked to themselves.
  const instructor = isAdmin ? (params.instructor && nameOf.has(params.instructor) ? params.instructor : null) : staff.id;
  const styles = [...new Set(ratings.map((rating) => rating.classStyle))].sort();
  const style = params.style && styles.includes(params.style) ? params.style : null;
  const instructorOptions = [...new Set(ratings.map((rating) => rating.staffId))]
    .map((id) => ({ id, name: nameOf.get(id) ?? "Instructor" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const stars = (list: Rating[]) => list.map((rating) => rating.stars);
  const responseRate = (quarter: string | null) => {
    const asked = (requestRows ?? []).filter((row) => !quarter || row.quarter === quarter);
    const rated = asked.filter((row) => row.status === "rated").length;
    return asked.length ? Math.round((rated / asked.length) * 100) : null;
  };
  const quarterTiles = quartersOf(year).map((quarter) => ({
    quarter,
    score: score(stars(ratings.filter((rating) => rating.quarter === quarter))),
    response: responseRate(quarter),
  }));
  const yearScore = score(stars(ratings.filter((rating) => rating.quarter.startsWith(`${year}-`))));
  const allTime = score(stars(ratings));

  // Comparisons: club, this instructor (all formats), this class style (all instructors).
  const compare = (filter: (rating: Rating) => boolean) => ({
    quarter: score(stars(ratings.filter((rating) => rating.quarter === currentQuarter && filter(rating)))),
    allTime: score(stars(ratings.filter(filter))),
  });
  const comparisons: { label: string; quarter: Score; allTime: Score }[] = [{ label: "Club (all instructors)", ...compare(() => true) }];
  if (instructor)
    comparisons.push({ label: `${nameOf.get(instructor) ?? "Instructor"} (all formats)`, ...compare((r) => r.staffId === instructor) });
  if (style) comparisons.push({ label: `${style} (all instructors)`, ...compare((r) => r.classStyle === style) });
  if (instructor && style)
    comparisons.push({
      label: `${nameOf.get(instructor) ?? "Instructor"} teaching ${style}`,
      ...compare((r) => r.staffId === instructor && r.classStyle === style),
    });

  const sort = params.sort === "lowest" || params.sort === "highest" ? params.sort : "newest";
  const shown = ratings
    .filter((rating) => (!instructor || rating.staffId === instructor) && (!style || rating.classStyle === style))
    .sort((a, b) =>
      sort === "lowest"
        ? a.stars - b.stars || b.classStart.localeCompare(a.classStart)
        : sort === "highest"
          ? b.stars - a.stars || b.classStart.localeCompare(a.classStart)
          : b.classStart.localeCompare(a.classStart),
    )
    .slice(0, 500);
  const low = isAdmin ? ratings.filter((rating) => rating.quarter === currentQuarter && rating.stars <= LOW_STARS) : [];
  const fmt = (value: Score) => (value.average == null ? "—" : value.average.toFixed(2));
  const day = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("LLL d, yyyy");
  const starText = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

  return (
    <DashboardShell
      title="Ratings"
      description={
        isAdmin
          ? "Members rate their first class with each instructor each quarter. Club Admins see who left each rating; instructors don't."
          : "How members rate your classes. Ratings are anonymous: you see the stars and comments, not who left them."
      }
    >
      <div className="space-y-6">
        {isAdmin ? <RatingsMode mode={(orgRow?.ratings_mode as string | null) ?? "testers"} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Club scorecard {year}</CardTitle>
            <CardDescription>Average stars across every instructor, by calendar quarter.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {quarterTiles.map((tile) => (
                <div key={tile.quarter} className={`rounded-lg border p-3 ${tile.quarter === currentQuarter ? "border-primary" : ""}`}>
                  <p className="text-xs text-muted-foreground">{quarterLabel(tile.quarter)}</p>
                  <p className="text-2xl font-semibold tabular-nums">{fmt(tile.score)}</p>
                  <p className="text-xs text-muted-foreground">
                    {tile.score.count} rating{tile.score.count === 1 ? "" : "s"}
                    {tile.response != null ? ` · ${tile.response}% replied` : ""}
                  </p>
                </div>
              ))}
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">{year} so far</p>
                <p className="text-2xl font-semibold tabular-nums">{fmt(yearScore)}</p>
                <p className="text-xs text-muted-foreground">{yearScore.count} ratings</p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">All time</p>
                <p className="text-2xl font-semibold tabular-nums">{fmt(allTime)}</p>
                <p className="text-xs text-muted-foreground">{allTime.count} ratings</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <RatingsFilters
          isAdmin={isAdmin}
          instructors={instructorOptions}
          instructor={instructor}
          styles={styles}
          style={style}
          year={year}
          years={Array.from({ length: Math.max(1, now.year - 2025) }, (_, i) => now.year - i)}
          sort={sort}
        />

        <Card>
          <CardHeader>
            <CardTitle>Compare</CardTitle>
            <CardDescription>{quarterLabel(currentQuarter)} and all time.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead className="text-right">{quarterLabel(currentQuarter)}</TableHead>
                  <TableHead className="text-right">All time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisons.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(row.quarter)} <span className="text-xs text-muted-foreground">({row.quarter.count})</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(row.allTime)} <span className="text-xs text-muted-foreground">({row.allTime.count})</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {isAdmin && low.length ? (
          <Card className="border-amber-300 dark:border-amber-800">
            <CardHeader>
              <CardTitle>Low ratings this quarter ({LOW_STARS} stars or under)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {low.map((rating) => (
                <div key={rating.id} className="rounded-md border px-3 py-2 text-sm">
                  <span className="text-amber-500">{starText(rating.stars)}</span> {nameOf.get(rating.staffId)} · {rating.className} ·{" "}
                  {day(rating.classStart)} · {rating.clientName ?? "Member"}
                  {rating.comment ? <p className="mt-1 text-muted-foreground">“{rating.comment}”</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Ratings</CardTitle>
            <CardDescription>
              {shown.length} shown{instructor || style ? " for this filter" : ""}.
            </CardDescription>
          </CardHeader>
          {shown.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No ratings yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    {isAdmin ? <TableHead>Instructor</TableHead> : null}
                    <TableHead>Stars</TableHead>
                    <TableHead>Comment</TableHead>
                    {isAdmin ? <TableHead>Member</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((rating) => (
                    <TableRow key={rating.id}>
                      <TableCell className="whitespace-nowrap">
                        {rating.className}
                        <span className="block text-xs text-muted-foreground">{day(rating.classStart)}</span>
                      </TableCell>
                      {isAdmin ? <TableCell>{nameOf.get(rating.staffId)}</TableCell> : null}
                      <TableCell className="whitespace-nowrap">
                        <span className="text-amber-500">{starText(rating.stars)}</span>
                        {rating.stars <= LOW_STARS ? (
                          <Badge variant="outline" className="ml-1">
                            Low
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-md text-sm whitespace-pre-line">
                        {rating.comment ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      {isAdmin ? <TableCell className="text-sm">{rating.clientName ?? "—"}</TableCell> : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
