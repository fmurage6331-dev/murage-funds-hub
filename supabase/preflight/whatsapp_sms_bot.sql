-- READ-ONLY preflight for 20260924120000_whatsapp_sms_bot.sql.
-- Run each SELECT as a project administrator in the Supabase SQL editor BEFORE
-- applying the migration. All three results should be empty. The first query
-- contains member phone numbers: never paste its output into public logs/PRs.
-- Resolve conflicts with the owners; do NOT arbitrarily delete finance rows.

-- 1. Phones that would collide after the migration's canonicalization.
WITH phones AS (
  -- The column is created by the migration on an unmodified legacy database.
  SELECT p.id, to_jsonb(p)->>'phone_number' AS phone_number FROM public.profiles p
), normalized AS (
  SELECT id, phone_number,
    CASE
      WHEN btrim(phone_number) = '' THEN NULL
      WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^254[17][0-9]{8}$'
        THEN regexp_replace(phone_number, '\D', '', 'g')
      WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^0[17][0-9]{8}$'
        THEN '254' || substr(regexp_replace(phone_number, '\D', '', 'g'), 2)
      WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^[17][0-9]{8}$'
        THEN '254' || regexp_replace(phone_number, '\D', '', 'g')
      ELSE phone_number
    END AS canonical_phone
  FROM phones
  WHERE phone_number IS NOT NULL
)
SELECT canonical_phone, count(*) AS profiles, array_agg(id ORDER BY id) AS profile_ids
FROM normalized
WHERE canonical_phone IS NOT NULL
GROUP BY canonical_phone
HAVING count(*) > 1;

-- 2. Legacy M-Pesa web references AND new mpesa_transaction_id values that
-- would collide in the shared unique index. JSON access allows this query to
-- run before the new column exists; missing values are treated as NULL.
WITH normalized AS (
  SELECT c.id,
    upper(COALESCE(NULLIF(btrim(to_jsonb(c)->>'mpesa_transaction_id'), ''),
      CASE WHEN c.method = 'mpesa' THEN NULLIF(btrim(c.reference), '') END)) AS canonical_ref
  FROM public.contributions c
)
SELECT canonical_ref, count(*) AS contributions,
       array_agg(id ORDER BY id) AS contribution_ids
FROM normalized
WHERE canonical_ref IS NOT NULL
GROUP BY canonical_ref
HAVING count(*) > 1;

-- 3. Records that cannot acquire a foreign key to public.profiles.
SELECT 'user_roles' AS source_table, r.id AS record_id, r.user_id AS member_id
FROM public.user_roles r LEFT JOIN public.profiles p ON p.id = r.user_id
WHERE p.id IS NULL
UNION ALL
SELECT 'contributions', c.id, c.member_id
FROM public.contributions c LEFT JOIN public.profiles p ON p.id = c.member_id
WHERE p.id IS NULL
UNION ALL
SELECT 'loans', l.id, l.member_id
FROM public.loans l LEFT JOIN public.profiles p ON p.id = l.member_id
WHERE p.id IS NULL;
