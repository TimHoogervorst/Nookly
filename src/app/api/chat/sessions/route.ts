import { NextRequest, NextResponse } from "next/server";
import { listSessions, createSession } from "@/lib/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const pdfId = searchParams.get("pdf_id");

    if (!pdfId) {
      return NextResponse.json({ error: "pdf_id is required" }, { status: 400 });
    }

    const sessions = listSessions(parseInt(pdfId));
    return NextResponse.json(sessions);
  } catch (error) {
    return NextResponse.json({ error: "Failed to list sessions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { pdf_id, title } = body;

    if (!pdf_id) {
      return NextResponse.json({ error: "pdf_id is required" }, { status: 400 });
    }

    const session = createSession(pdf_id, title);
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
