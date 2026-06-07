import { NextResponse } from "next/server";
import { countUsers, seedAdminUser } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
  try {
    // Try to seed the admin user from ADMIN_USERNAME / ADMIN_PASSWORD env vars.
    // This is a no-op if users already exist or env vars aren't set.
    seedAdminUser();

    const userCount = countUsers();
    const needsSetup = userCount === 0;

    return NextResponse.json({ needsSetup });
  } catch (error) {
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
