import type { CrmData } from './types';

export const demoData: CrmData = {
  people: [
    { id: 'person-1', displayName: 'Aarav Mehta', email: 'aarav@example.com', role: 'job-seeker', headline: 'Android Developer', plan: 'employee_299', subscriptionStatus: 'active', createdAt: '2026-10-15' },
    { id: 'person-2', displayName: 'Priya Nair', email: 'priya@example.com', role: 'job-seeker', headline: 'Product Designer', plan: 'free', subscriptionStatus: 'free', createdAt: '2026-10-14' },
    { id: 'person-3', displayName: 'VikasTech Innovations', email: 'talent@vikastech.in', role: 'recruiter', headline: 'Hiring partner', plan: 'employer_999', subscriptionStatus: 'active', createdAt: '2026-10-12' },
    { id: 'person-4', displayName: 'Northstar Labs', email: 'jobs@northstar.in', role: 'recruiter', headline: 'Hiring partner', plan: 'employer_599', subscriptionStatus: 'active', createdAt: '2026-10-11' },
  ],
  jobs: [
    { id: 'job-1', title: 'Senior Android Engineer', company: 'VikasTech Innovations', location: 'Bengaluru · Hybrid', postedBy: 'person-3' },
    { id: 'job-2', title: 'Product Designer', company: 'Northstar Labs', location: 'Pune · On-site', postedBy: 'person-4' },
    { id: 'job-3', title: 'Data Scientist', company: 'VikasTech Innovations', location: 'Remote', postedBy: 'person-3' },
  ],
  applications: [
    { id: 'app-1', uid: 'person-1', recruiterId: 'person-3', jobId: 'job-1', jobTitle: 'Senior Android Engineer', company: 'VikasTech Innovations', status: 'Interview Scheduled', appliedOn: '2026-10-19' },
    { id: 'app-2', uid: 'person-2', recruiterId: 'person-4', jobId: 'job-2', jobTitle: 'Product Designer', company: 'Northstar Labs', status: 'Shortlisted', appliedOn: '2026-10-18' },
    { id: 'app-3', uid: 'person-1', recruiterId: 'person-3', jobId: 'job-3', jobTitle: 'Data Scientist', company: 'VikasTech Innovations', status: 'In Review', appliedOn: '2026-10-17' },
  ],
  payments: [
    { id: 'payment-1', uid: 'person-3', planKey: 'employer_999', amount: 99900, status: 'captured', createdAt: '2026-10-18' },
    { id: 'payment-2', uid: 'person-1', planKey: 'employee_299', amount: 29900, status: 'captured', createdAt: '2026-10-16' },
    { id: 'payment-3', uid: 'person-4', planKey: 'employer_599', amount: 59900, status: 'captured', createdAt: '2026-10-14' },
  ],
  companies: [],
  verificationRequests: [],
};
