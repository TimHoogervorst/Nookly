import { NextRequest, NextResponse } from "next/server";
import { listSessions, createSession } from "@/lib/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    let targetType = searchParams.get("target_type");
    let targetId = searchParams.get("target_id");
    const pdfId = searchParams.get("pdf_id");

    if ((!targetType || !targetId) && pdfId) {
      targetType = "pdf";
      targetId = pdfId;
    }

    if (!targetType || !targetId) {
      return NextResponse.json(
        { error: "target_type and target_id are required (or pdf_id as fallback)" },
        { status: 400 }
      );
    }

    const sessions = listSessions(targetType, parseInt(targetId));
    return NextResponse.json(sessions);
  } catch (error) {
    return NextResponse.json({ error: "Failed to list sessions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    let { target_type, target_id, pdf_id, title } = body;

    if ((!target_type || target_id == null) && pdf_id !== undefined) {
      target_type = "pdf";
      target_id = pdf_id;
    }

    if (!target_type || target_id == null) {
      return NextResponse.json(
        { error: "target_type and target_id are required (or pdf_id as fallback)" },
        { status: 400 }
      );
    }

    const session = createSession(target_type, target_id, title);
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
