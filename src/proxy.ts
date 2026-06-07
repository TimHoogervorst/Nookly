import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const session = request.cookies.get("session")?.value;
  const { pathname } = request.nextUrl;

  console.log(`[proxy] ${pathname} — session: ${session ? "yes" : "none"}`);

  // Allow auth API routes and login page through
  if (pathname.startsWith("/api/auth/") || pathname === "/login") {
    // If already logged in and on login page, redirect to home
    if (pathname === "/login" && session) {
      console.log("[proxy] redirecting logged-in user from /login to /");
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // Protect everything else
  if (!session) {
    console.log(`[proxy] redirecting unauthenticated ${pathname} to /login`);
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png).*)"],
};
