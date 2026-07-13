import { NextResponse } from "next/server";
import { createMindbodyClient } from "@/lib/mindbody/client";

export async function GET() {
  const mindbodyClient = createMindbodyClient();
  const classes = await mindbodyClient.getClasses();

  return NextResponse.json(classes);
}
