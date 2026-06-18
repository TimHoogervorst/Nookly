import { NextRequest, NextResponse } from "next/server";
import { getMessages, deleteSession } from "@/lib/chat";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const messages = getMessages(parseInt(id));
    return NextResponse.json(messages);
  } catch (error) {
    return NextResponse.json({ error: "Failed to get messages" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    deleteSession(parseInt(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
