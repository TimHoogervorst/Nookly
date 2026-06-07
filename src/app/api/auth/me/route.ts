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
      return NextResponse.json({ user: null });
    }

    const user = getUserById(session.user_id);
    if (!user) {
      return NextResponse.json({ user: null });
    }

    return NextResponse.json({ user: { id: user.id, username: user.username } });
  } catch (error) {
    return NextResponse.json({ error: "Failed to get user" }, { status: 500 });
  }
}
