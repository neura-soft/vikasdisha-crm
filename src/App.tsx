import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { FirebaseError } from 'firebase/app';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, deleteField, doc, getDoc, getDocs, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { demoData } from './demo-data';
import { firebaseAuth, firestore, functions, isFirebaseConfigured } from './firebase';
import type { Application, ApplicationStage, Company, CrmData, EmployerVerificationRequest, Job, Payment, Person, Role } from './types';

const stages: ApplicationStage[] = ['Applied', 'Under Review', 'Shortlisted', 'Interview Scheduled', 'Interview Completed', 'Selected', 'Rejected', 'Hired'];
const navItems = [
  ['/', 'Overview', '⌂'], ['/people', 'People', '◉'], ['/employers', 'Employer plans', '▤'], ['/seekers', 'Job seeker plans', '○'], ['/jobs', 'Jobs', '▣'], ['/pipeline', 'Pipeline', '↗'], ['/outreach', 'Outreach', '✉'], ['/revenue', 'Revenue', '₹'], ['/settings', 'Settings', '⚙'],
] as const;

const emptyData: CrmData = { people: [], jobs: [], applications: [], payments: [], companies: [], verificationRequests: [] };
type ManagedPlan = 'none' | 'employee_199' | 'employee_299' | 'employer_free' | 'employer_599' | 'employer_999';

const PLAN_DETAILS: Record<ManagedPlan, { name: string; status: 'active' | 'inactive' | 'free'; role: 'job-seeker' | 'recruiter' }> = {
  none: { name: 'No active plan', status: 'inactive', role: 'job-seeker' },
  employee_199: { name: 'Career Plus', status: 'active', role: 'job-seeker' },
  employee_299: { name: 'Career Pro', status: 'active', role: 'job-seeker' },
  employer_free: { name: 'Employer Free', status: 'free', role: 'recruiter' },
  employer_599: { name: 'Employer Priority 5', status: 'active', role: 'recruiter' },
  employer_999: { name: 'Employer Priority 10', status: 'active', role: 'recruiter' },
};

function loginErrorMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
      return 'The email address or password is incorrect.';
    }
    if (error.code === 'auth/too-many-requests') return 'Too many unsuccessful attempts. Please wait a few minutes and try again.';
    if (error.code === 'auth/network-request-failed') return 'Unable to reach Firebase. Check your internet connection and try again.';
    if (error.code === 'permission-denied') return 'This account is not authorised to use the CRM.';
  }
  return 'Unable to sign in. Please try again.';
}

function dateValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return undefined;
}

function formatMoney(amount: number) { return `₹${amount.toLocaleString('en-IN')}`; }
function initials(name?: unknown) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) return '??';
  return value.split(/\s+/).map((word) => word[0] ?? '').join('').slice(0, 2).toUpperCase() || '??';
}

function textValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function roleValue(value: unknown): Role {
  return value === 'recruiter' || value === 'admin' || value === 'job-seeker' ? value : 'job-seeker';
}

function normalizePerson(id: string, raw: Record<string, unknown>): Person {
  const email = textValue(raw.email, textValue(raw.contactEmail, 'No email'));
  const displayName = textValue(raw.displayName, textValue(raw.name, textValue(raw.fullName, textValue(raw.companyName, email.split('@')[0] || 'Unnamed account'))));
  const accountStatus = raw.accountStatus === 'blocked' ? 'blocked' : 'active';
  const plan = textValue(raw.plan, raw.role === 'recruiter' ? 'employer_free' : 'none');
  return {
    id,
    displayName,
    email,
    role: roleValue(raw.role),
    phone: textValue(raw.phone, textValue(raw.phoneNumber, textValue(raw.mobile, ''))),
    companyName: textValue(raw.companyName, ''),
    companyId: textValue(raw.companyId, ''),
    location: textValue(raw.location, ''),
    industry: textValue(raw.industry, ''),
    headline: textValue(raw.headline, textValue(raw.currentRole, '')),
    skills: Array.isArray(raw.skills) ? raw.skills.filter((item): item is string => typeof item === 'string') : undefined,
    profileCompleted: raw.profileCompleted === true,
    profileCompletionPercentage: numberValue(raw.profileCompletionPercentage),
    plan,
    subscriptionName: textValue(raw.subscriptionName, ''),
    subscriptionStatus: textValue(raw.subscriptionStatus, raw.role === 'recruiter' ? 'free' : 'inactive'),
    subscriptionExpiresAt: dateValue(raw.subscriptionExpiresAt),
    lastLoginAt: dateValue(raw.lastLoginAt),
    totalJobsPosted: numberValue(raw.totalJobsPosted),
    activeJobs: numberValue(raw.activeJobs),
    availableJobCredits: numberValue(raw.availableJobCredits),
    companyVerificationStatus: textValue(raw.companyVerificationStatus, textValue(raw.verificationStatus, '')),
    verificationReason: textValue(raw.verificationReason, ''),
    accountStatus,
    blockReason: textValue(raw.blockReason, ''),
    createdAt: dateValue(raw.createdAt),
  };
}

function normalizeCompany(id: string, raw: Record<string, unknown>): Company {
  return {
    id,
    ...raw,
    companyName: textValue(raw.companyName, textValue(raw.name, 'Unnamed company')),
    ownerId: textValue(raw.ownerId, ''),
    registrationType: raw.registrationType as Company['registrationType'],
    registrationNumber: textValue(raw.registrationNumber, ''),
    otherRegistrationName: textValue(raw.otherRegistrationName, ''),
    governmentIdType: raw.governmentIdType as Company['governmentIdType'],
    governmentIdNumber: textValue(raw.governmentIdNumber, ''),
    // A saved company profile is not automatically a verification submission.
    // Keep this blank until a request is submitted or an admin sets a review
    // status, otherwise the CRM would incorrectly list every employer as
    // pending verification.
    verificationStatus: textValue(raw.verificationStatus, ''),
    verificationReason: textValue(raw.verificationReason, ''),
    verificationSubmittedAt: dateValue(raw.verificationSubmittedAt),
    verifiedAt: dateValue(raw.verifiedAt),
    updatedAt: dateValue(raw.updatedAt),
  };
}

function Metric({ label, value, note, accent = false }: { label: string; value: string | number; note: string; accent?: boolean }) {
  return <article className={`metric ${accent ? 'metric-accent' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function Badge({ children, type = 'neutral' }: { children: React.ReactNode; type?: 'success' | 'warning' | 'danger' | 'accent' | 'neutral' }) {
  return <span className={`badge badge-${type}`}>{children}</span>;
}

function useCrm() {
  const [data, setData] = useState<CrmData>(isFirebaseConfigured ? emptyData : demoData);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [error, setError] = useState('');

  const reload = async () => {
    if (!firestore) { setData(demoData); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [people, jobs, applications, payments, companies, verificationRequests] = await Promise.all([
        getDocs(collection(firestore, 'users')),
        getDocs(collection(firestore, 'jobs')),
        getDocs(collection(firestore, 'applications')),
        getDocs(collection(firestore, 'paymentOrders')),
        getDocs(collection(firestore, 'companies')),
        getDocs(collection(firestore, 'employerVerificationRequests')),
      ]);
      setData({
        people: people.docs.map((item) => normalizePerson(item.id, item.data())),
        jobs: jobs.docs.map((item) => ({ id: item.id, ...item.data(), createdAt: dateValue(item.data().createdAt) } as Job)),
        applications: applications.docs.map((item) => ({ id: item.id, ...item.data(), appliedOn: dateValue(item.data().appliedOn) ?? item.data().appliedOn } as Application)),
        payments: payments.docs.map((item) => ({ id: item.id, ...item.data(), createdAt: dateValue(item.data().createdAt) } as Payment)),
        companies: companies.docs.map((item) => normalizeCompany(item.id, item.data())),
        verificationRequests: verificationRequests.docs.map((item) => ({ id: item.id, ...item.data(), submittedAt: dateValue(item.data().submittedAt), updatedAt: dateValue(item.data().updatedAt) } as EmployerVerificationRequest)),
      });
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load CRM data.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, []);

  const updateStage = async (id: string, status: ApplicationStage) => {
    const backendStatus = status === 'In Review' ? 'Under Review' : status === 'Offer Sent' ? 'Selected' : status;
    if (firestore) {
      await httpsCallable<{ applicationId: string; status: string }, { updated: boolean }>(functions, 'updateApplicationStatus')({ applicationId: id, status: backendStatus });
    }
    setData((previous) => ({ ...previous, applications: previous.applications.map((item) => item.id === id ? { ...item, status } : item) }));
  };
  const changePlan = async (person: Person, planKey: ManagedPlan) => {
    if (!firestore) return;
    const plan = PLAN_DETAILS[planKey];
    if (plan.role !== person.role) throw new Error('This plan is not available for this account type.');
    if (person.role === 'recruiter' && plan.status === 'active') {
      const company = data.companies.find((item) => item.ownerId === person.id);
      if (!company || company.verificationStatus !== 'Verified') {
        throw new Error('Verify the employer company and registration document before granting a paid plan.');
      }
    }
    const isPaidPlan = plan.status === 'active';
    await updateDoc(doc(firestore, 'users', person.id), {
      plan: planKey,
      subscriptionName: plan.name,
      subscriptionStatus: plan.status,
      subscriptionRole: plan.role,
      subscribedAt: isPaidPlan ? serverTimestamp() : deleteField(),
      subscriptionExpiresAt: isPaidPlan ? Timestamp.fromDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)) : deleteField(),
      updatedAt: serverTimestamp(),
    });
    await reload();
  };
  const removeUser = async (person: Person) => {
    if (!firestore) return;
    await httpsCallable<{ userId: string }, { deleted: boolean }>(functions, 'adminDeleteUser')({ userId: person.id });
    await reload();
  };
  const removeJob = async (job: Job) => {
    if (!firestore) return;
    await httpsCallable<{ jobId: string }, { deleted: boolean }>(functions, 'adminDeleteJob')({ jobId: job.id });
    await reload();
  };
  const setUserBlockStatus = async (person: Person, blocked: boolean, reason = '') => {
    if (!firestore) return;
    await httpsCallable<{ userId: string; blocked: boolean; reason: string }, { blocked: boolean }>(functions, 'adminSetUserBlockStatus')({ userId: person.id, blocked, reason });
    await reload();
  };
  const setJobBlockStatus = async (job: Job, blocked: boolean, reason = '') => {
    if (!firestore) return;
    await httpsCallable<{ jobId: string; blocked: boolean; reason: string }, { blocked: boolean }>(functions, 'adminSetJobBlockStatus')({ jobId: job.id, blocked, reason });
    await reload();
  };
  const setCompanyVerificationStatus = async (company: Company, status: string, reason = '') => {
    if (!firestore) return;
    await httpsCallable<{ companyId: string; status: string; reason: string }, { status: string }>(functions, 'adminSetCompanyVerificationStatus')({ companyId: company.id, status, reason });
    await reload();
  };
  const sendInAppNotification = async (person: Person, title: string, message: string) => {
    if (!firestore) return;
    await httpsCallable<{ recipientId: string; title: string; message: string }, { id: string; delivered: boolean }>(functions, 'adminSendInAppNotification')({
      recipientId: person.id,
      title,
      message,
    });
  };
  return { data, loading, error, reload, updateStage, changePlan, removeUser, removeJob, setUserBlockStatus, setJobBlockStatus, setCompanyVerificationStatus, sendInAppNotification };
}

const brandLogo = '/vikasdisha-logo.png';

function Login({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!firebaseAuth) return onDemo();
    setSubmitting(true); setError('');
    try {
      const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      if (!firestore) throw new Error('Firebase is not configured.');
      const profile = await getDoc(doc(firestore, 'users', credential.user.uid));
      if (profile.data()?.role !== 'admin') {
        await signOut(firebaseAuth);
        setError('This account is signed in, but it is not a CRM administrator. Set role: "admin" in its Firestore users document.');
        return;
      }
      navigate('/');
    }
    catch (loginError: unknown) { setError(loginErrorMessage(loginError)); }
    finally { setSubmitting(false); }
  };
  return <main className="login-shell"><section className="login-brand"><img className="login-logo" src={brandLogo} alt="VikasDisha" /><p>VikasDisha</p><h1>Hiring operations, clearly organised.</h1><span>CRM workspace for platform administrators.</span></section><form className="login-card" onSubmit={login}><p className="kicker">Administrator access</p><h2>Welcome back</h2><p>Sign in to manage people, jobs, pipeline and subscription health.</p>{isFirebaseConfigured ? <><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error ? <div className="form-error">{error}</div> : null}<button className="primary-button" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button></> : <><div className="notice">Demo mode is active. Add Firebase variables in <code>.env</code> to connect live data.</div><button type="button" className="primary-button" onClick={onDemo}>Open demo CRM</button></>}</form></main>;
}

function Layout({ user, data, loading, error, reload, updateStage, changePlan, removeUser, removeJob, setUserBlockStatus, setJobBlockStatus, setCompanyVerificationStatus, sendInAppNotification, demo, onLogout }: { user: User | null; data: CrmData; loading: boolean; error: string; reload: () => Promise<void>; updateStage: (id: string, status: ApplicationStage) => Promise<void>; changePlan: (person: Person, planKey: ManagedPlan) => Promise<void>; removeUser: (person: Person) => Promise<void>; setUserBlockStatus: (person: Person, blocked: boolean, reason?: string) => Promise<void>; removeJob: (job: Job) => Promise<void>; setJobBlockStatus: (job: Job, blocked: boolean, reason?: string) => Promise<void>; setCompanyVerificationStatus: (company: Company, status: string, reason?: string) => Promise<void>; sendInAppNotification: (person: Person, title: string, message: string) => Promise<void>; demo: boolean; onLogout: () => void }) {
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><img className="brand-logo" src={brandLogo} alt="VikasDisha" /><span><b>VikasDisha</b><small>CRM workspace</small></span></div><nav>{navItems.map(([to, label, icon]) => <NavLink end={to === '/'} key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><i>{icon}</i>{label}</NavLink>)}</nav><div className="side-footer"><span className="avatar">{initials(user?.displayName || 'Admin')}</span><div><b>{user?.displayName || (demo ? 'Demo Admin' : 'Administrator')}</b><small>{demo ? 'Demo workspace' : user?.email}</small></div><button onClick={onLogout} title="Sign out">↗</button></div></aside><main className="workspace"><header className="workspace-header"><div><p className="kicker">Platform operations</p><h1>Customer relationship management</h1></div><div className="header-actions">{demo ? <Badge type="warning">Demo data</Badge> : <Badge type="success">Live Firebase</Badge>}<button className="outline-button" onClick={() => void reload()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div></header>{error ? <div className="error-banner">{error}</div> : null}<Routes><Route path="/" element={<Overview data={data} />} /><Route path="/people" element={<People people={data.people} companies={data.companies} verificationRequests={data.verificationRequests} changePlan={changePlan} removeUser={removeUser} setUserBlockStatus={setUserBlockStatus} setCompanyVerificationStatus={setCompanyVerificationStatus} sendInAppNotification={sendInAppNotification} />} /><Route path="/employers" element={<People people={data.people} companies={data.companies} verificationRequests={data.verificationRequests} defaultRole="recruiter" heading="Employer plans & approvals" changePlan={changePlan} removeUser={removeUser} setUserBlockStatus={setUserBlockStatus} setCompanyVerificationStatus={setCompanyVerificationStatus} sendInAppNotification={sendInAppNotification} />} /><Route path="/seekers" element={<People people={data.people} companies={data.companies} verificationRequests={data.verificationRequests} defaultRole="job-seeker" heading="Job seeker plans" changePlan={changePlan} removeUser={removeUser} setUserBlockStatus={setUserBlockStatus} setCompanyVerificationStatus={setCompanyVerificationStatus} sendInAppNotification={sendInAppNotification} />} /><Route path="/jobs" element={<Jobs jobs={data.jobs} people={data.people} removeJob={removeJob} setJobBlockStatus={setJobBlockStatus} />} /><Route path="/pipeline" element={<Pipeline applications={data.applications} people={data.people} updateStage={updateStage} />} /><Route path="/outreach" element={<Outreach people={data.people} sendInAppNotification={sendInAppNotification} />} /><Route path="/revenue" element={<Revenue payments={data.payments} people={data.people} />} /><Route path="/settings" element={<Settings demo={demo} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></main></div>;
}

function Overview({ data }: { data: CrmData }) {
  const activeJobs = data.jobs.filter((job) => !job.isHiringClosed && job.moderationStatus !== 'blocked').length;
  const paid = data.payments.filter((payment) => payment.status === 'captured');
  const revenue = paid.reduce((sum, payment) => sum + payment.amount, 0) / 100;
  const employers = data.people.filter((person) => person.role === 'recruiter');
  const paidSeekers = data.people.filter((person) => person.role === 'job-seeker' && ['employee_199', 'employee_299'].includes(person.plan || '') && person.subscriptionStatus === 'active');
  const pending = data.companies.filter((company) => {
    const request = data.verificationRequests.find((item) => item.companyId === company.id);
    return companyHasVerificationSubmission(company, request) && ['Pending', 'Under Review', 'Additional Information Required'].includes(company.verificationStatus || request?.status || '');
  }).length;
  const submittedRequests = data.verificationRequests.filter((item) => item.status === 'Under Review' || item.status === 'Pending').length;
  const blocked = data.people.filter((person) => person.accountStatus === 'blocked').length;
  return <><section className="metric-grid"><Metric label="Digital revenue" value={formatMoney(revenue)} note={`${paid.length} captured payments`} accent /><Metric label="Active employers" value={employers.length} note="Free / ₹599 / ₹999 tiers" /><Metric label="Paid job seekers" value={paidSeekers.length} note="Career Plus and Career Pro" /><Metric label="Live vacancies" value={activeJobs} note={`${data.jobs.length} total roles`} /><Metric label="Verification queue" value={pending} note={`${submittedRequests} submitted · ${blocked} blocked`} /></section><section className="content-grid"><article className="panel panel-wide"><div className="panel-heading"><div><p className="kicker">Latest movement</p><h2>Hiring pipeline</h2></div><NavLink to="/pipeline">View pipeline →</NavLink></div><PipelineRows applications={data.applications.slice(0, 5)} people={data.people} /></article><article className="panel"><div className="panel-heading"><div><p className="kicker">Subscription health</p><h2>Plan mix</h2></div><NavLink to="/people">Manage →</NavLink></div><div className="plan-list">{['employer_999', 'employer_599', 'employer_free', 'employee_299', 'employee_199', 'none'].map((plan) => { const count = data.people.filter((person) => (person.plan || 'none') === plan).length; return <div key={plan}><span>{plan.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}</span><b>{count}</b></div>; })}</div></article></section><section className="panel verification-summary"><div className="panel-heading"><div><p className="kicker">Employer trust</p><h2>Verification queue</h2><p className="plan-help">Employers submit a registration type and number. Approve only after checking the number; no government ID upload is collected.</p></div><NavLink to="/employers">Review employers →</NavLink></div><div className="verification-cards">{data.companies.filter((company) => { const request = data.verificationRequests.find((item) => item.companyId === company.id); return companyHasVerificationSubmission(company, request) && company.verificationStatus !== 'Verified'; }).slice(0, 4).map((company) => <div className="verification-card" key={company.id}><b>{company.companyName || 'Unnamed company'}</b><small>{companyRegistrationNumbers(company)[0] || 'Registration details missing'}</small><Badge type={company.verificationStatus === 'Rejected' ? 'danger' : 'warning'}>{company.verificationStatus || 'Pending'}</Badge></div>)}{!pending ? <p className="empty">No employer verifications are waiting for review.</p> : null}</div></section></>;
}

function PipelineRows({ applications, people }: { applications: Application[]; people: Person[] }) { return <div className="table-list">{applications.map((application) => { const person = people.find((item) => item.id === application.uid); return <div className="table-row" key={application.id}><div className="person-cell"><span className="avatar small">{initials(person?.displayName || 'Candidate')}</span><div><b>{person?.displayName || 'Candidate'}</b><small>{application.jobTitle}</small></div></div><span>{application.company}</span><StageBadge stage={application.status} /></div>; })}{!applications.length ? <p className="empty">No applications yet.</p> : null}</div>; }
function StageBadge({ stage }: { stage: ApplicationStage }) { const type = ['Selected', 'Offer Sent', 'Hired'].includes(stage) ? 'success' : stage === 'Rejected' ? 'danger' : stage === 'Interview Scheduled' ? 'accent' : 'warning'; return <Badge type={type}>{stage}</Badge>; }

function PlanEditor({ person, changePlan }: { person: Person; changePlan: (person: Person, planKey: ManagedPlan) => Promise<void> }) {
  const availablePlans = person.role === 'recruiter'
    ? (['employer_free', 'employer_599', 'employer_999'] as const)
    : (['none', 'employee_199', 'employee_299'] as const);
  const savedPlan = availablePlans.find((key) => key === person.plan);
  const initialPlan = savedPlan ?? availablePlans[0];
  const [planKey, setPlanKey] = useState<ManagedPlan>(initialPlan);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setPlanKey(availablePlans.find((key) => key === person.plan) ?? availablePlans[0]), [person.plan, person.role]);
  const save = async () => {
    setSaving(true); setError('');
    try { await changePlan(person, planKey); }
    catch (updateError: unknown) { setError(updateError instanceof Error ? updateError.message : 'Plan could not be updated.'); }
    finally { setSaving(false); }
  };
  return <div className="plan-editor"><select aria-label={`Plan for ${person.displayName || person.email}`} value={planKey} onChange={(event) => setPlanKey(event.target.value as ManagedPlan)} disabled={saving}>{availablePlans.map((key) => <option key={key} value={key}>{PLAN_DETAILS[key].name}</option>)}</select><button className="plan-save" type="button" onClick={() => void save()} disabled={saving || planKey === person.plan}>{saving ? 'Saving…' : 'Save plan'}</button>{error ? <small className="plan-error">{error}</small> : null}</div>;
}

function AccountActions({ person, removeUser, setUserBlockStatus, sendInAppNotification }: { person: Person; removeUser: (person: Person) => Promise<void>; setUserBlockStatus: (person: Person, blocked: boolean, reason?: string) => Promise<void>; sendInAppNotification: (person: Person, title: string, message: string) => Promise<void> }) {
  const [title, setTitle] = useState('Message from VikasDisha');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState(person.blockReason || '');
  const [status, setStatus] = useState('');

  const send = async () => {
    if (!title.trim() || !message.trim()) {
      setStatus('Enter a title and message first.');
      return;
    }
    setSending(true); setStatus('');
    try {
      await sendInAppNotification(person, title.trim(), message.trim());
      setMessage('');
      setStatus('Notification sent.');
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Notification could not be sent.');
    } finally { setSending(false); }
  };

  const remove = async () => {
    const label = person.displayName || person.email || 'this account';
    if (!window.confirm(`Remove ${label}? This permanently deletes the Firebase account, profile, resumes, notifications, applications, and employer job posts.`)) return;
    setRemoving(true); setStatus('');
    try { await removeUser(person); }
    catch (error: unknown) { setStatus(error instanceof Error ? error.message : 'Account could not be removed.'); }
    finally { setRemoving(false); }
  };

  const changeBlockStatus = async () => {
    const blocked = person.accountStatus === 'blocked';
    const nextBlocked = !blocked;
    if (nextBlocked && !reason.trim()) {
      setStatus('A reason is required before blocking an account.');
      return;
    }
    const label = person.displayName || person.email || 'this account';
    if (!window.confirm(`${nextBlocked ? 'Block' : 'Restore'} ${label}?${nextBlocked ? ' They will be signed out and cannot use the platform.' : ''}`)) return;
    setBlocking(true); setStatus('');
    try {
      await setUserBlockStatus(person, nextBlocked, reason.trim());
      setStatus(nextBlocked ? 'Account blocked and the user has been notified.' : 'Account restored and the user has been notified.');
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'Account status could not be changed.');
    } finally { setBlocking(false); }
  };

  return <div className="account-actions">
    <div className="notification-composer">
      <input aria-label={`Notification title for ${person.displayName || person.email}`} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Notification title" />
      <textarea aria-label={`Notification message for ${person.displayName || person.email}`} value={message} maxLength={1000} onChange={(event) => setMessage(event.target.value)} placeholder="Write an in-app notification" rows={2} />
      <textarea aria-label={`Moderation reason for ${person.displayName || person.email}`} value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder={person.accountStatus === 'blocked' ? 'Block reason (kept for your records)' : 'Reason required to block this account'} rows={2} />
      <div className="account-action-buttons"><button className="notify-button" type="button" onClick={() => void send()} disabled={sending}>{sending ? 'Sending…' : 'Send notification'}</button><button className={person.accountStatus === 'blocked' ? 'restore-button' : 'danger-button'} type="button" onClick={() => void changeBlockStatus()} disabled={blocking}>{blocking ? 'Updating…' : person.accountStatus === 'blocked' ? 'Restore user' : 'Block user'}</button><button className="danger-button" type="button" onClick={() => void remove()} disabled={removing}>{removing ? 'Removing…' : 'Remove user'}</button></div>
    </div>
    {status ? <small className="plan-error">{status}</small> : null}
  </div>;
}

const verificationStatuses = ['Pending', 'Under Review', 'Additional Information Required', 'Verified', 'Rejected', 'Suspended'];

function companyRegistrationNumbers(company: Company) {
  const selected = company.registrationType && company.registrationNumber
    ? `${company.registrationType === 'other' ? (company.otherRegistrationName || 'Other document') : company.registrationType.toUpperCase()}: ${company.registrationNumber}`
    : '';
  const nested = company.registrationNumbers ?? {};
  const values = [selected, company.gstin, company.udyam, company.cin, company.llpin, company.otherRegistrationNumber, nested.gstin, nested.udyam, nested.cin, nested.llpin, nested.otherRegistrationNumber];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length >= 5))];
}

function VerificationEditor({ company, save }: { company?: Company; save: (company: Company, status: string, reason?: string) => Promise<void> }) {
  const [status, setStatus] = useState(company?.verificationStatus || 'Pending');
  const [reason, setReason] = useState(company?.verificationReason || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setStatus(company?.verificationStatus || 'Pending');
    setReason(company?.verificationReason || '');
  }, [company?.id, company?.verificationStatus, company?.verificationReason]);
  if (!company) return <small className="plan-help">No company profile</small>;
  const update = async () => {
    if (['Rejected', 'Additional Information Required', 'Suspended'].includes(status) && !reason.trim()) {
      setError('A reason is required for this status.');
      return;
    }
    setSaving(true); setError('');
    try { await save(company, status, reason.trim()); }
    catch (saveError: unknown) { setError(saveError instanceof Error ? saveError.message : 'Verification could not be updated.'); }
    finally { setSaving(false); }
  };
  const registrations = companyRegistrationNumbers(company);
  const governmentId = company.governmentIdType && company.governmentIdNumber
    ? `${company.governmentIdType.toUpperCase()}: ${company.governmentIdNumber}`
    : '';
  return <div className="plan-editor">
    <small className="plan-help">{registrations.length ? `Registration submitted: ${registrations.join(', ')}` : 'Warning: employer has not supplied a registration type and number.'}</small>
    <small className="plan-help">{governmentId ? `Government ID submitted: ${governmentId}` : 'Warning: employer has not supplied a government ID type and number.'}</small>
    <select aria-label={`Verification status for ${company.companyName || company.id}`} value={status} onChange={(event) => setStatus(event.target.value)} disabled={saving}>{verificationStatuses.map((option) => <option key={option}>{option}</option>)}</select>
    <textarea value={reason} maxLength={1000} rows={2} onChange={(event) => setReason(event.target.value)} placeholder="Reason for rejection or more information" />
    <button className="plan-save" type="button" onClick={() => void update()} disabled={saving || status === (company.verificationStatus || 'Pending') && reason === (company.verificationReason || '')}>{saving ? 'Saving…' : 'Save verification'}</button>
    {error ? <small className="plan-error">{error}</small> : null}
  </div>;
}

function latestVerificationRequest(person: Person, company: Company | undefined, requests: EmployerVerificationRequest[]) {
  return requests
    .filter((request) => request.userId === person.id || (company?.id && request.companyId === company.id) || (person.companyId && request.companyId === person.companyId))
    .sort((first, second) => (second.updatedAt || second.submittedAt || '').localeCompare(first.updatedAt || first.submittedAt || ''))[0];
}

function companyHasVerificationSubmission(company: Company | undefined, request?: EmployerVerificationRequest) {
  if (request || company?.verificationSubmittedAt) return true;
  return ['Under Review', 'Additional Information Required', 'Rejected', 'Suspended', 'Verified'].includes(company?.verificationStatus || '');
}

function employerVerificationStatus(person: Person, company: Company | undefined, requests: EmployerVerificationRequest[]) {
  const request = latestVerificationRequest(person, company, requests);
  const profileStatus = person.companyVerificationStatus || '';
  const companyStatus = company?.verificationStatus || '';
  // Company verification is the source of truth after approval. For all other
  // states, prefer the latest submitted request so the CRM filter reflects the
  // request even when the user profile has not been synchronised yet.
  if (companyStatus === 'Verified') return 'Verified';
  if (!companyHasVerificationSubmission(company, request) && !['Under Review', 'Additional Information Required', 'Rejected', 'Suspended', 'Verified'].includes(profileStatus)) {
    return 'Not submitted';
  }
  return request?.status || companyStatus || profileStatus || 'Pending';
}

function People({ people, companies, verificationRequests, changePlan, removeUser, setUserBlockStatus, setCompanyVerificationStatus, sendInAppNotification, defaultRole, heading = 'People & accounts' }: { people: Person[]; companies: Company[]; verificationRequests: EmployerVerificationRequest[]; changePlan: (person: Person, planKey: ManagedPlan) => Promise<void>; removeUser: (person: Person) => Promise<void>; setUserBlockStatus: (person: Person, blocked: boolean, reason?: string) => Promise<void>; setCompanyVerificationStatus: (company: Company, status: string, reason?: string) => Promise<void>; sendInAppNotification: (person: Person, title: string, message: string) => Promise<void>; defaultRole?: Role; heading?: string }) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>(defaultRole || 'all');
  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked' | 'pending-verification' | 'verified'>('all');
  const [expandedId, setExpandedId] = useState('');
  const results = useMemo(() => people.filter((person) => {
    const haystack = [person.displayName, person.email, person.phone, person.role, person.companyName, person.headline, person.plan, person.companyVerificationStatus].join(' ').toLowerCase();
    const searchable = !query.trim() || haystack.includes(query.trim().toLowerCase());
    const roleMatches = roleFilter === 'all' || person.role === roleFilter;
    const planMatches = planFilter === 'all' || person.plan === planFilter;
    const company = companies.find((item) => item.ownerId === person.id || item.id === person.companyId);
    const verificationStatus = employerVerificationStatus(person, company, verificationRequests);
    const statusMatches = statusFilter === 'all' || (statusFilter === 'active' && person.accountStatus !== 'blocked') || (statusFilter === 'blocked' && person.accountStatus === 'blocked') || (statusFilter === 'pending-verification' && person.role === 'recruiter' && verificationStatus !== 'Verified' && verificationStatus !== 'Not submitted') || (statusFilter === 'verified' && person.role === 'recruiter' && verificationStatus === 'Verified');
    return searchable && roleMatches && planMatches && statusMatches;
  }), [people, companies, verificationRequests, query, roleFilter, planFilter, statusFilter]);
  const roleCount = (role: Role) => people.filter((person) => person.role === role).length;
  return <><section className="metric-grid people-metrics"><Metric label="All accounts" value={people.length} note={`${people.filter((person) => person.accountStatus !== 'blocked').length} active`} /><Metric label="Employers" value={roleCount('recruiter')} note="Company accounts" /><Metric label="Job seekers" value={roleCount('job-seeker')} note="Candidate accounts" /><Metric label="Blocked" value={people.filter((person) => person.accountStatus === 'blocked').length} note="Requires review" /></section><section className="panel"><div className="panel-heading responsive-heading"><div><p className="kicker">Directory & controls</p><h2>{heading}</h2><p className="plan-help">Live Firestore profiles, subscription tiers, profile completion, registration verification and moderation actions. Missing profile fields are shown safely as “—”.</p></div></div><div className="people-toolbar"><input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, phone, company or plan" /><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as Role | 'all')}><option value="all">All account types</option><option value="recruiter">Employers</option><option value="job-seeker">Job seekers</option><option value="admin">Administrators</option></select><select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}><option value="all">All plans</option><option value="employer_free">Employer Free</option><option value="employer_599">Employer Priority 5</option><option value="employer_999">Employer Priority 10</option><option value="employee_199">Career Plus</option><option value="employee_299">Career Pro</option><option value="none">No subscription</option></select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All statuses</option><option value="active">Active accounts</option><option value="blocked">Blocked accounts</option><option value="pending-verification">Under verification</option><option value="verified">Verified employers</option></select></div><div className="table-list">{results.map((person) => { const company = companies.find((item) => item.ownerId === person.id || item.id === person.companyId); const verificationStatus = employerVerificationStatus(person, company, verificationRequests); const expanded = expandedId === person.id; return <div className={`person-record ${expanded ? 'expanded' : ''}`} key={person.id}><div className="table-row people-row"><div className="person-cell"><span className="avatar small">{initials(person.displayName)}</span><div><b>{person.displayName || 'Unnamed account'}</b><small>{person.email || 'No email'}{person.phone ? ` · ${person.phone}` : ''}</small></div></div><span>{person.headline || person.companyName || '—'}</span><Badge type={person.accountStatus === 'blocked' ? 'danger' : person.role === 'recruiter' ? 'accent' : 'neutral'}>{person.accountStatus === 'blocked' ? 'blocked' : person.role}</Badge><button className="outline-button detail-button" type="button" onClick={() => setExpandedId(expanded ? '' : person.id)}>{expanded ? 'Hide details' : 'View details'}</button></div>{expanded ? <div className="person-detail"><div className="detail-grid"><span><b>Email</b>{person.email || '—'}</span><span><b>Phone</b>{person.phone || '—'}</span><span><b>Plan</b>{person.subscriptionName || person.plan || 'No subscription'}</span><span><b>Profile</b>{person.profileCompletionPercentage != null ? `${person.profileCompletionPercentage}%` : person.profileCompleted ? 'Complete' : 'Incomplete'}</span><span><b>Created</b>{person.createdAt ? new Date(person.createdAt).toLocaleString() : '—'}</span><span><b>Last login</b>{person.lastLoginAt ? new Date(person.lastLoginAt).toLocaleString() : '—'}</span>{person.role === 'recruiter' ? <span><b>Employer verification</b>{verificationStatus}</span> : null}{person.role === 'recruiter' ? <span><b>Jobs</b>{person.activeJobs ?? 0} active / {person.totalJobsPosted ?? 0} total</span> : null}{person.role === 'job-seeker' ? <span><b>Credits remaining</b>{person.availableJobCredits ?? '—'}</span> : null}</div>{person.role === 'admin' ? <Badge type="neutral">Administrator accounts cannot be assigned plans or moderated here.</Badge> : <div className="person-controls"><PlanEditor person={person} changePlan={changePlan} />{person.role === 'recruiter' ? <VerificationEditor company={company} save={setCompanyVerificationStatus} /> : null}<AccountActions person={person} removeUser={removeUser} setUserBlockStatus={setUserBlockStatus} sendInAppNotification={sendInAppNotification} /></div>}</div> : null}</div>; })}{!results.length ? <p className="empty">No people match these filters.</p> : null}</div></section></>;
}

function Outreach({ people, sendInAppNotification }: { people: Person[]; sendInAppNotification: (person: Person, title: string, message: string) => Promise<void> }) {
  const [plan, setPlan] = useState('all');
  const [domain, setDomain] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('A new opportunity from VikasDisha');
  const [message, setMessage] = useState('Hello {name}, we found an opportunity that may match your profile. Open VikasDisha to learn more.');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const targets = useMemo(() => people.filter((person) => {
    const paid = ['employee_199', 'employee_299'].includes(person.plan || '') && person.subscriptionStatus === 'active';
    const matchesPlan = plan === 'all' || person.plan === plan;
    const matchesDomain = domain === 'all' || person.headline === domain || person.industry === domain;
    const matchesQuery = !query.trim() || `${person.displayName} ${person.email} ${person.headline} ${person.phone}`.toLowerCase().includes(query.trim().toLowerCase());
    return paid && matchesPlan && matchesDomain && matchesQuery && person.accountStatus !== 'blocked';
  }), [people, plan, domain, query]);
  const domains = useMemo(() => [...new Set(people.filter((person) => person.role === 'job-seeker' && person.headline).map((person) => person.headline as string))].sort(), [people]);
  useEffect(() => setSelected((current) => current.filter((id) => targets.some((person) => person.id === id))), [targets]);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const send = async () => {
    const recipients = targets.filter((person) => selected.includes(person.id));
    if (!recipients.length) { setStatus('Select at least one paid, active job seeker.'); return; }
    if (!title.trim() || !message.trim()) { setStatus('Enter a title and message first.'); return; }
    if (!window.confirm(`Send this in-app notification to ${recipients.length} candidate${recipients.length === 1 ? '' : 's'}?`)) return;
    setSending(true); setStatus('');
    try {
      for (const person of recipients) {
        await sendInAppNotification(person, title.trim(), message.replaceAll('{name}', person.displayName).replaceAll('{plan}', person.subscriptionName || person.plan || 'paid plan'));
      }
      setStatus(`Sent to ${recipients.length} candidate${recipients.length === 1 ? '' : 's'}.`);
      setSelected([]);
    } catch (error: unknown) { setStatus(error instanceof Error ? error.message : 'Outreach could not be sent.'); }
    finally { setSending(false); }
  };
  return <section className="panel outreach-panel"><div className="panel-heading"><div><p className="kicker">Candidate outreach</p><h2>Targeted notification studio</h2><p className="plan-help">Filter active Career Plus/Pro subscribers and send in-app notifications. Email and WhatsApp delivery still require a separately configured provider and are intentionally not reported as active.</p></div></div><div className="outreach-filters"><input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidate" /><select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="all">All qualification domains</option>{domains.map((item) => <option key={item}>{item}</option>)}</select><select value={plan} onChange={(event) => setPlan(event.target.value)}><option value="all">All paid plans</option><option value="employee_199">Career Plus (₹199)</option><option value="employee_299">Career Pro (₹299)</option></select></div><div className="outreach-composer"><input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Notification title" /><textarea value={message} maxLength={1000} onChange={(event) => setMessage(event.target.value)} rows={3} placeholder="Use {name} and {plan} placeholders" /><div className="outreach-actions"><span>{selected.length} of {targets.length} targets selected</span><button className="notify-button" type="button" onClick={() => void send()} disabled={sending}>{sending ? 'Sending…' : 'Send in-app broadcast'}</button></div></div><div className="outreach-list">{targets.map((person) => <label className="outreach-target" key={person.id}><input type="checkbox" checked={selected.includes(person.id)} onChange={() => toggle(person.id)} /><span className="avatar small">{initials(person.displayName)}</span><span><b>{person.displayName}</b><small>{person.headline || 'Profile domain not supplied'} · {person.phone || person.email}</small></span><Badge type="success">{person.subscriptionName || person.plan}</Badge></label>)}{!targets.length ? <p className="empty">No paid active candidates match these filters.</p> : null}</div>{status ? <div className="form-status">{status}</div> : null}</section>;
}

function Jobs({ jobs, people, removeJob, setJobBlockStatus }: { jobs: Job[]; people: Person[]; removeJob: (job: Job) => Promise<void>; setJobBlockStatus: (job: Job, blocked: boolean, reason?: string) => Promise<void> }) {
  const [removingId, setRemovingId] = useState('');
  const [error, setError] = useState('');
  const [reasonByJob, setReasonByJob] = useState<Record<string, string>>({});
  const [blockingId, setBlockingId] = useState('');
  const remove = async (job: Job) => {
    if (!window.confirm(`Remove “${job.title}” at ${job.company}? This also removes related applications and saved-candidate records.`)) return;
    setRemovingId(job.id); setError('');
    try { await removeJob(job); }
    catch (removeError: unknown) { setError(removeError instanceof Error ? removeError.message : 'Job could not be removed.'); }
    finally { setRemovingId(''); }
  };
  const changeBlockStatus = async (job: Job) => {
    const nextBlocked = job.moderationStatus !== 'blocked';
    const reason = reasonByJob[job.id] ?? job.blockReason ?? '';
    if (nextBlocked && !reason.trim()) { setError('Enter a reason before blocking this job.'); return; }
    if (!window.confirm(`${nextBlocked ? 'Block' : 'Restore'} “${job.title}”?${nextBlocked ? ' The employer will be notified and applicants will no longer see it.' : ''}`)) return;
    setBlockingId(job.id); setError('');
    try { await setJobBlockStatus(job, nextBlocked, reason.trim()); }
    catch (blockError: unknown) { setError(blockError instanceof Error ? blockError.message : 'Job status could not be changed.'); }
    finally { setBlockingId(''); }
  };
  return <section className="panel"><div className="panel-heading"><div><p className="kicker">Hiring supply</p><h2>Job inventory</h2><p className="plan-help">Block a job with a recorded reason to hide it from job seekers and notify its employer. Removal is permanent.</p></div></div>{error ? <div className="form-error">{error}</div> : null}<div className="table-list">{jobs.map((job) => <div className="table-row jobs-row" key={job.id}><div><b>{job.title}</b><small>{job.company} · {job.location}</small></div><span>{people.find((person) => person.id === job.postedBy)?.displayName || 'Employer'}</span><Badge type={job.moderationStatus === 'blocked' ? 'danger' : job.isHiringClosed ? 'neutral' : 'success'}>{job.moderationStatus === 'blocked' ? 'Blocked' : job.isHiringClosed ? 'Closed' : 'Live'}</Badge><div className="job-moderation"><textarea value={reasonByJob[job.id] ?? job.blockReason ?? ''} maxLength={1000} onChange={(event) => setReasonByJob((current) => ({ ...current, [job.id]: event.target.value }))} placeholder={job.moderationStatus === 'blocked' ? 'Block reason' : 'Reason required to block'} rows={2} /><button className={job.moderationStatus === 'blocked' ? 'restore-button' : 'danger-button'} type="button" onClick={() => void changeBlockStatus(job)} disabled={blockingId === job.id}>{blockingId === job.id ? 'Updating…' : job.moderationStatus === 'blocked' ? 'Restore job' : 'Block job'}</button><button className="danger-button" type="button" onClick={() => void remove(job)} disabled={removingId === job.id}>{removingId === job.id ? 'Removing…' : 'Remove job'}</button></div></div>)}{!jobs.length ? <p className="empty">No jobs have been posted.</p> : null}</div></section>;
}

function Pipeline({ applications, people, updateStage }: { applications: Application[]; people: Person[]; updateStage: (id: string, status: ApplicationStage) => Promise<void> }) { return <section className="pipeline">{stages.slice(0, 5).map((stage) => <article className="kanban-column" key={stage}><div className="column-heading"><b>{stage}</b><span>{applications.filter((item) => item.status === stage).length}</span></div>{applications.filter((item) => item.status === stage).map((application) => { const person = people.find((item) => item.id === application.uid); return <div className="candidate-card" key={application.id}><span className="avatar small">{initials(person?.displayName || 'Candidate')}</span><b>{person?.displayName || 'Candidate'}</b><small>{application.jobTitle}</small><label>Move to<select value={application.status} onChange={(event) => void updateStage(application.id, event.target.value as ApplicationStage)}>{stages.map((option) => <option key={option}>{option}</option>)}</select></label></div>; })}</article>)}</section>; }

function Revenue({ payments, people }: { payments: Payment[]; people: Person[] }) { const captured = payments.filter((payment) => payment.status === 'captured'); const revenue = captured.reduce((sum, payment) => sum + payment.amount, 0) / 100; return <><section className="metric-grid"><Metric label="Captured revenue" value={formatMoney(revenue)} note="From completed payments" accent /><Metric label="Paid orders" value={captured.length} note="Successfully captured" /><Metric label="Average order" value={formatMoney(captured.length ? Math.round(revenue / captured.length) : 0)} note="Captured payments only" /></section><section className="panel"><div className="panel-heading"><div><p className="kicker">Billing ledger</p><h2>Payments</h2></div></div><div className="table-list">{payments.map((payment) => <div className="table-row jobs-row" key={payment.id}><div><b>{people.find((person) => person.id === payment.uid)?.displayName || payment.uid}</b><small>{payment.planKey}</small></div><strong>{formatMoney(payment.amount / 100)}</strong><Badge type={payment.status === 'captured' ? 'success' : 'warning'}>{payment.status}</Badge></div>)}{!payments.length ? <p className="empty">No payment records yet.</p> : null}</div></section></>; }

function Settings({ demo }: { demo: boolean }) { return <section className="settings-grid"><article className="panel"><p className="kicker">Connection</p><h2>{demo ? 'Demo workspace' : 'Firebase is connected'}</h2><p>{demo ? 'Create a .env file from .env.example and add the same public Firebase web config used by the Expo app.' : 'Live data is loaded from users, companies, employerVerificationRequests, jobs, applications and paymentOrders. Refresh after a mobile action to see the latest state.'}</p></article><article className="panel"><p className="kicker">Employer approval policy</p><h2>Registration and government ID review</h2><p>Employers choose GSTIN, Udyam, CIN, LLPIN or Other and provide the number (Other also requires a document name), plus a government ID type and number. CRM administrators review both submitted identifiers and set a status. No file upload is collected in this release.</p></article><article className="panel"><p className="kicker">Access control</p><h2>Administrator only</h2><p>The signed-in user must have <code>role: "admin"</code> in their Firestore user document. Keep Firestore rules and Functions deployed before using live moderation, verification or notifications.</p></article></section>; }

export default function App() {
  const [user, setUser] = useState<User | null>(null); const [authLoading, setAuthLoading] = useState(isFirebaseConfigured); const [demo, setDemo] = useState(!isFirebaseConfigured); const crm = useCrm();
  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, async (nextUser) => {
      if (!nextUser || !firestore) { setUser(null); setAuthLoading(false); return; }
      try {
        const profile = await getDoc(doc(firestore, 'users', nextUser.uid));
        if (profile.data()?.role === 'admin') setUser(nextUser);
        else {
          setUser(null);
          await signOut(firebaseAuth);
        }
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    });
  }, []);
  if (authLoading) return <div className="page-loader">Loading secure workspace…</div>;
  if (!demo && !user) return <Login onDemo={() => setDemo(true)} />;
  return <Layout user={user} demo={demo} onLogout={() => { if (demo) setDemo(false); else if (firebaseAuth) void signOut(firebaseAuth); }} {...crm} />;
}
