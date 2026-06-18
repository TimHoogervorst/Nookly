import { NextRequest, NextResponse } from "next/server";
import { listTags, createTag } from "@/lib/tags";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(listTags());
  } catch (error) {
    return NextResponse.json({ error: "Failed to list tags" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const tag = createTag(body.name.trim(), body.color);
    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
}
