import { NextRequest, NextResponse } from "next/server";
import { getHighlights, insertHighlight, insertHighlightWithWords } from "@/lib/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    let targetType = searchParams.get("target_type");
    let targetId = searchParams.get("target_id");
    const pdfId = searchParams.get("pdf_id");
    const page = searchParams.get("page");

    if ((!targetType || !targetId) && pdfId) {
      targetType = "pdf";
      targetId = pdfId;
    }
    if (!targetType || !targetId)
      return NextResponse.json(
        { error: "target_type and target_id are required (or pdf_id as fallback)" },
        { status: 400 }
      );

    const pageNumber = page ? parseInt(page) : undefined;
    return NextResponse.json(getHighlights(targetType, parseInt(targetId), pageNumber));
  } catch (error) {
    return NextResponse.json({ error: "Failed to get highlights" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    let { target_type, target_id, pdf_id, page_number, color, anchor_data, start_word, end_word } = body;

    if ((!target_type || target_id == null) && pdf_id !== undefined) {
      target_type = "pdf";
      target_id = pdf_id;
    }
    if (!target_type || target_id == null || page_number == null || !anchor_data) {
      return NextResponse.json(
        { error: "target_type, target_id, page_number, and anchor_data are required" },
        { status: 400 }
      );
    }
    const h =
      start_word !== undefined
        ? insertHighlightWithWords(target_type, target_id, page_number, color || "#fef08a", anchor_data, start_word, end_word)
        : insertHighlight(target_type, target_id, page_number, color || "#fef08a", anchor_data);
    return NextResponse.json(h, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create highlight" }, { status: 500 });
  }
}
