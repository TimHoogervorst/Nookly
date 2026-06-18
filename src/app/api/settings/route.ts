import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/users";

const SENSITIVE_KEYS = ["api_key", "transcription_api_key"];

export async function GET(): Promise<NextResponse> {
  try {
    const settings = getAllSettings();
    // Mask sensitive values
    const masked = { ...settings };
    for (const key of SENSITIVE_KEYS) {
      if (masked[key]) {
        masked[key] = "••••" + masked[key].slice(-4);
      }
    }
    return NextResponse.json(masked);
  } catch (error) {
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") {
        setSetting(key, value);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
