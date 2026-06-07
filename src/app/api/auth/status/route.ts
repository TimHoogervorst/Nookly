import { NextResponse } from "next/server";
import { countUsers } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
  try {
    const needsSetup = countUsers() === 0;
    return NextResponse.json({ needsSetup });
  } catch (error) {
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
