import { NextRequest, NextResponse } from "next/server";
import { createMindbodyClient } from "@/lib/mindbody/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { delay, withRetry } from "@/lib/retry";
import { getEnv } from "@/lib/env";
import type { MindbodySale } from "@/types/mindbody";

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

// Same lookup-only pattern as the appointments sync route: staff is synced
// by /api/sync/classes, not here.
async function getStaffIdByMindbodyId(supabase: SupabaseAdminClient, organizationId: string) {
  const { data, error } = await supabase
    .from("staff")
    .select("id, mindbody_staff_id")
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error(`Failed to load staff: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.mindbody_staff_id as number, row.id as string]));
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startSaleDateTime = searchParams.get("startSaleDateTime") ?? undefined;
    const endSaleDateTime = searchParams.get("endSaleDateTime") ?? undefined;

    const mindbody = createMindbodyClient();
    const supabase = createSupabaseAdminClient();

    // No usertoken/issue staff login -- see classes/route.ts for why: a
    // staff login's Authorization token scopes every call to that staff
    // member's own home site regardless of the SiteId header, which is
    // what caused every sync to resolve to the sandbox site. Api-Key +
    // SiteId alone is the correct activated-key model.
    const configuredSiteId = Number(getEnv("MINDBODY_SITE_ID"));
    const siteResult = await mindbody.getSite();
    const site = siteResult.Sites?.find((candidate: { Id: number }) => candidate.Id === configuredSiteId);

    if (!site) {
      throw new Error(
        `MindBody /site/sites did not return a site matching MINDBODY_SITE_ID=${configuredSiteId}.`,
      );
    }

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .upsert(
        {
          mindbody_site_id: site.Id,
          timezone: site.TimeZone,
          name: site.Name,
        },
        { onConflict: "mindbody_site_id" },
      )
      .select()
      .single();

    if (orgError || !org) {
      throw new Error(orgError?.message ?? "Failed to upsert organization.");
    }

    const staffIdByMindbodyId = await getStaffIdByMindbodyId(supabase, org.id);

    let imported = 0;
    let total = 0;
    let offset = 0;
    const pageLimit = 200;

    for (;;) {
      const page = await withRetry(() =>
        mindbody.getSales(undefined, { startSaleDateTime, endSaleDateTime, offset, limit: pageLimit }),
      );
      const sales = (page.Sales ?? []) as MindbodySale[];
      // Only trust TotalResults from a page that actually returned rows --
      // confirmed empirically against the sandbox: /sale/sales' true
      // terminal empty page reports TotalResults: 0 even though every prior
      // page agreed on a higher (and it turns out overstated -- 468 vs. an
      // actual 459) figure. Skipping the empty page's TotalResults keeps
      // `total` at the last real value instead of being clobbered to 0
      // right as the loop is about to exit anyway.
      if (sales.length > 0) {
        total = page.PaginationResponse?.TotalResults ?? total;
      }

      for (const sale of sales) {
        // Unlike appointment/class StartDateTime, SaleDateTime already
        // carries a "Z" (real UTC) -- confirmed empirically against the
        // sandbox -- so it's parsed directly, no org-timezone conversion.
        const totalAmount = (sale.PurchasedItems ?? []).reduce(
          (sum, item) => sum + (item.TotalAmount ?? 0),
          0,
        );

        const { error } = await supabase.from("sales").upsert(
          {
            mindbody_sale_id: sale.Id,
            organization_id: org.id,
            sales_rep_staff_id:
              sale.SalesRepId != null ? staffIdByMindbodyId.get(sale.SalesRepId) ?? null : null,
            client_id: sale.ClientId,
            sale_datetime: sale.SaleDateTime,
            total_amount: totalAmount,
          },
          { onConflict: "organization_id,mindbody_sale_id" },
        );

        if (!error) {
          imported++;
        } else {
          console.error(error);
        }
      }

      offset += sales.length;
      if (sales.length === 0 || offset >= total) {
        break;
      }

      await delay(300);
    }

    return NextResponse.json({ success: true, imported, total });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
