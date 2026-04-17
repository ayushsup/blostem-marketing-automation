export type LeadStatus = "hot" | "warm" | "cold";

export type Lead = {
  id: string;
  company: string;
  contactName: string;
  role: string;
  industry: string;
  companySize: string;
  intentSignal: string;
  painPoint: string;
  status: LeadStatus;
  score: number;
  lastActivity: string;
  website: string;
  bestTime?: string; // AI-predicted optimal outreach window
};

export const leads: Lead[] = [
  {
    id: "1",
    company: "StackFin",
    contactName: "Rahul Bose",
    role: "CEO",
    industry: "B2B Finance",
    companySize: "10–50",
    intentSignal:
      "Competitor MobiKwik publicly announced Blostem integration — FOMO signal detected in founder's recent tweet thread on embedded finance",
    painPoint:
      "Losing enterprise clients to competitors who offer embedded deposit products; needs to ship FDs in weeks not months",
    status: "hot",
    score: 95,
    lastActivity: "Today",
    website: "stackfin.in",
    bestTime: "Tuesday 9:30 AM — Founders review competitive intel at week-start, FOMO peaks early",
  },
  {
    id: "2",
    company: "LendFlow India",
    contactName: "Arjun Mehta",
    role: "CTO",
    industry: "Lending Tech",
    companySize: "50–200",
    intentSignal:
      "Posted JD for 'Wealth Tech Integration Engineer' on LinkedIn — signals active SDK evaluation phase underway",
    painPoint:
      "Slow API integrations with legacy banks creating 9–12 month go-to-market delays on every new product",
    status: "hot",
    score: 91,
    lastActivity: "2 days ago",
    website: "lendflow.in",
    bestTime: "Wednesday 2:00 PM — CTOs are post-standup and pre-evening planning; good window for a direct call",
  },
  {
    id: "3",
    company: "KreditKart",
    contactName: "Vikram Desai",
    role: "Chief Compliance Officer",
    industry: "Credit Tech",
    companySize: "100–300",
    intentSignal:
      "Fined by RBI last quarter for improper data handling — now overhauling entire vendor and infrastructure stack",
    painPoint:
      "Needs RBI-certified infrastructure with full audit trails; one more compliance failure puts licence at risk",
    status: "hot",
    score: 88,
    lastActivity: "1 day ago",
    website: "kreditkart.com",
    bestTime: "Thursday 11:00 AM — Compliance officers are most receptive mid-week before the Friday reporting rush",
  },
  {
    id: "4",
    company: "PayPulse",
    contactName: "Priya Sharma",
    role: "Head of Product",
    industry: "Payments",
    companySize: "200–500",
    intentSignal:
      "Announced strategic shift towards user retention and deposit products in Q2 public roadmap blog post",
    painPoint:
      "High user churn after first transaction; needs sticky financial products like FDs to convert transactors into savers",
    status: "warm",
    score: 74,
    lastActivity: "5 days ago",
    website: "paypulse.io",
    bestTime: "Tuesday 3:00 PM — Product leads typically have open calendar blocks post-sprint planning",
  },
  {
    id: "5",
    company: "WealthWise",
    contactName: "Neha Gupta",
    role: "VP Business Development",
    industry: "Wealth Management",
    companySize: "20–50",
    intentSignal:
      "Series A closed at ₹45Cr — actively hiring product and engineering for FY26 expansion into fixed-income",
    painPoint:
      "Needs to differentiate from mutual fund apps by offering FDs to HNI clients; no in-house banking infrastructure",
    status: "warm",
    score: 67,
    lastActivity: "1 week ago",
    website: "wealthwise.co.in",
    bestTime: "Friday 10:30 AM — Biz dev leads often do vendor evaluation calls before the weekend",
  },
];