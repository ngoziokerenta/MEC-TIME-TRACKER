import { z } from 'zod';
import {catalogSchema} from './catalog';
import {billingProfileSchema} from './billing-profile';

const short = z.string().max(500);
const note = z.string().max(60000);
const id = z.string().min(1).max(100);
const date = z.string().refine(s => s === '' || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))), 'Use a valid date');

export const companySchema = z.object({
  id, name: short.min(1), offeringIds:z.array(id).max(1000).default([]),programme: short.default('Mindset Transformation Coaching Programme'),
  billingAddress: z.string().max(2000).default(''), vendorNumber: short.default(''),
  cohort: short.default(''), contactName: short.default(''), contactEmail: z.string().max(500).default(''),
  status: z.enum(['Active', 'Completed', 'Inactive']).default('Active'),
});

export const clientSchema = z.object({
  id, name: short.min(1), company: short.default(''), companyId: z.string().max(100).default(''),
  role: short, programme: short, startDate: date, endDate: date.default(''),
  plannedSessions: z.number().int().min(0).max(999).default(0),
  status: z.enum(['Active', 'Paused', 'Completed', 'Exited']), goals: note,
});

export const sessionSchema = z.object({
  id, clientId: id, number: z.number().int().min(1).max(999), date: date.refine(s => s !== ''),
  status: z.enum(['Completed', 'Scheduled', 'Missed']), focus: note, example: note, intervention: note,
  response: note, next: note, reflection: note, source: note, reportSummary: note, reportEvidence: note,
  reportNext: note, reviewed: z.boolean(), reportApproved: z.boolean(),
});

export const actionSchema = z.object({
  id, clientId: id, sessionId: z.string().max(100), title: short.min(1), dueDate: date,
  status: z.enum(['Open', 'Done']), type: z.enum(['Action', 'Assignment']),
  link: z.string().max(2000).refine(s => s === '' || /^https?:\/\//i.test(s), 'Use an http or https link'),
});

const reportSectionSchema = z.object({
  clientId: id, name: short, role: short, startDate: date.default(''), endDate: date.default(''),
  plannedSessions: z.number().int().min(0).max(999).default(0), sessionsCompleted: z.number().int().min(0).max(999).default(0),
  focus: note, progress: note, next: note,
});

export const reportSchema = z.object({
  id, month: z.string().regex(/^\d{4}-\d{2}$/), company: short, companyId: z.string().max(100).default(''),
  cohort: short.default(''), coachName: short.default('Ngozi Okerenta'), title: short, summary: note,
  updatedAt: short, sections: z.array(reportSectionSchema).max(1000),
});

export const workspaceSchema = z.object({
  offerings:catalogSchema.default([]),billingProfile:billingProfileSchema.nullable().default(null),
  companies: z.array(companySchema).max(1000).default([]), clients: z.array(clientSchema).max(1000),
  sessions: z.array(sessionSchema).max(10000), actions: z.array(actionSchema).max(10000),
  reports: z.array(reportSchema).max(1000),
}).superRefine((w, ctx) => {
  for (const key of ['companies', 'clients', 'sessions', 'actions', 'reports','offerings'] as const) {
    const ids = w[key].map(x => x.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ${key} IDs` });
  }
  const clients = new Set(w.clients.map(x => x.id));
  const companies = new Set(w.companies.map(x => x.id));
  const sessions = new Map(w.sessions.map(x => [x.id, x.clientId]));
  for (const c of w.clients) if (c.companyId && !companies.has(c.companyId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Coachee has no matching company' });
  for (const s of w.sessions) {
    if (!clients.has(s.clientId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Session has no matching coachee' });
    if (s.reportApproved && (!s.reviewed || s.status !== 'Completed' || !s.reportSummary.trim())) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Approve only reviewed completed sessions with a report summary' });
  }
  for (const a of w.actions) if (!clients.has(a.clientId) || (a.sessionId && sessions.get(a.sessionId) !== a.clientId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Action has no matching coachee or session' });
});

export type Company = z.infer<typeof companySchema>;
export type Client = z.infer<typeof clientSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Report = z.infer<typeof reportSchema>;
export type Data = z.infer<typeof workspaceSchema>;

export const sessionNotesImportSchema = z.object({
  format: z.literal('mec-session-notes-v1'),
  source: z.string().max(500).default('Imported notes'),
  sessions: z.array(z.object({
    coachee: z.string().min(1).max(500),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.string().min(1).max(60000),
  })).min(1).max(1000),
});
export type SessionNotesImport = z.infer<typeof sessionNotesImportSchema>;

export const emptyData = (): Data => ({ offerings:[],billingProfile:null,companies: [], clients: [], sessions: [], actions: [], reports: [] });
export function dateToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }

export function eligibleSessions(d: Data, month: string, companyId: string) {
  return d.sessions.filter(s => s.date.startsWith(month) && s.status === 'Completed' && s.reviewed && s.reportApproved && (!companyId || d.clients.find(c => c.id === s.clientId)?.companyId === companyId)).sort((a, b) => a.date.localeCompare(b.date));
}

export function makeReport(d: Data, month: string, companyId: string): Report {
  const company = d.companies.find(c => c.id === companyId);
  const sessions = eligibleSessions(d, month, companyId);
  const ids = [...new Set(sessions.map(s => s.clientId))];
  return {
    id: crypto.randomUUID(), month, companyId, company: company?.name || '', cohort: company?.cohort || '',
    coachName: 'Ngozi Okerenta', title: 'Monthly coaching report', summary: '', updatedAt: new Date().toISOString(),
    sections: ids.map(clientId => {
      const c = d.clients.find(x => x.id === clientId)!;
      const ss = sessions.filter(s => s.clientId === clientId);
      return {
        clientId, name: c.name, role: c.role, startDate: c.startDate, endDate: c.endDate,
        plannedSessions: c.plannedSessions, sessionsCompleted: d.sessions.filter(s => s.clientId === clientId && s.status === 'Completed').length,
        focus: ss.map(s => s.reportSummary.trim()).filter(Boolean).join('\n\n'),
        progress: ss.map(s => s.reportEvidence.trim()).filter(Boolean).join('\n\n'),
        next: ss.map(s => s.reportNext.trim()).filter(Boolean).join('\n\n'),
      };
    }),
  };
}

export function htmlEscape(s: string) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }

export function reportHTML(r: Report) {
  const e = htmlEscape;
  const paragraph = (s: string) => e(s || 'Not recorded.').replace(/\n/g, '<br>');
  const displayMonth = new Date(r.month + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const displayDate = (s: string) => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not set';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(r.title)}</title><style>
*{box-sizing:border-box}body{font-family:Georgia,serif;color:#221c2c;margin:0;line-height:1.6}h1,h2,h3,p{margin-top:0}.cover{min-height:245mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24mm;border-bottom:5px solid #a87dcc}.brand{color:#6d3b91;font:700 14px Arial,sans-serif;letter-spacing:.14em}.cover h1{font-size:34px;margin:20px 0 12px}.cover .meta{font-size:22px;color:#5d3978}.prepared{margin-top:36px}.prepared strong{display:block;color:#5d287f;font:700 18px Arial,sans-serif;margin:22px 0 6px}.prepared span{font-size:21px}.signature{width:360px;max-width:80%;margin-top:54px;border-bottom:1px solid #6d3b91;padding-bottom:9px}.signature-name{font-size:18px}.signature-title{font:14px Arial,sans-serif;color:#655b78}.page{page-break-before:always;padding:22mm;max-width:900px;margin:auto}.page h2{font-size:26px;color:#4e266d}.page h3{font:700 14px Arial,sans-serif;color:#4e266d;margin-top:24px}.profile{background:#f5eff9;border-left:4px solid #8b56ad;padding:14px 18px;margin:18px 0 28px}.profile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 24px;font:14px Arial,sans-serif}.muted{color:#655b78}@media print{@page{size:A4;margin:0}.page{padding:22mm}.cover{height:297mm}}
</style></head><body><section class="cover"><p class="brand">MANSFIELD EYRE CONSULTING</p><h1>${e(r.title)}</h1><p class="meta">Cohort: ${e(r.cohort || 'Not specified')}</p><p class="meta">Reporting Period: ${e(displayMonth)}</p><div class="prepared"><strong>Prepared for</strong><span>${e(r.company || 'Organisation')}</span><strong>Prepared by</strong><span>Mansfield Eyre Consulting Limited (MEC)</span></div><div class="signature"><div class="signature-name">${e(r.coachName || 'Ngozi Okerenta')}</div><div class="signature-title">Performance and Mindset Coach · Signature</div></div></section><section class="page"><h2>Executive summary</h2><p>${paragraph(r.summary)}</p></section>${r.sections.map(s => `<section class="page"><h2>${e(s.name)}</h2><p class="muted">${e(s.role)}</p><div class="profile"><div class="profile-grid"><span><strong>Start date:</strong> ${e(displayDate(s.startDate))}</span><span><strong>Expected end date:</strong> ${e(displayDate(s.endDate))}</span><span><strong>Sessions completed:</strong> ${s.sessionsCompleted}</span><span><strong>Planned sessions:</strong> ${s.plannedSessions || 'Not set'}</span></div></div><h3>Development focus</h3><p>${paragraph(s.focus)}</p><h3>Progress and supporting evidence</h3><p>${paragraph(s.progress)}</p><h3>Next coaching focus and support</h3><p>${paragraph(s.next)}</p></section>`).join('')}</body></html>`;
}
