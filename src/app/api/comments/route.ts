import { NextRequest, NextResponse } from "next/server";
import { getComments, insertComment } from "@/lib/annotations";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    let targetType = searchParams.get("target_type");
    let targetId = searchParams.get("target_id");
    const pdfId = searchParams.get("pdf_id");
    const page = searchParams.get("page");

    // Fallback: pdf_id → target_type='pdf'
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

    const pageNumber = page ? parseInt(page) : undefined;
    const comments = getComments(targetType, parseInt(targetId), pageNumber);
    return NextResponse.json(comments);
  } catch (error) {
    return NextResponse.json({ error: "Failed to get comments" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    let { target_type, target_id, pdf_id, page_number, type, anchor_data, content, start_word, end_word } = body;

    // Fallback: pdf_id → target_type='pdf'
    if ((!target_type || target_id == null) && pdf_id !== undefined) {
      target_type = "pdf";
      target_id = pdf_id;
    }

    if (!target_type || target_id == null || page_number == null || !type || !anchor_data || !content) {
      return NextResponse.json(
        { error: "target_type, target_id, page_number, type, anchor_data, and content are required" },
        { status: 400 }
      );
    }

    if (!["text_anchor", "position"].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "text_anchor" or "position"' },
        { status: 400 }
      );
    }

    const comment = insertComment(target_type, target_id, page_number, type, anchor_data, content, { startWord: start_word, endWord: end_word });
    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
  }
}
