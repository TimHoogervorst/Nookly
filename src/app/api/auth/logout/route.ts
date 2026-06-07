import { NextRequest, NextResponse } from "next/server";
import { deleteUserSession } from "@/lib/db";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = request.cookies.get("session")?.value;
    if (token) {
      deleteUserSession(token);
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set("session", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0, // delete cookie
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: "Failed to log out" }, { status: 500 });
  }
}
