import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";

export async function PATCH(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json(
        { error: "Only an authenticated admin can update the trainer health benchmark." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const expectedRevenuePerSession: unknown = body?.expectedRevenuePerSession;

    if (
      typeof expectedRevenuePerSession !== "number" ||
      !Number.isFinite(expectedRevenuePerSession) ||
      expectedRevenuePerSession <= 0
    ) {
      return NextResponse.json(
        { error: "expectedRevenuePerSession must be a positive number." },
        { status: 400 },
      );
    }

    const supabase = await getScopedClient(currentStaff);

    const { data, error } = await supabase
      .from("organizations")
      .update({ expected_revenue_per_session: expectedRevenuePerSession })
      .eq("id", currentStaff.organizationId)
      .select("expected_revenue_per_session")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update the trainer health benchmark.");
    }

    return NextResponse.json({ success: true, expectedRevenuePerSession: data.expected_revenue_per_session });
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
