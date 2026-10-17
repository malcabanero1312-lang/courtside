# Courtside — setup guide

This guide takes you from the zip file to a live website. Plan for about 45 minutes the first time. You only need a web browser, VS Code, and free accounts on three services:

| Service | What it does | Cost to start |
|---|---|---|
| **Supabase** | Database, logins, security rules | Free plan |
| **Vercel** | Hosts the website | Free (Hobby) plan |
| **Resend** | Sends emails (confirmations, reminders, login emails) | Free plan, up to 3,000 emails/month |

WhatsApp needs **no account or API**. The app opens WhatsApp with the message already written; the agent presses Send.

---

## 1. Install the tools on your computer

1. Install **Node.js 20 or newer** (choose "LTS") from https://nodejs.org. Accept all defaults.
2. Install **Git** from https://git-scm.com if you don't have it.
3. Unzip `courtside.zip` into a folder, for example `Documents/courtside`.
4. Open that folder in **VS Code** (File → Open Folder).
5. Open the terminal in VS Code (View → Terminal) and run:

```
npm install
```

Wait until it finishes. A few "warn" lines are normal.

---

## 2. Create the database (Supabase)

1. Go to https://supabase.com, sign up, and click **New project**.
   - Name: `courtside`
   - Database password: click **Generate** and save it somewhere safe.
   - Region: the one closest to your club (for the Philippines, **Southeast Asia (Singapore)**).
2. Wait about 2 minutes for the project to start.
3. In the left menu, open **SQL Editor** → **New query**.
4. In VS Code, open `supabase/migrations/0001_schema.sql`, select everything (Ctrl+A), copy, paste into the Supabase SQL editor, and click **Run**. You should see "Success. No rows returned".
5. Do the same with `supabase/migrations/0002_functions_and_security.sql`.
6. And then `supabase/migrations/0003_office_approval.sql` (adds the office approval step).
7. And then `supabase/migrations/0004_one_time_student_answer.sql` (students can answer only once).
8. And then `supabase/migrations/0005_invites_and_user_delete.sql` (lets you delete users from Supabase).
9. And then `supabase/migrations/0006_coach_breaks.sql` (coach breaks during the day).
10. And then `supabase/migrations/0007_sheet_import.sql` (importing the office court sheet for regular students).
11. And then `supabase/migrations/0008_court_names_and_regulars.sql` (second court names and regular / not regular students).
12. And then `supabase/migrations/0009_shared_lessons.sql` (two students sharing one lesson, e.g. “Lam / Kristen”).
13. And then `supabase/migrations/0010_regular_schedules.sql` (weekly schedules for regular students and the monthly office request).
14. And then `supabase/migrations/0011_monthly_confirmations.sql` (monthly confirmation links for regular students).

> Run them in that order, once. If you see an error, read the first red line — it usually says what's wrong. Running a file twice will show "already exists" errors; that's harmless.

### Get your keys

In Supabase, open **Project Settings → API** (or **API Keys**) and copy:

- **Project URL** → looks like `https://abcdefgh.supabase.co`
- **anon / publishable key** → safe to use in the browser
- **service_role / secret key** → **keep this private**. Never paste it into chat, email or the browser.

---

## 3. Create the settings file

1. In VS Code, find `.env.example`, right-click → **Copy**, then **Paste**, and rename the copy to `.env.local`.
2. Fill it in:

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste-the-anon-key
SUPABASE_SERVICE_ROLE_KEY=paste-the-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
RESEND_API_KEY=
EMAIL_FROM=
CRON_SECRET=type-any-long-random-password-here
```

Leave `RESEND_API_KEY` and `EMAIL_FROM` empty for now — the app works without them and simply records emails as "Not sent".

---

## 4. Allow logins to come back to your app

In Supabase open **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` for now (change it to your live address in step 7).
- **Redirect URLs** → **Add URL**: `http://localhost:3000/auth/callback`

Leave **Authentication → Providers → Email → Confirm email** switched **ON**. It protects team invitations: someone can only join your club with an email address they actually own.

---

## 5. Start the app on your computer

In the VS Code terminal:

```
npm run dev
```

Open http://localhost:3000 in your browser.

1. Click **Create an account**, enter your name, email and a password.
2. Open the confirmation email from Supabase and click the link.
3. Create your workspace (club name, time zone, country code).
4. Follow the **Get set up** checklist on the dashboard: add a venue, add a coach, then book a test appointment using your own phone number.

> Supabase's built-in email service is only for testing: it sends just a few emails per hour and only to people on your Supabase team. Before inviting agents and coaches, finish step 6.

---

## 6. Turn on email (Resend)

1. Sign up at https://resend.com.
2. **Domains → Add domain** and enter a domain you own (for example `yourclub.com`). Add the DNS records Resend shows at your domain provider, then click **Verify**. Without a verified domain, Resend only delivers to your own email address.
3. **API Keys → Create API key** (permission: Sending access). Copy it.
4. In `.env.local` set:

```
RESEND_API_KEY=re_xxxxxxxx
EMAIL_FROM=Baseline Tennis <bookings@yourclub.com>
```

5. Use Resend for Supabase's login emails too, so invited team members receive their confirmation emails. In Supabase open **Authentication → Emails → SMTP Settings**, enable custom SMTP, and enter:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: your Resend API key
   - Sender email: an address on your verified domain, e.g. `bookings@yourclub.com`
6. Stop the app (Ctrl+C in the terminal) and run `npm run dev` again.

Check it worked: open **Emails** in the app and press **Send now**. Anything marked "Not sent" because email wasn't set up can be sent with **Retry**.

---

## 7. Put it online (Vercel)

1. Create a free GitHub account and a new **private** repository named `courtside`.
2. In the VS Code terminal:

```
git init
git add .
git commit -m "Courtside"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/courtside.git
git push -u origin main
```

`.env.local` is not uploaded — that's intentional, it keeps your keys private.

3. Go to https://vercel.com, sign in with GitHub, click **Add New → Project**, and import `courtside`.
4. Before clicking Deploy, open **Environment Variables** and add every line from your `.env.local`, but set:
   - `NEXT_PUBLIC_APP_URL` = your Vercel address, e.g. `https://courtside-yourclub.vercel.app` (you can fix it after the first deploy and redeploy).
5. Click **Deploy**.
6. Back in Supabase → **Authentication → URL Configuration**:
   - Set **Site URL** to your Vercel address.
   - Add `https://YOUR-ADDRESS.vercel.app/auth/callback` to **Redirect URLs**.

The student links in WhatsApp messages use `NEXT_PUBLIC_APP_URL`, so make sure it's the live address before you start messaging students.

---

## 8. Reminders and automatic retries

Emails are sent immediately when something happens. A scheduled job also:

- queues reminder emails (default: 24 hours before each confirmed session), and
- retries emails that failed.

`vercel.json` already runs this job once a day on Vercel's free plan. That's enough for 24-hour reminders. For faster retries (every 10 minutes), use Supabase's scheduler:

1. Open `supabase/scheduler.sql` in VS Code.
2. Replace `YOUR-APP.vercel.app` with your address and `YOUR-CRON-SECRET` with the `CRON_SECRET` you chose.
3. Paste it into the Supabase SQL Editor and click **Run**.

The dashboard warns you if the job hasn't run in the past day.

---

## Everyday use

**Book a session** → Appointments → New appointment. Availability is checked as you type; if the time is taken, tap one of the suggested free times.

**Send the WhatsApp message** → after saving you land on the appointment. Click **Open WhatsApp**, press Send inside WhatsApp, then click **Yes, mark as sent**. The app never assumes a message was sent just because WhatsApp opened.

**The student answers** → they tap the link in the message and choose *Confirm*, *I need a different time*, or *I can't make it*. The appointment updates instantly, and the coach and agent get an email.

**Office approval** → when a student confirms, the appointment shows **Waiting for office**. On the appointment page, the coach or agent sends the ready-made message to the office (one tap with WhatsApp if the office number is saved in Settings, or Copy). When the office replies, click **Office approved** or **Office didn't approve**. A ready message to the student with the result appears next — send it and click **Yes, mark as sent**. The dashboard shows how many bookings are waiting for the office and how many students still need to hear the result.

**Reschedule** → open the appointment → Reschedule. The old booking is kept in the history as "Moved", a new one is created, and the old student link stops working.

**Cancel by mistake?** → open it and click **Restore appointment** (only works if the time is still free).

---

## Who can do what

| | Admin | Agent | Coach |
|---|---|---|---|
| Book, reschedule, cancel | ✓ | ✓ | |
| Students, emails, reports | ✓ | ✓ | |
| See sessions | All | All | Their own |
| Mark completed / no-show | ✓ | ✓ | Their own |
| Set working hours, time off | ✓ | Time off | Their own |
| Venues, courts | ✓ | Closures only | |
| Team, settings, templates | ✓ | | |

These rules are enforced inside the database, not just hidden in the menus.

---

## Backups and safety

- **Backups**: Supabase's free plan has no automatic backups you can restore yourself. Either upgrade to Supabase Pro (daily backups), or download a copy regularly: Supabase → **Database → Backups**, or from the app use **Appointments → Export CSV**.
- **Nothing is hard-deleted by accident**: students are archived, not deleted; cancelled sessions can be restored; rescheduling keeps the original; every change is in the appointment's History.
- **Keys**: if you ever think the service role key leaked, rotate it in Supabase (Project Settings → API) and update it in Vercel.
- **Errors**: Vercel → your project → **Logs**. Messages start with `[courtside:…]` and never include student details or keys.

---

## Updating the app later

Make changes in VS Code, then:

```
git add .
git commit -m "Describe the change"
git push
```

Vercel redeploys automatically in about a minute. If a change includes a new file in `supabase/migrations`, run that file in the Supabase SQL Editor **before** pushing.

---

## Troubleshooting

| You see | What to do |
|---|---|
| "Almost ready" setup page | A value in `.env.local` (or Vercel's Environment Variables) is missing. Restart after fixing. |
| Login link says expired | Add the `/auth/callback` address to Supabase Redirect URLs (step 4/7) and request a new link. |
| Invited person never gets the confirmation email | Set up Resend SMTP in Supabase (step 6, point 5). |
| Emails show "Not sent" | Email isn't configured, or the person has no email address. The reason is shown next to each email. |
| Emails show "Failed" | Usually the domain isn't verified in Resend. Fix it, then **Retry**. |
| Student link opens "Link not found" | `NEXT_PUBLIC_APP_URL` pointed to the wrong address when the message was made. Fix it, then use **Replace link** on the appointment and resend. |
| "That time overlaps another booking" | Working as intended — the coach or court is already booked. Pick a suggested time. |
