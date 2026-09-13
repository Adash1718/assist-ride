-- Assist Ride — initial schema (SPEC.md §2)
-- Run this once in your Supabase project's SQL Editor (Dashboard → SQL Editor → New query).
-- One row per auth user in EITHER rider_profiles or driver_profiles (a user
-- is one role for now — multi-role accounts are future work, see SPEC.md §2.1).

-- ---------------------------------------------------------------------------
-- Rider profiles
-- ---------------------------------------------------------------------------
create table if not exists public.rider_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  -- nullable/defaulted: a bare row is created right after sign-up (before
  -- the create-profile form is submitted) so emergency/medical contacts
  -- have something to reference from the start.
  full_name text not null default '',
  date_of_birth date,
  phone text not null default '',
  photo_url text,
  mobility_aid text not null default 'None',
  foldable text not null default 'Yes',
  communication_needs text[] not null default '{}',
  assistance_needs text[] not null default '{}',
  standing_notes text not null default '',
  id_description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.rider_profiles(id) on delete cascade,
  name text not null,
  phone text not null,
  address text not null default '',
  email text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.medical_contacts (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.rider_profiles(id) on delete cascade,
  name text not null,
  phone text not null,
  address text not null default '',
  email text not null default '',
  specialty text not null default '',
  hospital text not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Driver profiles
-- ---------------------------------------------------------------------------
create table if not exists public.driver_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  date_of_birth date,
  phone text not null default '',
  license_number text not null default '',
  vehicle text not null default '',
  plate text not null default '',
  ramp_equipped text not null default 'Yes',
  capability_tags text[] not null default '{}',
  companion_seats int not null default 3,
  verification_answers jsonb not null default '{}',
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ride requests (schema only for now — booking screens aren't wired to this
-- yet; see SPEC.md §2.4. Included so the schema matches the full spec.)
-- ---------------------------------------------------------------------------
create table if not exists public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  rider_id uuid not null references public.rider_profiles(id) on delete cascade,
  companion_count int not null default 0,
  pickup text not null,
  dropoff text not null,
  ride_mode text not null default 'on_demand' check (ride_mode in ('on_demand', 'scheduled')),
  requested_time timestamptz not null default now(),
  ride_notes text not null default '',
  needs_snapshot jsonb not null default '{}',
  status text not null default 'requested'
    check (status in ('requested', 'matched', 'driver_en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show')),
  matched_driver_id uuid references public.driver_profiles(id),
  pin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security — everyone can only touch their own rows.
-- ---------------------------------------------------------------------------
alter table public.rider_profiles enable row level security;
alter table public.emergency_contacts enable row level security;
alter table public.medical_contacts enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.ride_requests enable row level security;

create policy "rider reads own profile" on public.rider_profiles
  for select using (auth.uid() = id);
create policy "rider writes own profile" on public.rider_profiles
  for insert with check (auth.uid() = id);
create policy "rider updates own profile" on public.rider_profiles
  for update using (auth.uid() = id);

create policy "rider reads own emergency contacts" on public.emergency_contacts
  for select using (rider_id = auth.uid());
create policy "rider writes own emergency contacts" on public.emergency_contacts
  for insert with check (rider_id = auth.uid());
create policy "rider deletes own emergency contacts" on public.emergency_contacts
  for delete using (rider_id = auth.uid());

create policy "rider reads own medical contacts" on public.medical_contacts
  for select using (rider_id = auth.uid());
create policy "rider writes own medical contacts" on public.medical_contacts
  for insert with check (rider_id = auth.uid());
create policy "rider deletes own medical contacts" on public.medical_contacts
  for delete using (rider_id = auth.uid());

create policy "driver reads own profile" on public.driver_profiles
  for select using (auth.uid() = id);
create policy "driver writes own profile" on public.driver_profiles
  for insert with check (auth.uid() = id);
create policy "driver updates own profile" on public.driver_profiles
  for update using (auth.uid() = id);

create policy "rider reads own ride requests" on public.ride_requests
  for select using (requested_by = auth.uid());
create policy "rider writes own ride requests" on public.ride_requests
  for insert with check (requested_by = auth.uid());
create policy "rider updates own ride requests" on public.ride_requests
  for update using (requested_by = auth.uid());
