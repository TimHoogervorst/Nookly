import { NextRequest, NextResponse } from "next/server";
import { getUserSession, getUserById, getUserByUsername, updateUserPassword } from "@/lib/users";
import { hashPassword, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = request.cookies.get("session")?.value;
    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = getUserSession(token);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const user = getUserById(session.user_id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const body = await request.json();
    const oldPassword = body.oldPassword || "";
    const newPassword = body.newPassword || "";

    if (newPassword.length < 6) {
      return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
    }

    // Verify old password
    const fullUser = getUserByUsername(user.username);
    if (!fullUser || !verifyPassword(oldPassword, fullUser.password_hash)) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const newHash = hashPassword(newPassword);
    updateUserPassword(user.id, newHash);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
