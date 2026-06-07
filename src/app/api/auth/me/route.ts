import { NextRequest, NextResponse } from "next/server";
import { getUserSession, getUserById } from "@/lib/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = request.cookies.get("session")?.value;
    if (!token) {
      return NextResponse.json({ user: null });
    }

    const session = getUserSession(token);
    if (!session) {
      // Stale cookie — session not in DB. Clear it so the proxy
      // doesn't keep thinking the user is authenticated.
      const response = NextResponse.json({ user: null });
      response.cookies.set("session", "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return response;
    }

    const user = getUserById(session.user_id);
    if (!user) {
      const response = NextResponse.json({ user: null });
      response.cookies.set("session", "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return response;
    }

    return NextResponse.json({ user: { id: user.id, username: user.username } });
  } catch (error) {
    return NextResponse.json({ error: "Failed to get user" }, { status: 500 });
  }
}
