import { NextRequest, NextResponse } from "next/server";
import { countUsers, createUser, createUserSession, seedAdminUser } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Try seeding from env vars first (safety net)
    seedAdminUser();

    // Only allow registration when no users exist
    if (countUsers() > 0) {
      return NextResponse.json({ error: "Registration is closed" }, { status: 403 });
    }

    const body = await request.json();
    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!username) {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const passwordHash = hashPassword(password);
    const user = createUser(username, passwordHash);
    const token = createUserSession(user.id);

    const response = NextResponse.json({ user: { id: user.id, username: user.username } });
    response.cookies.set("session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  } catch (error: any) {
    if (error?.code === "SQLITE_CONSTRAINT_UNIQUE" || error?.message?.includes("UNIQUE")) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to register" }, { status: 500 });
  }
}
