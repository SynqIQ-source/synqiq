import { NextResponse } from "next/server";
import { createMindbodyClient } from "@/lib/mindbody/client";

export async function GET() {
  const mindbodyClient = createMindbodyClient();
  const staff = await mindbodyClient.getStaff();

  return NextResponse.json(staff);
}
