import { NextRequest, NextResponse } from "next/server";
import { getComments, insertComment } from "@/lib/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const pdfId = searchParams.get("pdf_id");
    const page = searchParams.get("page");

    if (!pdfId) {
      return NextResponse.json({ error: "pdf_id is required" }, { status: 400 });
    }

    const pageNumber = page ? parseInt(page) : undefined;
    const comments = getComments(parseInt(pdfId), pageNumber);
    return NextResponse.json(comments);
  } catch (error) {
    return NextResponse.json({ error: "Failed to get comments" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { pdf_id, page_number, type, anchor_data, content } = body;

    if (!pdf_id || page_number == null || !type || !anchor_data || !content) {
      return NextResponse.json(
        { error: "pdf_id, page_number, type, anchor_data, and content are required" },
        { status: 400 }
      );
    }

    if (!["text_anchor", "position"].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "text_anchor" or "position"' },
        { status: 400 }
      );
    }

    const comment = insertComment(pdf_id, page_number, type, anchor_data, content);
    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
  }
}
