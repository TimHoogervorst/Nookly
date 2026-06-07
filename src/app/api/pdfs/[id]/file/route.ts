import { NextRequest, NextResponse } from "next/server";
import { getPdf } from "@/lib/db";
import { getPdfFilePath } from "@/lib/pdf";
import fs from "fs/promises";

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

    const filePath = getPdfFilePath(pdf.filename);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      return NextResponse.json({ error: "PDF file not found on disk" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdf.original_name}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to serve PDF" }, { status: 500 });
  }
}
