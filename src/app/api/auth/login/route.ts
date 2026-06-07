import { NextRequest, NextResponse } from "next/server";
import { getUserByUsername, createUserSession } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    const user = getUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = createUserSession(user.id);

    const response = NextResponse.json({ user: { id: user.id, username: user.username } });
    response.cookies.set("session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      secure: process.env.COOKIE_SECURE === "true",
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: "Failed to log in" }, { status: 500 });
  }
}
