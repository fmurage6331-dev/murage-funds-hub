# Members, Roles, Contributions & Loans

## Roles (expanded)
Extend `app_role` enum: `admin`, `chairman`, `treasurer`, `secretary`, `assistant_secretary`, `board_member`, `member`.
- **admin** (francismurageweb@gmail.com): full control, assigns all roles, sets loan eligibility rules.
- **treasurer**: confirms member contributions, records income/expenses.
- **chairman**: forwards loan requests to board, views all financials.
- **secretary / assistant_secretary**: manage donors & members registry, create meeting notices & minutes; read-only financials.
- **board_member**: votes on forwarded loans.
- **member** (default new signup): self-records contributions, requests loans, views own history.

The user with email `francismurageweb@gmail.com` is auto-promoted to admin on signup / by trigger. First-user-becomes-admin logic replaced by this email match.

## New tables

- **contributions**: `member_id`, `amount`, `contributed_on`, `method` (cash/mpesa/bank), `reference`, `status` (pending/confirmed/rejected), `confirmed_by`, `confirmed_at`, `notes`. Members insert own (status=pending). Treasurer/admin update status.
- **loan_rules** (singleton, admin-editable): `max_multiplier` (of contributions), `max_amount`, `min_membership_days`, `interest_rate_percent`, `max_repayment_months`, `active`.
- **loans**: `member_id`, `amount`, `purpose`, `repayment_months`, `status` (`draft`, `submitted`, `forwarded`, `approved`, `rejected`, `disbursed`, `repaid`), `forwarded_by`, `forwarded_at`, `decision_at`, `rejection_reason`, `auto_eligible` (bool computed on submit against `loan_rules`).
- **loan_votes**: `loan_id`, `board_member_id`, `vote` (approve/reject), `comment`. Unique on (loan_id, board_member_id). When approve-votes reach majority of active board members, loan status auto-flips to `approved` via trigger.
- **meetings**: `title`, `scheduled_for`, `location`, `agenda`, `created_by` (secretary). Notifies all members (in-app list; email out of scope for v1).
- **meeting_minutes**: `meeting_id`, `content`, `recorded_by`, `recorded_at`.

RLS:
- Members see only own contributions & loans.
- Treasurer/admin see all contributions; can update status.
- Chairman/treasurer can update loans from `submitted` → `forwarded`.
- Board members see forwarded/approved/rejected loans; insert votes.
- Everyone authenticated sees meetings; secretary/asst secretary/admin insert/update.

Security-definer helpers: `has_any_role(uuid, app_role[])`, `board_majority_count()`.

## UI changes

- New sidebar sections depending on role:
  - Member: **My Contributions**, **My Loans**, **Meetings**
  - Treasurer/Admin: **Contributions Review**, plus existing Transactions
  - Chairman/Treasurer: **Loan Requests** (queue with Forward action)
  - Board: **Loan Approvals** (vote UI)
  - Secretary: **Meetings** (create + minutes)
  - Admin: **Users & Roles** (assign roles), **Loan Rules** (edit eligibility)
- `handle_new_user` trigger: assigns `admin` if email = francismurageweb@gmail.com, else `member`.

## Technical notes
- Migration creates enum values, tables with GRANTs, RLS policies, triggers (majority approval, auto-eligibility check).
- Loan submit computes `auto_eligible` from `loan_rules` + sum of confirmed contributions.
- No email notifications in v1; in-app badges only.
- Meeting notifications = list on Meetings page + a simple unread count via `meeting_reads` (optional; skipped unless needed).

## Out of scope
- Actual loan disbursement/repayment ledger (status stops at approved/rejected).
- Email/SMS delivery for meeting notices.
- File uploads for minutes (text only).
