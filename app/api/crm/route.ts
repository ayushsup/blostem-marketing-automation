import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const webhookUrl = process.env.CRM_WEBHOOK_URL;

    if (!webhookUrl) {
      return NextResponse.json({ error: "CRM_WEBHOOK_URL is missing" }, { status: 500 });
    }

    // Forward the Lead and Sequence data to the "CRM"
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "blostem_sequence_exported",
        timestamp: new Date().toISOString(),
        data: body,
      }),
    });

    if (!response.ok) throw new Error("Webhook failed");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Blostem CRM Error]:", error);
    return NextResponse.json({ error: "Failed to push to CRM" }, { status: 500 });
  }
}