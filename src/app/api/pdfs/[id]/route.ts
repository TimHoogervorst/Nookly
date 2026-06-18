import { NextRequest, NextResponse } from "next/server";
import { getPdf, deletePdf, renamePdf } from "@/lib/pdfs";
import { deletePdfFile } from "@/lib/pdf";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const pdf = getPdf(parseInt(id));
    if (!pdf) {
      return NextResponse.json({ error: "PDF not found" }, { status: 404 });
    }
    return NextResponse.json(pdf);
  } catch (error) {
    return NextResponse.json({ error: "Failed to get PDF" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.name) {
      const pdf = renamePdf(parseInt(id), body.name.trim());
      if (!pdf) return NextResponse.json({ error: "PDF not found" }, { status: 404 });
      return NextResponse.json(pdf);
    }
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to rename PDF" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const pdf = getPdf(parseInt(id));
    if (!pdf) {
      return NextResponse.json({ error: "PDF not found" }, { status: 404 });
    }

    const filename = pdf.filename;
    deletePdf(parseInt(id));
    await deletePdfFile(filename);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete PDF" }, { status: 500 });
  }
}
