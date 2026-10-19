-- HarvestLink BUILD database. Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again: it only creates what is missing.
-- Design: the public (anon key) can only READ consented, active listings and farmer display details.
-- Everything private (phone numbers, real names, buyer answers, follow-ups) is readable ONLY by coordinators.

create extension if not exists pgcrypto;

-- ---------- Coordinators ----------
create table if not exists public.coordinators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.coordinators enable row level security;   -- no policies: not reachable from the API

create or replace function public.is_coordinator()
returns boolean
language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.coordinators where user_id = auth.uid()); $$;

revoke all on function public.is_coordinator() from public;
grant execute on function public.is_coordinator() to anon, authenticated;

-- ---------- Farmers (public part) ----------
create table if not exists public.farmers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- F1, F2 ... used in all exports instead of names
  display_name text not null,                -- what buyers see; use a label if the farmer prefers (e.g. "Farm near Techiman")
  farm text,
  town text,
  region text,
  since int,
  bio text,
  consent_given boolean not null default false,
  consent_note text,                         -- who gave consent, how, and when (no ID numbers)
  created_at timestamptz not null default now()
);

-- Farmers (private part): only coordinators
create table if not exists public.farmer_private (
  farmer_id uuid primary key references public.farmers(id) on delete cascade,
  full_name text,
  phone text
);

-- ---------- Listings ----------
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references public.farmers(id) on delete cascade,
  variety text not null,
  crates int not null check (crates > 0 and crates <= 100000),
  price numeric not null check (price > 0 and price <= 100000),
  ready date not null,
  notes text check (char_length(notes) <= 500),
  status text not null default 'active' check (status in ('active','sold','withdrawn')),
  posted_by text not null default 'coordinator' check (posted_by in ('coordinator','farmer','phone')),
  created_at timestamptz not null default now()
);
create index if not exists listings_farmer_idx on public.listings(farmer_id);

-- ---------- Buyers (private) ----------
create table if not exists public.buyers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- B1, B2 ...
  kind text check (kind in ('trader','market woman','wholesaler','retailer','processor','other')),
  town text,
  full_name text,
  phone text,
  consent_given boolean not null default false,
  consent_note text,
  created_at timestamptz not null default now()
);

-- ---------- Buyer answers (private) ----------
create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  answer text not null check (answer in ('committed','maybe','declined')),
  crates int check (crates is null or crates > 0),
  price numeric check (price is null or price > 0),
  needed_on date,
  reason text check (char_length(reason) <= 500),   -- in the buyer's own words
  created_at timestamptz not null default now()
);
create index if not exists responses_listing_idx on public.responses(listing_id);

-- ---------- Follow-up on the ready date (private) ----------
create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  harvested_on date,
  on_time boolean,                           -- harvested within 3 days of the posted date
  days_off int,
  sold_crates int check (sold_crates is null or sold_crates >= 0),
  rejected_crates int check (rejected_crates is null or rejected_crates >= 0),
  cheap_crates int check (cheap_crates is null or cheap_crates >= 0),
  would_use_again text check (char_length(would_use_again) <= 500),
  change_wanted text check (char_length(change_wanted) <= 500),
  created_at timestamptz not null default now()
);

-- ---------- Buyer requests sent from the public website form ----------
create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_name text not null check (char_length(buyer_name) between 1 and 80),
  crates int not null check (crates between 1 and 10000),
  message text check (char_length(message) <= 300),
  handled boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Row level security ----------
alter table public.farmers        enable row level security;
alter table public.farmer_private enable row level security;
alter table public.listings       enable row level security;
alter table public.buyers         enable row level security;
alter table public.responses      enable row level security;
alter table public.follow_ups     enable row level security;
alter table public.enquiries      enable row level security;

drop policy if exists farmers_public_read   on public.farmers;
drop policy if exists farmers_coord_all     on public.farmers;
create policy farmers_public_read on public.farmers for select to anon, authenticated using (consent_given);
create policy farmers_coord_all   on public.farmers for all to authenticated using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists farmer_private_coord on public.farmer_private;
create policy farmer_private_coord on public.farmer_private for all to authenticated using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists listings_public_read on public.listings;
drop policy if exists listings_coord_all   on public.listings;
create policy listings_public_read on public.listings for select to anon, authenticated
  using (status = 'active' and exists (select 1 from public.farmers f where f.id = listings.farmer_id and f.consent_given));
create policy listings_coord_all on public.listings for all to authenticated using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists buyers_coord on public.buyers;
create policy buyers_coord on public.buyers for all to authenticated using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists responses_coord on public.responses;
create policy responses_coord on public.responses for all to authenticated using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists follow_ups_coord on public.follow_ups;
create policy follow_ups_coord on public.follow_ups for all to authenticated using (public.is_coordinator()) with check (public.is_coordinator());

drop policy if exists enquiries_public_insert on public.enquiries;
drop policy if exists enquiries_coord_all     on public.enquiries;
create policy enquiries_public_insert on public.enquiries for insert to anon, authenticated with check (true);
create policy enquiries_coord_all     on public.enquiries for all to authenticated using (public.is_coordinator()) with check (public.is_coordinator());

-- ---------- Explicit privileges ----------
revoke all on all tables in schema public from anon;
grant select on public.farmers, public.listings to anon;
grant insert on public.enquiries to anon;
grant select, insert, update, delete on public.farmers, public.farmer_private, public.listings, public.buyers,
      public.responses, public.follow_ups, public.enquiries to authenticated;

-- ---------- After running: add yourself as a coordinator ----------
-- 1. Authentication > Users > Add user (email + password). Tick "Auto Confirm User".
-- 2. Authentication > Sign In / Providers > turn OFF "Allow new users to sign up".
-- 3. Run this with the coordinator's email, then repeat for any other coordinator:
--    insert into public.coordinators (user_id) select id from auth.users where email = 'coordinator@example.com';
