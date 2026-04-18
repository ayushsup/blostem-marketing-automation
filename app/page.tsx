"use client";

import { experimental_useObject as useObject } from '@ai-sdk/react';
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { z } from "zod";
import { leads as SEED_LEADS, Lead, LeadStatus } from "@/lib/data";
import styles from "./page.module.css";

/* ─── Zod Schema for Streaming ──────────────────────────────── */
// The frontend needs a permissive schema to parse the partial JSON stream
const StreamTouchSchema = z.object({
  subject: z.string().optional(),
  body: z.string().optional(),
  opener: z.string().optional(),
  script: z.string().optional(),
  objections: z.any().optional(), 
  timing: z.string().optional(),
  rationale: z.string().optional(),
});

const SequenceSchema = z.object({
  touch1: StreamTouchSchema.optional(),
  touch2: StreamTouchSchema.optional(),
  linkedin: StreamTouchSchema.optional(),
  call: StreamTouchSchema.optional(),
});

/* ─── Types ─────────────────────────────────────────────────── */

type TouchType = "touch1" | "touch2" | "linkedin" | "call";

type SequenceTouch = {
  subject?: string;
  body?: string;
  opener?: string;
  script?: string;
  objections?: any;
  timing?: string;
  rationale?: string;
};

type Sequence = Record<TouchType, SequenceTouch>;

type EditedContent = {
  touch1Subject: string;
  touch1Body:    string;
  touch2Subject: string;
  touch2Body:    string;
  linkedinBody:  string;
  callScript:    string;
};

type SentStatus = Record<TouchType, boolean>;

type SavedSequence = {
  id:       string;
  language: string;
  touch1:   SequenceTouch;
  touch2:   SequenceTouch;
  linkedin: SequenceTouch;
  call:     SequenceTouch;
  editedContent:     EditedContent;
  sentStatus:        SentStatus;
  complianceWarning: boolean;
};

type LeadWithDb = Lead & { savedSequence?: SavedSequence | null; notes?: string; isSeeded?: boolean; };
type NewLeadForm = {
  company:     string;
  contactName: string;
  role:        string;
  industry:    string;
  companySize: string;
  description: string;
};

type DetectedSignals = {
  intentSignal: string;
  painPoint:    string;
  bestTime?:    string;
  score:        number;
  status:       LeadStatus;
};

type CrmStep = "idle" | "validating" | "syncing" | "updating" | "done";

type Toast = { message: string; type: "success" | "error" | "sync" | "quota" } | null;

/* ─── Constants ─────────────────────────────────────────────── */

const TABS: { key: TouchType; label: string; icon: string; day: string }[] = [
  { key: "touch1",   label: "EMAIL 1",     icon: "✉",  day: "D1"  },
  { key: "touch2",   label: "EMAIL 2",     icon: "✉",  day: "D4"  },
  { key: "linkedin", label: "LINKEDIN",    icon: "💼", day: "D7"  },
  { key: "call",     label: "CALL SCRIPT", icon: "📞", day: "D10" },
];

const EMPTY_FORM: NewLeadForm = {
  company: "", contactName: "", role: "", industry: "", companySize: "", description: "",
};

const CRM_STEPS: { step: CrmStep; label: string; duration: number }[] = [
  { step: "validating", label: "Validating contact data…",    duration: 900  },
  { step: "syncing",    label: "Syncing outreach sequence…",  duration: 1100 },
  { step: "updating",   label: "Updating pipeline stage…",    duration: 800  },
  { step: "done",       label: "Sync complete!",              duration: 0    },
];

/* ─── Helpers ───────────────────────────────────────────────── */

function cls(...args: (string | boolean | undefined | null)[]) {
  return args.filter(Boolean).join(" ");
}

function getBadgeClass(status: LeadStatus) {
  const s = (status ?? "warm").toLowerCase();
  if (s === "hot")  return cls(styles.badge, styles.badgeHot);
  if (s === "warm") return cls(styles.badge, styles.badgeWarm);
  return cls(styles.badge, styles.badgeCold);
}

function getScoreColor(score: number) {
  if (score >= 85) return "#f43f5e";
  if (score >= 65) return "#f59e0b";
  return "#475569";
}

function getScoreRingGradient(score: number) {
  return `conic-gradient(${getScoreColor(score)} ${score * 3.6}deg, #162030 ${score * 3.6}deg)`;
}

function wordCount(text: string) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/* ─── Component ─────────────────────────────────────────────── */

export default function Dashboard() {
  const [leads, setLeads] = useState<LeadWithDb[]>(SEED_LEADS);
  const [selectedLead, setSelectedLead] = useState<LeadWithDb>(SEED_LEADS[0]);
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [editedContent, setEditedContent] = useState<EditedContent | null>(null);
  const [activeTab, setActiveTab] = useState<TouchType>("touch1");
  const [dbLoaded, setDbLoaded] = useState(false);

  const [regenTouch, setRegenTouch] = useState<TouchType | null>(null);
  const [isLoadingLeads, setIsLoadingLeads] = useState(true);

  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [filterStatus, setFilterStatus] = useState<"all" | LeadStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"score" | "alpha">("score");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [sentStatus, setSentStatus] = useState<Record<string, SentStatus>>({});
  const [notesByLead, setNotesByLead] = useState<Record<string, string>>({});
  const [showNotes, setShowNotes] = useState(false);
  const notesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [copySuccess, setCopySuccess] = useState<TouchType | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [complianceWarning, setComplianceWarning] = useState(false);
  const [languageMode, setLanguageMode] = useState<"english" | "hinglish">("english");
  const [toast, setToast] = useState<Toast>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState<NewLeadForm>(EMPTY_FORM);
  const [detectedSignals, setDetectedSignals] = useState<DetectedSignals | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);

  const [showCrmModal, setShowCrmModal] = useState(false);
  const [crmStep, setCrmStep] = useState<CrmStep>("idle");
  const [crmLeadName, setCrmLeadName] = useState("");

  /* ── Vercel AI SDK Streaming Hook ───────────────────────────── */
  const { object: streamedSequence, submit: generateStream, isLoading: isStreaming } = useObject({
    api: '/api/generate',
    schema: SequenceSchema,
    onFinish({ object, error }) {
      if (error) {
        showToast("Generation failed or quota exceeded.", "error");
        return;
      }
      if (object) {
        const seq = object as Sequence;
        setSequence(seq);
        
        // Populate the editable textareas now that streaming is complete
        const ec: EditedContent = {
          touch1Subject: seq.touch1?.subject ?? "",
          touch1Body:    seq.touch1?.body    ?? "",
          touch2Subject: seq.touch2?.subject ?? "",
          touch2Body:    seq.touch2?.body    ?? "",
          linkedinBody:  seq.linkedin?.body  ?? "",
          callScript:    seq.call?.script    ?? "",
        };
        setEditedContent(ec);
        setActiveTab("touch1");

        // Update local lead state so we remember it
        setLeads((prev) =>
          prev.map((l) =>
            l.id === selectedLead.id
              ? {
                  ...l,
                  savedSequence: {
                    id: "pending",
                    language: languageMode,
                    touch1:   seq.touch1,
                    touch2:   seq.touch2,
                    linkedin: seq.linkedin,
                    call:     seq.call,
                    editedContent: ec,
                    sentStatus: sentStatus[selectedLead.id] ?? { touch1: false, touch2: false, linkedin: false, call: false },
                    complianceWarning: false,
                  },
                }
              : l
          )
        );
      }
    }
  });

  /* ── Load leads from DB on mount ────────────────────────────── */
  useEffect(() => {
    async function loadLeads() {
      setIsLoadingLeads(true);
      try {
        await fetch("/api/seed");
        const res = await fetch("/api/leads");
        if (!res.ok) throw new Error("Failed to fetch leads");
        const data = await res.json();
        const dbLeads: LeadWithDb[] = data.leads;

        if (dbLeads.length > 0) {
          setLeads(dbLeads);
          setSelectedLead(dbLeads[0]);

          const newNotes: Record<string, string> = {};
          const newSent: Record<string, SentStatus> = {};
          dbLeads.forEach((lead) => {
            if (lead.notes) newNotes[lead.id] = lead.notes;
            if (lead.savedSequence?.sentStatus) newSent[lead.id] = lead.savedSequence.sentStatus;
          });
          setNotesByLead(newNotes);
          setSentStatus(newSent);
        }
        setDbLoaded(true);
      } catch (err) {
        console.error("Failed to load leads from DB:", err);
        setDbLoaded(true);
      } finally {
        setIsLoadingLeads(false);
      }
    }
    loadLeads();
  }, []);

  /* ── Restore saved sequence when switching leads ─────────────── */
  useEffect(() => {
    if (!dbLoaded) return;
    const saved = selectedLead?.savedSequence;
    if (saved) {
      const seq: Sequence = {
        touch1:   saved.touch1   as SequenceTouch,
        touch2:   saved.touch2   as SequenceTouch,
        linkedin: saved.linkedin as SequenceTouch,
        call:     saved.call     as SequenceTouch,
      };
      setSequence(seq);
      setEditedContent(saved.editedContent);
      setComplianceWarning(saved.complianceWarning ?? false);
      setActiveTab("touch1");
    } else {
      setSequence(null);
      setEditedContent(null);
      setComplianceWarning(false);
    }
  }, [selectedLead?.id, dbLoaded]);

  /* ── Derived ────────────────────────────────────────────────── */
  const filteredLeads = useMemo(() => {
    let list = filterStatus === "all" ? leads : leads.filter((l) => l.status === filterStatus);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (l) =>
          l.company.toLowerCase().includes(q) ||
          l.contactName.toLowerCase().includes(q) ||
          l.role.toLowerCase().includes(q)
      );
    }
    return sortMode === "score"
      ? [...list].sort((a, b) => b.score - a.score)
      : [...list].sort((a, b) => a.company.localeCompare(b.company));
  }, [leads, filterStatus, searchQuery, sortMode]);

  const currentSent: SentStatus = sentStatus[selectedLead?.id] ?? {
    touch1: false, touch2: false, linkedin: false, call: false,
  };
  const sentTouchCount = Object.values(currentSent).filter(Boolean).length;
  const allSent = sentTouchCount === 4;

  const hotCount  = leads.filter((l) => l.status === "hot").length;
  const warmCount = leads.filter((l) => l.status === "warm").length;
  const avgScore  = Math.round(leads.reduce((a, l) => a + l.score, 0) / Math.max(leads.length, 1));
  const currentNote = notesByLead[selectedLead?.id] ?? "";
  
  // Safe display sequence for the UI (prioritizes final sequence, falls back to live stream)
  const displaySeq = sequence || (streamedSequence as Sequence | undefined);

  /* ── Actions ────────────────────────────────────────────────── */
  /* ── Auto-Pilot Batch Generation ────────────────────────────── */
  const [isAutoPiloting, setIsAutoPiloting] = useState(false);

  async function runAutoPilot() {
    const hotLeads = leads.filter((l) => l.status === "hot" && !l.savedSequence);
    
    if (hotLeads.length === 0) {
      showToast("No fresh HOT leads available for Auto-Pilot.", "sync");
      return;
    }

    setIsAutoPiloting(true);
    showToast(`🚀 Auto-Pilot engaged: Processing ${hotLeads.length} leads sequentially...`, "sync", 4000);

    for (const lead of hotLeads) {
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead, action: "batch_generate", language: "english" }),
        });
        
        const data = await res.json();
        
        if (res.status === 429) {
          showToast(`Quota hit during Auto-Pilot. Pausing operations.`, "quota");
          startCountdown(data.retryAfterSeconds ?? 30);
          break;
        }

        if (data.sequence) {
          const seq = data.sequence as Sequence;
          const ec: EditedContent = {
            touch1Subject: seq.touch1?.subject ?? "", touch1Body: seq.touch1?.body ?? "",
            touch2Subject: seq.touch2?.subject ?? "", touch2Body: seq.touch2?.body ?? "",
            linkedinBody: seq.linkedin?.body ?? "", callScript: seq.call?.script ?? "",
          };

          // Update local state silently so UI badges update in real-time
          setLeads((prev) =>
            prev.map((l) =>
              l.id === lead.id
                ? {
                    ...l,
                    savedSequence: {
                      id: "auto", language: "english",
                      touch1: seq.touch1, touch2: seq.touch2, linkedin: seq.linkedin, call: seq.call,
                      editedContent: ec, sentStatus: { touch1: false, touch2: false, linkedin: false, call: false },
                      complianceWarning: data.complianceWarning ?? false,
                    },
                  }
                : l
            )
          );
        }
      } catch (err) {
        console.error(`Auto-Pilot failed for ${lead.company}`, err);
      }
    }
    setIsAutoPiloting(false);
    showToast("✓ Auto-Pilot complete. Pipeline updated.");
  }
  function startCountdown(seconds: number) {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setRetryCountdown(seconds);
    countdownRef.current = setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(countdownRef.current!);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function showToast(message: string, type: NonNullable<Toast>["type"] = "success", duration = 3200) {
    setToast({ message, type });
    if (duration > 0) setTimeout(() => setToast(null), duration);
  }

  const selectLead = useCallback((lead: LeadWithDb) => {
    setSelectedLead(lead);
    setActiveTab("touch1");
    setComplianceWarning(false);
    setShowNotes(false);
    setDeleteConfirmId(null);
  }, []);

  function handleFilterClick(status: "all" | LeadStatus) {
    setFilterStatus(status);
    const next = status === "all" ? leads : leads.filter((l) => l.status === status);
    if (next.length > 0 && !next.find((l) => l.id === selectedLead?.id)) selectLead(next[0]);
  }

  async function deleteLead(id: string) {
    const remaining = leads.filter((l) => l.id !== id);
    setLeads(remaining);
    setDeleteConfirmId(null);
    if (selectedLead.id === id && remaining.length > 0) selectLead(remaining[0]);
    showToast("Lead removed from pipeline.");
    try { await fetch(`/api/leads?id=${id}`, { method: "DELETE" }); } catch {}
  }

  /* ── Handle Streaming Generation ────────────────────────────── */
  const handleGenerate = () => {
    if (!selectedLead || retryCountdown !== null) return;
    setSequence(null);
    setEditedContent(null);
    setComplianceWarning(false);
    generateStream({ 
      lead: selectedLead, 
      action: "generate", 
      language: languageMode 
    });
  };

  /* ── Regenerate Single Touch (Fallback to traditional fetch) ── */
  async function regenerateTouch(tab: TouchType) {
    if (!selectedLead || !sequence || !editedContent || retryCountdown !== null) return;
    setRegenTouch(tab);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead: selectedLead, action: "regenerate_touch", touchType: tab, language: languageMode }),
      });
      const data = await res.json();
      if (res.status === 429) {
        startCountdown(data.retryAfterSeconds ?? 30);
        showToast(`Quota limit — retry in ${data.retryAfterSeconds ?? 30}s.`, "quota");
        return;
      }
      if (data.error) throw new Error(data.error);

      const newTouch: SequenceTouch = data.touch;
      setSequence((prev) => prev ? { ...prev, [tab]: newTouch } : prev);
      setEditedContent((prev) => {
        if (!prev) return prev;
        if (tab === "touch1")   return { ...prev, touch1Subject: newTouch.subject ?? "", touch1Body: newTouch.body ?? "" };
        if (tab === "touch2")   return { ...prev, touch2Subject: newTouch.subject ?? "", touch2Body: newTouch.body ?? "" };
        if (tab === "linkedin") return { ...prev, linkedinBody: newTouch.body ?? "" };
        if (tab === "call")     return { ...prev, callScript: newTouch.script ?? "" };
        return prev;
      });
      if (data.complianceWarning) setComplianceWarning(true);
      showToast("Touch regenerated.");
    } catch (err: unknown) {
      showToast(`Regeneration failed — ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    } finally {
      setRegenTouch(null);
    }
  }

  /* ── Sub-Actions ────────────────────────────────────────────── */
  function toggleSent(touch: TouchType) {
    if (!selectedLead) return;
    const updated = { ...currentSent, [touch]: !currentSent[touch] };
    setSentStatus((prev) => ({ ...prev, [selectedLead.id]: updated }));
    fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedLead.id, sentStatus: updated }) }).catch(() => {});
  }

  function markAllSent() {
    if (!selectedLead) return;
    const updated: SentStatus = { touch1: true, touch2: true, linkedin: true, call: true };
    setSentStatus((prev) => ({ ...prev, [selectedLead.id]: updated }));
    showToast("All touches marked as sent.");
    fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedLead.id, sentStatus: updated }) }).catch(() => {});
  }

  function resetSent() {
    if (!selectedLead) return;
    const updated: SentStatus = { touch1: false, touch2: false, linkedin: false, call: false };
    setSentStatus((prev) => ({ ...prev, [selectedLead.id]: updated }));
    fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedLead.id, sentStatus: updated }) }).catch(() => {});
  }

  function updateNotes(value: string) {
    setNotesByLead((prev) => ({ ...prev, [selectedLead.id]: value }));
    if (notesSaveTimer.current) clearTimeout(notesSaveTimer.current);
    notesSaveTimer.current = setTimeout(() => {
      fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedLead.id, notes: value }) }).catch(() => {});
    }, 1200);
  }

  function saveEditedContent(ec: EditedContent) {
    fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedLead.id, editedContent: ec }) }).catch(() => {});
  }

  function getCopyText(tab: TouchType): string {
    if (!editedContent) return "";
    if (tab === "touch1")   return `Subject: ${editedContent.touch1Subject}\n\n${editedContent.touch1Body}`;
    if (tab === "touch2")   return `Subject: ${editedContent.touch2Subject}\n\n${editedContent.touch2Body}`;
    if (tab === "linkedin") return editedContent.linkedinBody;
    return `Opening Line: "${sequence?.call?.opener ?? ""}"\n\n${editedContent.callScript}`;
  }

  function copyToClipboard(text: string, tab: TouchType) {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(tab);
      setTimeout(() => setCopySuccess(null), 2000);
    });
  }

  function buildSequenceText(): string {
    if (!editedContent || !sequence) return "";
    return [
      `═══ BLOSTEM OUTREACH SEQUENCE ═══`,
      `Target: ${selectedLead.contactName} — ${selectedLead.role} @ ${selectedLead.company}`,
      `Generated: ${new Date().toLocaleDateString("en-IN")}`,
      `Language: ${languageMode.toUpperCase()}`, ``,
      `──────────────────────────────────`, `TOUCH 1 — ${sequence.touch1.timing}`, `──────────────────────────────────`,
      `Subject: ${editedContent.touch1Subject}`, ``, editedContent.touch1Body, ``, `WHY: ${sequence.touch1.rationale}`, ``,
      `──────────────────────────────────`, `TOUCH 2 — ${sequence.touch2.timing}`, `──────────────────────────────────`,
      `Subject: ${editedContent.touch2Subject}`, ``, editedContent.touch2Body, ``, `WHY: ${sequence.touch2.rationale}`, ``,
      `──────────────────────────────────`, `LINKEDIN — ${sequence.linkedin.timing}`, `──────────────────────────────────`,
      editedContent.linkedinBody, ``, `WHY: ${sequence.linkedin.rationale}`, ``,
      `──────────────────────────────────`, `CALL SCRIPT — ${sequence.call.timing}`, `──────────────────────────────────`,
      `OPENING LINE: "${sequence.call.opener}"`, ``, editedContent.callScript, ``, `OBJECTION HANDLING:`,
      typeof sequence.call.objections === 'string' ? sequence.call.objections : JSON.stringify(sequence.call.objections), ``,
      currentNote ? `NOTES:\n${currentNote}\n` : "", `═══ END OF SEQUENCE ═══`,
    ].join("\n");
  }

  function downloadSequence() {
    if (!editedContent || !sequence) return;
    const blob = new Blob([buildSequenceText()], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `blostem-${selectedLead.company.replace(/\s+/g, "-").toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloadSuccess(true);
    showToast("Sequence downloaded as .txt file.");
    setTimeout(() => setDownloadSuccess(false), 2500);
  }

  async function pushToCRM() {
    if (!selectedLead) return;
    setCrmLeadName(selectedLead.company);
    setCrmStep("idle");
    setShowCrmModal(true);
    if (editedContent) saveEditedContent(editedContent);

    let delay = 0;
    for (const { step, duration } of CRM_STEPS) {
      await new Promise((res) => setTimeout(res, delay));
      setCrmStep(step);
      delay = duration;
    }
  }

  function closeCrmModal() {
    setShowCrmModal(false);
    setCrmStep("idle");
  }

  /* ── Add Lead Detection ──────────────────────────────────────── */
  async function detectSignals() {
    if (!newLeadForm.company || !newLeadForm.contactName || !newLeadForm.description) {
      showToast("Fill in Company, Contact Name, and Raw Intel.", "error");
      return;
    }
    setIsDetecting(true);
    setDetectedSignals(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead: newLeadForm, action: "detect_signals" }),
      });
      const data = await res.json();
      if (res.status === 429) {
        startCountdown(data.retryAfterSeconds ?? 30);
        showToast(`Quota limit — retry in ${data.retryAfterSeconds ?? 30}s.`, "quota");
        return;
      }
      if (data.error) throw new Error(data.error);
      setDetectedSignals(data as DetectedSignals);
    } catch (err: unknown) {
      showToast(`Signal detection failed — ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    } finally {
      setIsDetecting(false);
    }
  }

  async function confirmAddLead() {
    if (!detectedSignals) return;
    const newLead: LeadWithDb = {
      id:           `temp-${Date.now()}`,
      company:      newLeadForm.company,
      contactName:  newLeadForm.contactName,
      role:         newLeadForm.role || "Unknown",
      industry:     newLeadForm.industry || "Fintech",
      companySize:  newLeadForm.companySize || "Unknown",
      intentSignal: detectedSignals.intentSignal ?? "Signal detected",
      painPoint:    detectedSignals.painPoint ?? "General efficiency needs",
      status:       detectedSignals.status as LeadStatus,
      score:        detectedSignals.score ?? 70,
      lastActivity: "Just now",
      website:      `${newLeadForm.company.toLowerCase().replace(/\s+/g, "")}.com`,
      bestTime:     detectedSignals.bestTime,
      savedSequence: null,
    };

    setLeads((prev) => [newLead, ...prev]);
    setFilterStatus("all");
    selectLead(newLead);
    setShowAddModal(false);
    setNewLeadForm(EMPTY_FORM);
    setDetectedSignals(null);
    showToast(`${newLead.company} added to pipeline.`);

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newLead, id: undefined }),
      });
      const data = await res.json();
      if (data.lead?.id) {
        setLeads((prev) => prev.map((l) => (l.id === newLead.id ? { ...l, id: data.lead.id } : l)));
        setSelectedLead((prev) => prev.id === newLead.id ? { ...prev, id: data.lead.id } : prev);
      }
    } catch {}
  }

  function updateForm(field: keyof NewLeadForm, value: string) {
    setNewLeadForm((prev) => ({ ...prev, [field]: value }));
    if (detectedSignals) setDetectedSignals(null);
  }

  function closeAddModal() {
    setShowAddModal(false);
    setDetectedSignals(null);
    setNewLeadForm(EMPTY_FORM);
  }

  /* ─── Render ────────────────────────────────────────────────── */
  return (
    <div className={styles.container}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.logoRow}>
            <div className={styles.logoMark}>B</div>
            <div className={styles.logoTextGroup}>
              <div className={styles.logoName}>BLOSTEM</div>
              <div className={styles.logoSub}>SIGNAL INTELLIGENCE</div>
            </div>
            <div className={styles.liveIndicator}>
              <span className={isLoadingLeads ? styles.loadingDot : styles.liveDot} />
              {isLoadingLeads ? "SYNC" : "LIVE"}
            </div>
          </div>
        </div>

        <div className={styles.pipelineStats}>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{leads.length}</span>
            <span className={styles.statLabel}>TOTAL</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statItem}>
            <span className={cls(styles.statValue, styles.statValueHot)}>{hotCount}</span>
            <span className={styles.statLabel}>HOT</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statItem}>
            <span className={cls(styles.statValue, styles.statValueWarm)}>{warmCount}</span>
            <span className={styles.statLabel}>WARM</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statItem}>
            <span className={cls(styles.statValue, styles.statValueAccent)}>{avgScore}</span>
            <span className={styles.statLabel}>AVG SCR</span>
          </div>
        </div>

        <div className={styles.searchRow}>
          <span className={styles.searchIcon}>⌕</span>
          <input className={styles.searchInput} placeholder="Search leads…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          {searchQuery && <button type="button" className={styles.searchClear} onClick={() => setSearchQuery("")}>✕</button>}
        </div>

        <div className={styles.filterRow}>
          <div className={styles.filterTabs}>
            {(["all", "hot", "warm", "cold"] as const).map((f) => (
              <button key={f} type="button" onClick={() => handleFilterClick(f)} className={filterStatus === f ? styles.filterTabActive : styles.filterTab}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" className={styles.sortBtn} onClick={() => setSortMode((m) => m === "score" ? "alpha" : "score")} title={sortMode === "score" ? "Sort A–Z" : "Sort by score"}>
            {sortMode === "score" ? "↓ SCR" : "A–Z"}
          </button>
        </div>

        <div className={styles.leadList}>
          {isLoadingLeads ? (
            <div className={styles.noLeads}>Loading pipeline…</div>
          ) : filteredLeads.length === 0 ? (
            <div className={styles.noLeads}>{searchQuery ? `No results for "${searchQuery}"` : "No leads in this filter."}</div>
          ) : (
            filteredLeads.map((lead) => (
              <div key={lead.id} className={cls(styles.leadCard, selectedLead?.id === lead.id && styles.leadCardActive, deleteConfirmId === lead.id && styles.leadCardDeleting)}>
                {deleteConfirmId === lead.id ? (
                  <div className={styles.deleteConfirm}>
                    <span className={styles.deleteConfirmText}>Remove {lead.company}?</span>
                    <div className={styles.deleteConfirmBtns}>
                      <button type="button" className={styles.deleteConfirmYes} onClick={() => deleteLead(lead.id)}>DELETE</button>
                      <button type="button" className={styles.deleteConfirmNo} onClick={() => setDeleteConfirmId(null)}>CANCEL</button>
                    </div>
                  </div>
                ) : (
                  <div onClick={() => selectLead(lead)}>
                    <div className={styles.leadCardTop}>
                      <span className={styles.leadCompany}>{lead.company}</span>
                      <div className={styles.leadCardTopRight}>
                        <span className={getBadgeClass(lead.status)}>{lead.status.toUpperCase()}</span>
                        <button type="button" className={styles.deleteLeadBtn} onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(lead.id); }} title="Remove lead">✕</button>
                      </div>
                    </div>
                    <div className={styles.leadContact}>{lead.contactName} · {lead.role}</div>
                    <div className={styles.leadMeta}>
                      <div className={styles.scoreBar}><div className={styles.scoreBarFill} style={{ width: `${lead.score}%`, backgroundColor: getScoreColor(lead.score) }} /></div>
                      <span className={styles.scoreNum}>{lead.score}</span>
                      {lead.savedSequence && <span className={styles.savedDot} title="Sequence saved">●</span>}
                    </div>
                    <div className={styles.leadTiming}>{lead.lastActivity}</div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button 
            type="button" 
            onClick={runAutoPilot} 
            disabled={isAutoPiloting || retryCountdown !== null} 
            className={styles.addLeadBtn} 
            style={{ background: 'var(--accent)', color: '#000', fontWeight: 700 }}
          >
            {isAutoPiloting ? "⚙ PROCESSING PIPELINE..." : "🚀 RUN AUTO-PILOT"}
          </button>
          <button type="button" onClick={() => setShowAddModal(true)} className={styles.addLeadBtn}>
            + ADD LEAD
          </button>
        </div>
      </div>

      <div className={styles.main}>
        <div className={styles.leadHeader}>
          <div className={styles.leadHeaderLeft}>
            <div className={styles.leadIndustryTag}>{selectedLead.industry} · {selectedLead.companySize} employees</div>
            <h1 className={styles.leadTitle}>{selectedLead.company}</h1>
            <p className={styles.leadSubtitle}>{selectedLead.contactName} · {selectedLead.role}</p>
          </div>
          <div className={styles.scoreRing}>
            <div className={styles.scoreRingBg} style={{ background: getScoreRingGradient(selectedLead.score) }} />
            <div className={styles.scoreInner}>
              <span className={styles.scoreValue}>{selectedLead.score}</span>
              <span className={styles.scoreLabel}>SCORE</span>
            </div>
          </div>
        </div>

        <div className={styles.intelligencePanel}>
          <div className={styles.intelligenceHeader}>
            <span className={styles.intelligenceLabel}>BATTLE CARD & CLOSING INTEL</span>
            <span className={getBadgeClass(selectedLead.status)}>{selectedLead.status === "hot" ? "🔴 HIGH PRIORITY" : selectedLead.status === "warm" ? "🟡 ACTIVE SIGNAL" : "⚪ MONITOR"}</span>
          </div>
          <div className={styles.signalRow}><span className={styles.signalKey}>WHY NOW?</span><span className={styles.signalVal}>{selectedLead.intentSignal}</span></div>
          <div className={styles.signalRow}><span className={styles.signalKey}>HYPOTHESIS</span><span className={styles.signalVal}>{selectedLead.painPoint}</span></div>
          <div className={styles.signalRow}><span className={styles.signalKey}>BEST TIME</span><span className={cls(styles.signalVal, styles.signalValAccent)}>{selectedLead.bestTime ?? "Tuesday 2:30 PM — Optimal window"}</span></div>
        </div>

        <div className={styles.notesPanel}>
          <button type="button" className={styles.notesToggle} onClick={() => setShowNotes((v) => !v)}>
            <span className={styles.notesToggleLabel}>📝 NOTES</span>
            <span className={styles.notesToggleChevron}>{showNotes ? "▲" : "▼"}</span>
            {currentNote && <span className={styles.notesDot} />}
          </button>
          {showNotes && <textarea className={styles.notesTextarea} placeholder={`Add notes about ${selectedLead.contactName}…`} value={currentNote} onChange={(e) => updateNotes(e.target.value)} />}
        </div>

        {complianceWarning && (
          <div className={styles.complianceBanner}>
            <span className={styles.complianceBannerIcon}>⚠</span>
            <span className={styles.complianceBannerText}>Compliance filter applied — non-compliant language was auto-sanitized per RBI guidelines.</span>
            <button type="button" className={styles.complianceBannerClose} onClick={() => setComplianceWarning(false)}>✕</button>
          </div>
        )}

        {retryCountdown !== null && (
          <div className={styles.quotaBanner}>
            <span className={styles.quotaBannerIcon}>⏱</span>
            <span className={styles.quotaBannerText}>Gemini quota limit reached — auto-retry in <strong>{retryCountdown}s</strong>.</span>
          </div>
        )}

        <div className={styles.generateRow}>
          <button type="button" onClick={handleGenerate} disabled={isStreaming || !!regenTouch || retryCountdown !== null} className={styles.generateBtn}>
            {isStreaming ? <><span className={styles.spinner} />STREAMING AI OUTPUT…</> : retryCountdown !== null ? `⏱ RETRY IN ${retryCountdown}s` : "⚡ GENERATE OUTREACH SEQUENCE"}
          </button>
          <div className={styles.langToggle}>
            <button type="button" onClick={() => setLanguageMode("english")} className={cls(styles.langBtn, languageMode === "english" && styles.langBtnActive)}>ENGLISH</button>
            <button type="button" onClick={() => setLanguageMode("hinglish")} className={cls(styles.langBtn, languageMode === "hinglish" && styles.langBtnActive)}>HINGLISH</button>
          </div>
        </div>

        {displaySeq && (
          <div className={styles.sequenceArea}>
            <div className={styles.sequenceTimeline}>
              {TABS.map((tab, i) => (
                <div key={tab.key} className={styles.timelineStep}>
                  <div className={cls(styles.timelineNode, activeTab === tab.key && styles.timelineNodeActive, currentSent[tab.key] && styles.timelineNodeSent, regenTouch === tab.key && styles.timelineNodeRegen)} onClick={() => !regenTouch && setActiveTab(tab.key)}>
                    {regenTouch === tab.key ? <span className={styles.spinner} style={{ borderColor: "rgba(0,212,170,.3)", borderTopColor: "var(--accent)" }} /> : <span className={styles.timelineIcon}>{tab.icon}</span>}
                    <span className={styles.timelineDay}>{tab.day}</span>
                    <span className={styles.timelineLabel}>{tab.label}</span>
                    {currentSent[tab.key] && !regenTouch && <span className={styles.sentMark}>✓</span>}
                  </div>
                  {i < TABS.length - 1 && <div className={styles.timelineConnector} />}
                </div>
              ))}
              <div className={styles.timelineActions}>
                {!allSent ? <button type="button" className={styles.markAllBtn} onClick={markAllSent} title="Mark all sent">✓ ALL</button> : <button type="button" className={cls(styles.markAllBtn, styles.markAllBtnDone)} onClick={resetSent} title="Reset">↺ RESET</button>}
                <button type="button" className={downloadSuccess ? styles.exportBtnSuccess : styles.exportBtn} onClick={downloadSequence}>{downloadSuccess ? "✓ SAVED" : "↓ TXT"}</button>
              </div>
            </div>

            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <div className={styles.tabHeaderLeft}>
                  <span className={styles.tabChannelBadge}>{activeTab === "touch1" || activeTab === "touch2" ? "✉ EMAIL" : activeTab === "linkedin" ? "💼 LINKEDIN" : "📞 CALL SCRIPT"}</span>
                  <span className={styles.tabTiming}>{displaySeq?.[activeTab]?.timing}</span>
                  {sentTouchCount > 0 && <span className={styles.progressPill}>{sentTouchCount}/4 SENT</span>}
                </div>
                <div className={styles.tabHeaderActions}>
                  <button type="button" className={styles.regenBtn} onClick={() => regenerateTouch(activeTab)} disabled={!!regenTouch || isStreaming || retryCountdown !== null} title="Regenerate this touch">
                    {regenTouch === activeTab ? <><span className={styles.spinnerDark} />…</> : "↻ REGEN"}
                  </button>
                  <button type="button" className={copySuccess === activeTab ? styles.actionBtnCopied : styles.actionBtn} onClick={() => copyToClipboard(getCopyText(activeTab), activeTab)}>{copySuccess === activeTab ? "✓ COPIED" : "COPY"}</button>
                  <button type="button" className={currentSent[activeTab] ? styles.actionBtnSent : styles.actionBtn} onClick={() => toggleSent(activeTab)}>{currentSent[activeTab] ? "✓ SENT" : "MARK SENT"}</button>
                  <button type="button" onClick={pushToCRM} className={styles.actionBtnCrm}>PUSH TO CRM</button>
                </div>
              </div>

              <div className={styles.rationaleBar}>
                <span className={styles.rationaleLabel}>WHY</span>
                <span className={styles.rationaleText}>{displaySeq?.[activeTab]?.rationale}</span>
              </div>

              {activeTab === "touch1" && (
                <>
                  <div className={styles.subjectRow}>
                    <span className={styles.fieldLabel}>SUBJECT</span>
                    <input className={styles.subjectInput} readOnly={isStreaming} value={editedContent?.touch1Subject ?? displaySeq?.touch1?.subject ?? ""} onChange={(e) => editedContent && setEditedContent((p) => p ? { ...p, touch1Subject: e.target.value } : p)} onBlur={() => editedContent && saveEditedContent(editedContent)} />
                  </div>
                  <textarea className={styles.draftTextarea} readOnly={isStreaming} value={editedContent?.touch1Body ?? displaySeq?.touch1?.body ?? ""} onChange={(e) => editedContent && setEditedContent((p) => p ? { ...p, touch1Body: e.target.value } : p)} onBlur={() => editedContent && saveEditedContent(editedContent)} />
                  <div className={styles.wordCountRow}>
                    <span className={cls(styles.wordCount, wordCount(editedContent?.touch1Body ?? displaySeq?.touch1?.body ?? "") > 160 && styles.wordCountOver)}>{wordCount(editedContent?.touch1Body ?? displaySeq?.touch1?.body ?? "")} words</span>
                  </div>
                </>
              )}

              {activeTab === "touch2" && (
                <>
                  <div className={styles.subjectRow}>
                    <span className={styles.fieldLabel}>SUBJECT</span>
                    <input className={styles.subjectInput} readOnly={isStreaming} value={editedContent?.touch2Subject ?? displaySeq?.touch2?.subject ?? ""} onChange={(e) => editedContent && setEditedContent((p) => p ? { ...p, touch2Subject: e.target.value } : p)} onBlur={() => editedContent && saveEditedContent(editedContent)} />
                  </div>
                  <textarea className={styles.draftTextarea} readOnly={isStreaming} value={editedContent?.touch2Body ?? displaySeq?.touch2?.body ?? ""} onChange={(e) => editedContent && setEditedContent((p) => p ? { ...p, touch2Body: e.target.value } : p)} onBlur={() => editedContent && saveEditedContent(editedContent)} />
                  <div className={styles.wordCountRow}>
                    <span className={cls(styles.wordCount, wordCount(editedContent?.touch2Body ?? displaySeq?.touch2?.body ?? "") > 140 && styles.wordCountOver)}>{wordCount(editedContent?.touch2Body ?? displaySeq?.touch2?.body ?? "")} words</span>
                  </div>
                </>
              )}

              {activeTab === "linkedin" && (
                <>
                  <div className={styles.charCountRow}>
                    <span className={styles.fieldLabel}>CHARACTER COUNT</span>
                    <span className={cls(styles.charCount, (editedContent?.linkedinBody ?? displaySeq?.linkedin?.body ?? "").length > 300 && styles.charCountOver)}>
                      {(editedContent?.linkedinBody ?? displaySeq?.linkedin?.body ?? "").length} / 300
                    </span>
                  </div>
                  <textarea className={cls(styles.draftTextarea, styles.linkedinTextarea)} readOnly={isStreaming} value={editedContent?.linkedinBody ?? displaySeq?.linkedin?.body ?? ""} onChange={(e) => editedContent && setEditedContent((p) => p ? { ...p, linkedinBody: e.target.value } : p)} onBlur={() => editedContent && saveEditedContent(editedContent)} />
                </>
              )}

              {activeTab === "call" && (
                <>
                  <div className={cls(styles.callBlock, styles.callBlockAccent)}>
                    <span className={cls(styles.callBlockLabel, styles.callBlockLabelAccent)}>OPENING LINE</span>
                    <p className={styles.callOpenerText}>&ldquo;{displaySeq?.call?.opener}&rdquo;</p>
                  </div>
                  <div className={styles.subjectRow}><span className={styles.fieldLabel}>FULL SCRIPT</span></div>
                  <textarea className={styles.draftTextarea} readOnly={isStreaming} value={editedContent?.callScript ?? displaySeq?.call?.script ?? ""} onChange={(e) => editedContent && setEditedContent((p) => p ? { ...p, callScript: e.target.value } : p)} onBlur={() => editedContent && saveEditedContent(editedContent)} />
                  <div className={cls(styles.callBlock, styles.callBlockWarn)}>
                    <span className={cls(styles.callBlockLabel, styles.callBlockLabelWarn)}>OBJECTION HANDLING</span>
                    <div className={styles.objectionsText}>
                      {Array.isArray(displaySeq?.call?.objections) 
                        ? displaySeq.call.objections.map((o: any, idx: number) => <div key={idx}><strong>Q:</strong> {o.objection}<br/><strong>A:</strong> {o.response}<br/><br/></div>) 
                        : (displaySeq?.call?.objections ?? "")}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {!displaySeq && !isStreaming && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>⚡</div>
            <p className={styles.emptyText}>{selectedLead?.savedSequence ? "Sequence loaded from database." : `Generate a compliance-safe 4-touch sequence for ${selectedLead?.contactName} at ${selectedLead?.company}`}</p>
          </div>
        )}
      </div>

      {/* ══════════════ ADD LEAD MODAL ══════════════ */}
      {showAddModal && (
        <div className={styles.overlay} onClick={closeAddModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>ADD LEAD TO PIPELINE</span>
              <button type="button" className={styles.modalClose} onClick={closeAddModal}>✕</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}><label className={styles.formLabel}>COMPANY *</label><input className={styles.formInput} placeholder="e.g. NeoBank India" value={newLeadForm.company} onChange={(e) => updateForm("company", e.target.value)} /></div>
                <div className={styles.formGroup}><label className={styles.formLabel}>CONTACT NAME *</label><input className={styles.formInput} placeholder="e.g. Siddharth Rao" value={newLeadForm.contactName} onChange={(e) => updateForm("contactName", e.target.value)} /></div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}><label className={styles.formLabel}>ROLE</label><input className={styles.formInput} placeholder="e.g. CTO" value={newLeadForm.role} onChange={(e) => updateForm("role", e.target.value)} /></div>
                <div className={styles.formGroup}><label className={styles.formLabel}>INDUSTRY</label><input className={styles.formInput} placeholder="e.g. Lending Tech" value={newLeadForm.industry} onChange={(e) => updateForm("industry", e.target.value)} /></div>
              </div>
              <div className={styles.formGroup}><label className={styles.formLabel}>COMPANY SIZE</label><input className={styles.formInput} placeholder="e.g. 50–200 employees" value={newLeadForm.companySize} onChange={(e) => updateForm("companySize", e.target.value)} /></div>
              <div className={styles.formGroup}><label className={styles.formLabel}>RAW INTEL — paste a job posting, news article, or funding announcement *</label><textarea className={styles.formTextarea} rows={4} placeholder="e.g. NeoBank India raised ₹60Cr and is hiring a 'Banking API Architect'…" value={newLeadForm.description} onChange={(e) => updateForm("description", e.target.value)} /></div>

              {detectedSignals && (
                <div className={styles.detectedSignals}>
                  <div className={styles.detectedHeader}>
                    <span className={styles.detectedLabel}>AI-DETECTED SIGNALS</span>
                    <span className={getBadgeClass(detectedSignals.status)}>{(detectedSignals.status ?? "warm").toUpperCase()} · {detectedSignals.score ?? 70}/100</span>
                  </div>
                  <div className={styles.signalRow}><span className={styles.signalKey}>INTENT</span><span className={styles.signalVal}>{detectedSignals.intentSignal}</span></div>
                  <div className={styles.signalRow}><span className={styles.signalKey}>PAIN POINT</span><span className={styles.signalVal}>{detectedSignals.painPoint}</span></div>
                  {detectedSignals.bestTime && <div className={styles.signalRow}><span className={styles.signalKey}>BEST TIME</span><span className={cls(styles.signalVal, styles.signalValAccent)}>{detectedSignals.bestTime}</span></div>}
                </div>
              )}

              <div className={styles.modalActions}>
                {detectedSignals ? (
                  <><button type="button" className={styles.redetectBtn} onClick={() => setDetectedSignals(null)}>RE-DETECT</button><button type="button" onClick={confirmAddLead} className={styles.confirmAddBtn}>+ ADD TO PIPELINE</button></>
                ) : (
                  <button type="button" onClick={detectSignals} disabled={isDetecting || retryCountdown !== null || !newLeadForm.company || !newLeadForm.contactName || !newLeadForm.description} className={styles.detectBtn}>
                    {isDetecting ? "DETECTING SIGNALS…" : retryCountdown !== null ? `RETRY IN ${retryCountdown}s` : "⚡ DETECT SIGNALS WITH AI"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ CRM MODAL ══════════════ */}
      {showCrmModal && (
        <div className={styles.overlay} onClick={crmStep === "done" ? closeCrmModal : undefined}>
          <div className={cls(styles.modal, styles.crmModal)} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}><span className={styles.modalTitle}>PUSH TO CRM — {crmLeadName}</span>{crmStep === "done" && <button type="button" className={styles.modalClose} onClick={closeCrmModal}>✕</button>}</div>
            <div className={styles.crmModalBody}>
              {CRM_STEPS.map(({ step, label }) => {
                const order = ["validating", "syncing", "updating", "done"];
                const done   = order.indexOf(step) < order.indexOf(crmStep) || crmStep === "done";
                const active = step === crmStep;
                return (
                  <div key={step} className={cls(styles.crmStepRow, active && styles.crmStepActive, done && styles.crmStepDone)}>
                    <div className={cls(styles.crmStepIcon, active && styles.crmStepIconActive, done && styles.crmStepIconDone)}>{done ? "✓" : active ? <span className={styles.spinnerCrm} /> : "○"}</div>
                    <span className={styles.crmStepLabel}>{label}</span>
                  </div>
                );
              })}
              {crmStep === "done" && (
                <div className={styles.crmSuccess}>
                  <div className={styles.crmSuccessTitle}>Synced to Salesforce</div>
                  <div className={styles.crmSuccessDetails}><span>{sentTouchCount}/4 touches recorded</span><span>·</span><span>Stage: Active Outreach</span><span>·</span><span>Owner: Blostem Sales</span></div>
                  <button type="button" className={styles.crmDoneBtn} onClick={closeCrmModal}>DONE</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ TOAST ══════════════ */}
      {toast && (
        <div onClick={() => setToast(null)} className={cls(styles.toast, toast.type === "error" && styles.errorToast, toast.type === "sync" && styles.syncToast, toast.type === "quota" && styles.quotaToast)}>
          {toast.type === "success" ? "✓ " : toast.type === "sync" ? "↻ " : toast.type === "quota" ? "⏱ " : "✕ "}{toast.message}
        </div>
      )}
    </div>
  );
}