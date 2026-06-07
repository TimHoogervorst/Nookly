import { NextRequest, NextResponse } from "next/server";
import { getHighlights, insertHighlight } from "@/lib/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const pdfId = searchParams.get("pdf_id");
    const page = searchParams.get("page");
    if (!pdfId) return NextResponse.json({ error: "pdf_id is required" }, { status: 400 });
    const pageNumber = page ? parseInt(page) : undefined;
    return NextResponse.json(getHighlights(parseInt(pdfId), pageNumber));
  } catch (error) {
    return NextResponse.json({ error: "Failed to get highlights" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { pdf_id, page_number, color, anchor_data } = body;
    if (!pdf_id || page_number == null || !anchor_data) {
      return NextResponse.json({ error: "pdf_id, page_number, and anchor_data are required" }, { status: 400 });
    }
    const h = insertHighlight(pdf_id, page_number, color || "#fef08a", anchor_data);
    return NextResponse.json(h, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create highlight" }, { status: 500 });
  }
}
