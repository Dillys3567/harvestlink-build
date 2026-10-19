-- HarvestLink BUILD database, part 2. Run this AFTER schema.sql: SQL Editor > New query > paste > Run.
-- Safe to run again: it only adds what is missing.
-- What it adds:
--   1. Buyer requests from the public form now carry the buyer's phone number, what they intend (commit or just
--      asking) and their own consent to be called. The database refuses a request without consent and phone.
--   2. A log of every attempt a farmer makes on the phone simulation (finished or not, time taken, wrong keys).
--      The public page can only ADD to this log. Only coordinators can read it.

-- ---------- 1. Buyer requests ----------
alter table public.enquiries add column if not exists buyer_phone text
  check (buyer_phone is null or char_length(buyer_phone) between 9 and 20);
alter table public.enquiries add column if not exists intent text
  check (intent is null or intent in ('commit','info'));
alter table public.enquiries add column if not exists contact_consent boolean not null default false;

drop policy if exists enquiries_public_insert on public.enquiries;
create policy enquiries_public_insert on public.enquiries for insert to anon, authenticated
  with check (
    contact_consent
    and buyer_phone is not null
    and exists (   -- only for a harvest that is publicly listed (RLS on listings and farmers applies inside this check)
      select 1 from public.listings l where l.id = enquiries.listing_id and l.status = 'active'
    )
  );

-- ---------- 2. Phone simulation log ----------
create table if not exists public.phone_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  farmer_code text check (farmer_code is null or char_length(farmer_code) <= 12),   -- typed by the coordinator, e.g. F1
  channel text not null check (channel in ('ussd','voice')),
  duration_s int not null check (duration_s between 0 and 7200),
  reached_post boolean not null default false,        -- opened the "post a harvest" steps
  completed boolean not null default false,           -- pressed confirm
  invalid_count int not null default 0 check (invalid_count between 0 and 1000),   -- wrong keys
  back_count int not null default 0 check (back_count between 0 and 1000),
  steps text check (char_length(steps) <= 200),       -- screens visited, e.g. main>var>crates>price
  variety text check (char_length(variety) <= 40),
  crates int check (crates is null or (crates > 0 and crates <= 100000)),
  price numeric check (price is null or (price > 0 and price <= 100000)),
  ready date,
  note text check (char_length(note) <= 500),         -- coordinator: what they said, where they got stuck
  listing_id uuid references public.listings(id) on delete set null,   -- set when the coordinator turns it into a listing
  check (not completed or (variety is not null and crates is not null and price is not null and ready is not null))
);
create index if not exists phone_sessions_created_idx on public.phone_sessions(created_at);

alter table public.phone_sessions enable row level security;
drop policy if exists phone_sessions_public_insert on public.phone_sessions;
drop policy if exists phone_sessions_coord_all     on public.phone_sessions;
create policy phone_sessions_public_insert on public.phone_sessions for insert to anon, authenticated
  with check (note is null and listing_id is null);
create policy phone_sessions_coord_all on public.phone_sessions for all to authenticated
  using (public.is_coordinator()) with check (public.is_coordinator());

revoke all on public.phone_sessions from anon;
grant insert on public.phone_sessions to anon;
grant select, insert, update, delete on public.phone_sessions to authenticated;
