import { NextResponse } from "next/server";
import { countUsers, getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export async function GET(): Promise<NextResponse> {
  try {
    const userCount = countUsers();
    console.log(`[auth/status] userCount=${userCount}`);

    if (userCount === 0) {
      // No users yet — try to seed the admin from environment variables
      const username = process.env.ADMIN_USERNAME?.trim();
      const password = process.env.ADMIN_PASSWORD?.trim();

      if (username && password && password.length >= 6) {
        const db = getDb();
        const passwordHash = hashPassword(password);
        db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(
          username,
          passwordHash,
        );
        console.log("Admin user created from environment variables.");
        return NextResponse.json({
          needsSetup: false,
          adminCreated: true,
          adminUsername: username,
        });
      }

      // No env vars set — user must manually create the first account
      return NextResponse.json({ needsSetup: true, adminCreated: false });
    }

    // Users already exist — normal login
    return NextResponse.json({ needsSetup: false, adminCreated: false });
  } catch (error) {
    console.error("[auth/status] error:", error);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
