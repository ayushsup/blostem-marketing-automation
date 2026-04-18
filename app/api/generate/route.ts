import { NextResponse } from "next/server";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject, streamObject } from "ai"; 
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getPrisma } from "@/lib/prisma";
import {
  BLOSTEM_SYSTEM_PROMPT,
  SIGNAL_DETECTION_PROMPT,
  PERSONA_SPECIFIC_GUIDANCE,
} from "@/lib/prompts";

// ── 1. RATE LIMITING ─────────────────────────────────────────────────────────

const ratelimit = process.env.UPSTASH_REDIS_REST_URL
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(100000, "1 m"),
      analytics: true,
    })
  : null;

// Use the high-availability 2026 model lineup
const MODEL_CASCADE = [
  "gemini-2.5-flash"    // Secondary: Stable LTS model (Standard availability)
] as const;

function getGoogleClient(apiKey: string) {
  return createGoogleGenerativeAI({ apiKey });
}

type QuotaError = { retryAfterSeconds: number; model: string };

function parseRetryAfter(err: unknown): number {
  try {
    const msg = String((err as any)?.message ?? "");
    const match = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
    if (match) return Math.ceil(parseFloat(match[1]));
    const cause = (err as any)?.errors?.[0]?.responseBody;
    if (cause) {
      const parsed = JSON.parse(cause);
      const delay = parsed?.error?.details?.find(
        (d: any) => d["@type"]?.includes("RetryInfo")
      )?.retryDelay;
      if (delay) return Math.ceil(parseFloat(delay));
    }
  } catch {
    // ignore
  }
  return 30; // safe default
}

function isRetryableError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? "");
  const status = (err as any)?.statusCode;
  
  // Triggers fallback on both "Quota Full" (429) and "High Demand" (503)
  return (
    msg.includes("429") || 
    msg.includes("503") ||
    msg.includes("RESOURCE_EXHAUSTED") || 
    msg.includes("UNAVAILABLE") ||
    status === 429 || 
    status === 503
  );
}

async function generateWithCascade<T>(
  apiKey: string,
  buildArgs: (model: ReturnType<ReturnType<typeof getGoogleClient>>) => Parameters<typeof generateObject>[0]
): Promise<{ object: T; modelUsed: string }> {
  const client = getGoogleClient(apiKey);
  const errors: QuotaError[] = [];

  for (const modelId of MODEL_CASCADE) {
    const model = client(modelId);
    try {
      const args = buildArgs(model);
      
      // CRITICAL FIX: Force maxRetries to 0 so the SDK fails instantly 
      // instead of hanging for 30s, allowing our cascade to instantly swap models.
      const { object } = await generateObject({ 
        ...(args as any), 
        maxRetries: 0 
      });
      
      return { object: object as T, modelUsed: modelId };
    } catch (err) {
      if (isRetryableError(err)) {
        errors.push({ retryAfterSeconds: parseRetryAfter(err), model: modelId });
        console.warn(`[Blostem] Model ${modelId} unavailable/exhausted. Instant fallback triggered...`);
        continue;
      }
      throw err; // Non-quota errors bubble up
    }
  }

  // All models exhausted
  const maxRetry = Math.max(...errors.map((e) => e.retryAfterSeconds));
  throw Object.assign(new Error("ALL_QUOTA_EXCEEDED"), {
    retryAfterSeconds: maxRetry,
    code: "QUOTA_EXCEEDED",
  });
}

async function streamWithCascade(
  apiKey: string,
  buildArgs: (model: ReturnType<ReturnType<typeof getGoogleClient>>) => Parameters<typeof streamObject>[0]
) {
  const client = getGoogleClient(apiKey);
  const errors: QuotaError[] = [];

  for (const modelId of MODEL_CASCADE) {
    const model = client(modelId);
    try {
      const args = buildArgs(model);
      
      // streamObject will throw immediately if quota is hit, allowing the cascade to catch it
      const result = await streamObject({ 
        ...(args as any), 
        maxRetries: 0 
      });
      
      return { result, modelUsed: modelId };
    } catch (err) {
      if (isRetryableError(err)) {
        errors.push({ retryAfterSeconds: parseRetryAfter(err), model: modelId });
        console.warn(`[Blostem] Model ${modelId} unavailable for streaming. Instant fallback...`);
        continue;
      }
      throw err;
    }
  }

  const maxRetry = Math.max(...errors.map((e) => e.retryAfterSeconds));
  throw Object.assign(new Error("ALL_QUOTA_EXCEEDED"), {
    retryAfterSeconds: maxRetry,
    code: "QUOTA_EXCEEDED",
  });
}

// ── 3. ZOD SCHEMAS ───────────────────────────────────────────────────────────

const LeadSchema = z.object({
  id:           z.string().optional(),
  company:      z.string().min(1),
  contactName:  z.string().min(1),
  role:         z.string().optional().default("CEO"),
  industry:     z.string().optional().default("Fintech"),
  companySize:  z.string().optional().default("Unknown"),
  intentSignal: z.string().optional().default(""),
  painPoint:    z.string().optional().default(""),
  description:  z.string().optional().default(""),
  score:        z.number().optional(),
});

const RequestSchema = z.object({
  lead:      LeadSchema,
  action:    z.enum(["detect_signals", "generate", "regenerate_touch"]),
  language:  z.enum(["english", "hinglish"]).default("english"),
  touchType: z.enum(["touch1", "touch2", "linkedin", "call"]).optional(),
  // For saving sent status + edited content alongside sequence
  editedContent: z.object({
    touch1Subject: z.string(),
    touch1Body:    z.string(),
    touch2Subject: z.string(),
    touch2Body:    z.string(),
    linkedinBody:  z.string(),
    callScript:    z.string(),
  }).optional(),
  sentStatus: z.object({
    touch1:   z.boolean(),
    touch2:   z.boolean(),
    linkedin: z.boolean(),
    call:     z.boolean(),
  }).optional(),
});

// ── 4. AI OUTPUT SCHEMAS ─────────────────────────────────────────────────────

const SignalSchema = z.object({
  intentSignal: z.string(),
  painPoint:    z.string(),
  bestTime:     z.string().optional(),
  score:        z.number().int().min(0).max(100),
  status:       z.enum(["hot", "warm", "cold"]),
});

// Create STRICT schemas for each channel type (No .optional() allowed for core content)
const EmailTouchSchema = z.object({
  subject: z.string(),
  body: z.string(),
  timing: z.string(),
  rationale: z.string(),
});

const LinkedinTouchSchema = z.object({
  body: z.string(),
  timing: z.string(),
  rationale: z.string(),
});

const CallTouchSchema = z.object({
  opener: z.string(),
  script: z.string(),
  objections: z.array(z.object({
    objection: z.string(),
    response: z.string()
  })),
  timing: z.string(),
  rationale: z.string(),
});

// Force the sequence to use the exact channel schemas
const SequenceSchema = z.object({
  touch1:   EmailTouchSchema,
  touch2:   EmailTouchSchema,
  linkedin: LinkedinTouchSchema,
  call:     CallTouchSchema,
});

const SingleTouchSchemas: Record<string, z.ZodTypeAny> = {
  touch1:   EmailTouchSchema,
  touch2:   EmailTouchSchema,
  linkedin: LinkedinTouchSchema,
  call:     CallTouchSchema,
};

// ── 5. PERSONA HELPER ────────────────────────────────────────────────────────

function getPersonaGuidance(role: string): string {
  const r = (role || "CEO").toUpperCase();
  if (r.includes("CTO") || r.includes("TECH") || r.includes("ENG")) return PERSONA_SPECIFIC_GUIDANCE.CTO;
  if (r.includes("COMPLIANCE") || r.includes("CCO") || r.includes("LEGAL") || r.includes("RISK")) return PERSONA_SPECIFIC_GUIDANCE.CCO;
  if (r.includes("PRODUCT") || r.includes("CPO")) return PERSONA_SPECIFIC_GUIDANCE.CPO ?? PERSONA_SPECIFIC_GUIDANCE.CEO;
  if (r.includes("VP") || r.includes("BIZ") || r.includes("PARTNER")) return PERSONA_SPECIFIC_GUIDANCE.VP_BIZ_DEV ?? PERSONA_SPECIFIC_GUIDANCE.CEO;
  return PERSONA_SPECIFIC_GUIDANCE.CEO;
}

// ── 6. COMPLIANCE SANITIZER ──────────────────────────────────────────────────

function sanitize(obj: object): { result: object; warned: boolean } {
  const forbidden = ["guaranteed", "no risk", "risk-free", "risk free", "100% safe", "assured returns"];
  let json = JSON.stringify(obj);
  let warned = false;
  forbidden.forEach((w) => {
    const re = new RegExp(w, "gi");
    if (re.test(json)) { warned = true; json = json.replace(re, "bank-backed structured returns"); }
  });
  return { result: JSON.parse(json), warned };
}

// ── 7. ROUTE HANDLER ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const prisma = getPrisma(); // ✅ ADD THIS
  try {
    // Rate limiting
    if (ratelimit) {
      const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
      const { success, remaining } = await ratelimit.limit(ip);
      if (!success) {
        return NextResponse.json(
          { error: "Rate limit reached. Please wait 1 minute before retrying.", retryAfterSeconds: 60 },
          { status: 429 }
        );
      }
      console.log(`[Blostem] Rate limit remaining: ${remaining}`);
    }

    // API key check
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is missing in .env.local" }, { status: 500 });
    }

    // Input validation
    const raw = await req.json();
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request: " + parsed.error.issues.map((e: z.ZodIssue) => e.message).join(", ") },
        { status: 400 }
      );
    }

    const { lead, action, language, touchType, editedContent, sentStatus } = parsed.data;

    // ── DETECT SIGNALS ───────────────────────────────────────────
    if (action === "detect_signals") {
      try {
        const { object } = await generateWithCascade<z.infer<typeof SignalSchema>>(
          apiKey,
          (model) => ({
            model,
            schema: SignalSchema,
            prompt: SIGNAL_DETECTION_PROMPT(lead as any),
            temperature: 0.4,
          })
        );
        return NextResponse.json(object);
      } catch (err: any) {
        if (err?.code === "QUOTA_EXCEEDED") {
          return NextResponse.json(
            { error: `All Gemini models are quota-limited. Retry in ${err.retryAfterSeconds}s.`, retryAfterSeconds: err.retryAfterSeconds },
            { status: 429 }
          );
        }
        throw err;
      }
    }

    // ── REGENERATE SINGLE TOUCH ──────────────────────────────────
    if (action === "regenerate_touch") {
      if (!touchType) {
        return NextResponse.json({ error: "touchType is required for regenerate_touch" }, { status: 400 });
      }

      const schema = SingleTouchSchemas[touchType];
      const langNote =
        language === "hinglish" && (touchType === "linkedin" || touchType === "call")
          ? "Write this in natural, conversational B2B Hinglish (Hindi in English script)."
          : "Write in professional English.";

      const prompt = `
Regenerate ONLY the "${touchType}" touch for this lead. Be different from what was there before.
Company: ${lead.company} | Contact: ${lead.contactName} | Role: ${lead.role}
Signal: ${lead.intentSignal} | Pain: ${lead.painPoint}
Persona: ${getPersonaGuidance(lead.role ?? "CEO")}
${langNote}
Output ONLY the JSON for this touch.
      `.trim();

      try {
        const { object } = await generateWithCascade(apiKey, (model) => ({
          model,
          schema,
          system: BLOSTEM_SYSTEM_PROMPT,
          prompt,
          temperature: 0.4,
        }));

        const { result, warned } = sanitize(object as object);
        return NextResponse.json({ touch: result, touchType, complianceWarning: warned });
      } catch (err: any) {
        if (err?.code === "QUOTA_EXCEEDED") {
          return NextResponse.json(
            { error: `Quota exceeded. Retry in ${err.retryAfterSeconds}s.`, retryAfterSeconds: err.retryAfterSeconds },
            { status: 429 }
          );
        }
        throw err;
      }
    }

    // ── GENERATE FULL SEQUENCE (NOW STREAMING) ───────────────────
    if (action === "generate") {
      const langGuidance =
        language === "hinglish"
          ? "HINGLISH MODE: Emails 1 & 2 stay in English. LinkedIn and Call must be in natural B2B Hinglish."
          : "ENGLISH MODE: All 4 touches in professional English.";

      const userPrompt = `
Company: ${lead.company}
Contact: ${lead.contactName} (${lead.role})
Industry: ${lead.industry} | Size: ${lead.companySize}
Signal: ${lead.intentSignal}
Pain Point: ${lead.painPoint}
Score: ${lead.score ?? "N/A"}/100
Persona Guidance: ${getPersonaGuidance(lead.role ?? "CEO")}
${langGuidance}
Generate the complete 4-touch outreach sequence.`.trim();

      try {
        const { result, modelUsed } = await streamWithCascade(
          apiKey,
          (model) => ({
            model,
            schema: SequenceSchema,
            system: BLOSTEM_SYSTEM_PROMPT,
            prompt: userPrompt,
            temperature: 0.3,
            // DB Save happens securely in the background when the stream finishes!
            async onFinish({ object }) {
              if (!lead.id || !object) return;
              
              const { result: finalSequence, warned } = sanitize(object);
              const seq = finalSequence as z.infer<typeof SequenceSchema>;
              
              try {
                await prisma.sequence.upsert({
                  where:  { leadId: lead.id },
                  create: {
                    leadId:   lead.id,
                    language,
                    touch1:   seq.touch1   as any,
                    touch2:   seq.touch2   as any,
                    linkedin: seq.linkedin as any,
                    call:     seq.call     as any,
                    complianceWarning: warned,
                  },
                  update: {
                    language,
                    touch1:   seq.touch1   as any,
                    touch2:   seq.touch2   as any,
                    linkedin: seq.linkedin as any,
                    call:     seq.call     as any,
                    complianceWarning: warned,
                  },
                });
                console.log(`[Blostem] Stream finished. DB saved for Lead ${lead.id}`);
              } catch (dbErr) {
                console.error("[Blostem] DB save failed:", dbErr);
              }
            }
          })
        );
        
        // This pipes the live typing directly to your Next.js frontend
        return result.toTextStreamResponse();
        
      } catch (err: any) {
        if (err?.code === "QUOTA_EXCEEDED") {
          return NextResponse.json(
            { error: `Quota exceeded. Retry in ${err.retryAfterSeconds}s.`, retryAfterSeconds: err.retryAfterSeconds },
            { status: 429 }
          );
        }
        throw err;
      }
    }

  } catch (err) {
    console.error("[Blostem] Critical API error:", err);
    return NextResponse.json({ error: "Unexpected server error. Check server logs." }, { status: 500 });
  }
}