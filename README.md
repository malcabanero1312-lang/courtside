# Courtside

Tennis appointment management for clubs, coaches and booking agents.

Book a session → open WhatsApp with a ready, personalised message → the student taps a link to confirm, decline or ask for another time → the appointment updates itself and the coach and agent are emailed.

**First time? Read [SETUP.md](SETUP.md).**

## What's included

- **Smart booking** — live availability check while you type; double bookings of a coach or court are blocked by the database itself, even if two agents click Save at the same moment. Venue hours, coach working hours, time off and court closures are respected. When a time is taken you get one-tap suggestions for nearby free slots (including another free court).
- **WhatsApp messages** — rendered from editable templates with real appointment data. One click opens the right chat with the text filled in. The agent confirms it was sent; the app never pretends.
- **Student response page** — a private, mobile-friendly link per appointment (expires automatically, replaced on reschedule, switched off on cancel). Includes directions and an "Add to calendar" file.
- **Email automation** — confirmations, cancellations, new times, reminders, and staff alerts when a student responds. A queue with retries, a full log, and plain-language reasons when something wasn't sent.
- **Appointment table** — views (To contact, Awaiting reply, New time requested, To close…), search, filters, sorting, saved views, column toggles, bulk actions, Excel-friendly CSV export.
- **History** — every change, who made it, and what the student said, on each appointment.
- **Students** — profiles, guardians, duplicate detection when booking, CSV import, archive instead of delete.
- **Coaches, venues, courts** — multiple of each, working hours, time off, closures, colours on the calendar.
- **Dashboard, calendar, reports** — today's sessions, what needs attention, week view, confirmation and reply rates, coach utilisation, agent workload.
- **Teams & roles** — admin, agent and coach, enforced with row-level security. Built for many organizations from day one; each one's data is separate.
- **Settings without code** — organization rules, session types, message templates, notification switches.

## Tech

Next.js 15 (App Router, server actions) · TypeScript · Supabase (Postgres, Auth, row-level security) · Resend for email · deployable on Vercel.

```
app/(app)/        signed-in pages (dashboard, appointments, calendar, students, …)
app/r/[token]/    student response page (public, token-protected)
app/api/          availability check, CSV export, calendar files, scheduled email job
components/       UI building blocks
lib/              scheduling, templates, notifications, time zones, helpers
supabase/         database schema, security rules and optional scheduler
```

The important rules live in the database (`supabase/migrations`): status transitions, conflict prevention, audit history, notification queueing, tenant isolation and student-link checks. The website can't bypass them.

## Commands

```
npm install      install dependencies
npm run dev      run locally at http://localhost:3000
npm run build    production build
npm run typecheck
```
