import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
// ── GET /api/leads — fetch all leads with their latest sequence ───────────────
export async function GET() {
  const prisma = getPrisma();
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      include: { Sequence: true }, // FIXED: Capital 'S' to match the schema
    });

    const shaped = leads.map((l: any) => ({
      id:           l.id,
      company:      l.company,
      contactName:  l.contactName,
      role:         l.role,
      industry:     l.industry,
      companySize:  l.companySize,
      intentSignal: l.intentSignal,
      painPoint:    l.painPoint,
      status:       l.status as "hot" | "warm" | "cold",
      score:        l.score,
      lastActivity: l.lastActivity || "Just now",
      website:      l.website || "",
      bestTime:     l.bestTime ?? undefined,
      notes:        l.notes ?? undefined,
      isSeeded:     l.isSeeded,
      savedSequence: l.Sequence
        ? {
            id:       l.Sequence.id,
            language: l.Sequence.language,
            touch1:   l.Sequence.touch1,
            touch2:   l.Sequence.touch2,
            linkedin: l.Sequence.linkedin,
            call:     l.Sequence.call,
            editedContent: {
              touch1Subject: l.Sequence.touch1Subject ?? "",
              touch1Body:    l.Sequence.touch1Body    ?? "",
              touch2Subject: l.Sequence.touch2Subject ?? "",
              touch2Body:    l.Sequence.touch2Body    ?? "",
              linkedinBody:  l.Sequence.linkedinBody  ?? "",
              callScript:    l.Sequence.callScript    ?? "",
            },
            sentStatus: {
              touch1:   l.Sequence.sentTouch1,
              touch2:   l.Sequence.sentTouch2,
              linkedin: l.Sequence.sentLinkedin,
              call:     l.Sequence.sentCall,
            },
            complianceWarning: l.Sequence.complianceWarning,
          }
        : null,
    }));

    return NextResponse.json({ leads: shaped });
  } catch (err) {
    console.error("[Blostem] GET /api/leads error:", err);
    return NextResponse.json({ error: "Failed to fetch leads." }, { status: 500 });
  }
}

// ── POST /api/leads — create a new lead ──────────────────────────────────────
const CreateLeadSchema = z.object({
  company:      z.string().min(1),
  contactName:  z.string().min(1),
  role:         z.string().default("Unknown"),
  industry:     z.string().default("Fintech"),
  companySize:  z.string().default("Unknown"),
  intentSignal: z.string(),
  painPoint:    z.string(),
  status:       z.enum(["hot", "warm", "cold"]),
  score:        z.number().int().min(0).max(100),
  website:      z.string().default(""),
  bestTime:     z.string().optional(),
});

export async function POST(req: Request) {
  const prisma = getPrisma(); // ✅ ADD
  try {
    const raw = await req.json();
    const parsed = CreateLeadSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid lead data: " + parsed.error.issues.map((e: z.ZodIssue) => e.message).join(", ") },
        { status: 400 }
      );
    }

    const lead = await prisma.lead.create({
      data: {
        ...parsed.data,
        lastActivity: "Just now",
        isSeeded: false,
      },
    });

    return NextResponse.json({ lead });
  } catch (err) {
    console.error("[Blostem] POST /api/leads error:", err);
    return NextResponse.json({ error: "Failed to create lead." }, { status: 500 });
  }
}

// ── PATCH /api/leads — update notes OR sent status for a lead ────────────────
const PatchSchema = z.object({
  id:    z.string(),
  notes: z.string().optional(),
  sentStatus: z.object({
    touch1:   z.boolean(),
    touch2:   z.boolean(),
    linkedin: z.boolean(),
    call:     z.boolean(),
  }).optional(),
  editedContent: z.object({
    touch1Subject: z.string(),
    touch1Body:    z.string(),
    touch2Subject: z.string(),
    touch2Body:    z.string(),
    linkedinBody:  z.string(),
    callScript:    z.string(),
  }).optional(),
});

export async function PATCH(req: Request) {
  const prisma = getPrisma(); // ✅ ADD  
  try {
    const raw = await req.json();
    const parsed = PatchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid patch data." }, { status: 400 });
    }

    const { id, notes, sentStatus, editedContent } = parsed.data;

    if (notes !== undefined) {
      await prisma.lead.update({ where: { id }, data: { notes } });
    }

    if (sentStatus || editedContent) {
      const sequenceExists = await prisma.sequence.findUnique({ where: { leadId: id } });
      if (sequenceExists) {
        await prisma.sequence.update({
          where: { leadId: id },
          data: {
            ...(sentStatus && {
              sentTouch1:   sentStatus.touch1,
              sentTouch2:   sentStatus.touch2,
              sentLinkedin: sentStatus.linkedin,
              sentCall:     sentStatus.call,
            }),
            ...(editedContent && {
              touch1Subject: editedContent.touch1Subject,
              touch1Body:    editedContent.touch1Body,
              touch2Subject: editedContent.touch2Subject,
              touch2Body:    editedContent.touch2Body,
              linkedinBody:  editedContent.linkedinBody,
              callScript:    editedContent.callScript,
            }),
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Blostem] PATCH /api/leads error:", err);
    return NextResponse.json({ error: "Failed to update lead." }, { status: 500 });
  }
}

// ── DELETE /api/leads?id=xxx — delete a lead and its sequence ─────────────────
export async function DELETE(req: Request) {
  const prisma = getPrisma(); // ✅ ADD  
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query param is required." }, { status: 400 });
    }

    await prisma.lead.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Blostem] DELETE /api/leads error:", err);
    return NextResponse.json({ error: "Failed to delete lead." }, { status: 500 });
  }
}