import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { leads as SEED_LEADS } from "@/lib/data";

// GET /api/seed — seeds DB with demo leads if empty. Safe to call multiple times.
export async function GET() {
  const prisma = getPrisma();
  try {
    const count = await prisma.lead.count();
    if (count > 0) {
      return NextResponse.json({ message: `DB already has ${count} leads. No seeding needed.` });
    }

    await prisma.lead.createMany({
      data: SEED_LEADS.map((l) => ({
        id:           l.id,
        company:      l.company,
        contactName:  l.contactName,
        role:         l.role,
        industry:     l.industry,
        companySize:  l.companySize,
        intentSignal: l.intentSignal,
        painPoint:    l.painPoint,
        status:       l.status,
        score:        l.score,
        lastActivity: l.lastActivity,
        website:      l.website,
        bestTime:     l.bestTime ?? null,
        isSeeded:     true,
      })),
      skipDuplicates: true,
    });

    return NextResponse.json({ message: `Seeded ${SEED_LEADS.length} demo leads.` });
  } catch (err) {
    console.error("[Blostem] Seed error:", err);
    return NextResponse.json({ error: "Seeding failed." }, { status: 500 });
  }
}