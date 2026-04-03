create extension if not exists "pgcrypto";

create table if not exists public.users (
  id text primary key,
  uid text generated always as (id) stored,
  email text unique,
  display_name text,
  role text not null default 'consumer',
  status text not null default 'active',
  phone_number text,
  photo_url text,
  onboarding_complete boolean not null default false,
  admin_role text,
  verification_status text,
  rejection_reason text,
  verified_by text,
  referral_code text unique,
  referred_by text,
  referral_path jsonb not null default '[]'::jsonb,
  force_password_change boolean not null default false,
  wallet jsonb,
  location jsonb,
  driver_details jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_config (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rides (
  id text primary key,
  driver_id text not null,
  status text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id text primary key,
  ride_id text,
  consumer_id text,
  driver_id text,
  status text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id text primary key,
  user_id text,
  type text,
  status text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id text primary key,
  referrer_id text,
  referred_id text,
  status text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id text primary key,
  user_id text,
  status text,
  priority text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.otp_sessions (
  id text primary key,
  channel text not null,
  recipient text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
for each row execute procedure public.set_updated_at();

drop trigger if exists app_config_set_updated_at on public.app_config;
create trigger app_config_set_updated_at before update on public.app_config
for each row execute procedure public.set_updated_at();

drop trigger if exists rides_set_updated_at on public.rides;
create trigger rides_set_updated_at before update on public.rides
for each row execute procedure public.set_updated_at();

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at before update on public.bookings
for each row execute procedure public.set_updated_at();

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at before update on public.transactions
for each row execute procedure public.set_updated_at();

drop trigger if exists referrals_set_updated_at on public.referrals;
create trigger referrals_set_updated_at before update on public.referrals
for each row execute procedure public.set_updated_at();

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at before update on public.support_tickets
for each row execute procedure public.set_updated_at();

drop trigger if exists otp_sessions_set_updated_at on public.otp_sessions;
create trigger otp_sessions_set_updated_at before update on public.otp_sessions
for each row execute procedure public.set_updated_at();

alter table public.users enable row level security;
alter table public.app_config enable row level security;
alter table public.rides enable row level security;
alter table public.bookings enable row level security;
alter table public.transactions enable row level security;
alter table public.referrals enable row level security;
alter table public.support_tickets enable row level security;
alter table public.otp_sessions enable row level security;

drop policy if exists "authenticated users can read users" on public.users;
create policy "authenticated users can read users"
on public.users for select
to authenticated
using (true);

drop policy if exists "users can update own row" on public.users;
create policy "users can update own row"
on public.users for update
to authenticated
using (auth.uid()::text = id)
with check (auth.uid()::text = id);

drop policy if exists "authenticated users can insert own row" on public.users;
create policy "authenticated users can insert own row"
on public.users for insert
to authenticated
with check (auth.uid()::text = id);

drop policy if exists "authenticated users can read app config" on public.app_config;
create policy "authenticated users can read app config"
on public.app_config for select
to authenticated
using (true);

drop policy if exists "authenticated users can read rides" on public.rides;
create policy "authenticated users can read rides"
on public.rides for select
to authenticated
using (true);

drop policy if exists "drivers can manage own rides" on public.rides;
create policy "drivers can manage own rides"
on public.rides for all
to authenticated
using ((data->>'driverId') = auth.uid()::text or driver_id = auth.uid()::text)
with check ((data->>'driverId') = auth.uid()::text or driver_id = auth.uid()::text);

drop policy if exists "authenticated users can read bookings" on public.bookings;
create policy "authenticated users can read bookings"
on public.bookings for select
to authenticated
using (true);

drop policy if exists "authenticated users can create bookings" on public.bookings;
create policy "authenticated users can create bookings"
on public.bookings for insert
to authenticated
with check (true);

drop policy if exists "participants can update bookings" on public.bookings;
create policy "participants can update bookings"
on public.bookings for update
to authenticated
using (
  consumer_id = auth.uid()::text
  or driver_id = auth.uid()::text
  or (data->>'consumerId') = auth.uid()::text
  or (data->>'driverId') = auth.uid()::text
)
with check (
  consumer_id = auth.uid()::text
  or driver_id = auth.uid()::text
  or (data->>'consumerId') = auth.uid()::text
  or (data->>'driverId') = auth.uid()::text
);

drop policy if exists "users can read own transactions" on public.transactions;
create policy "users can read own transactions"
on public.transactions for select
to authenticated
using (user_id = auth.uid()::text or (data->>'userId') = auth.uid()::text);

drop policy if exists "authenticated users can insert transactions" on public.transactions;
create policy "authenticated users can insert transactions"
on public.transactions for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can read referrals" on public.referrals;
create policy "authenticated users can read referrals"
on public.referrals for select
to authenticated
using (
  referrer_id = auth.uid()::text
  or referred_id = auth.uid()::text
  or (data->>'referrerId') = auth.uid()::text
  or (data->>'referredId') = auth.uid()::text
);

drop policy if exists "authenticated users can insert referrals" on public.referrals;
create policy "authenticated users can insert referrals"
on public.referrals for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update referrals" on public.referrals;
create policy "authenticated users can update referrals"
on public.referrals for update
to authenticated
using (true)
with check (true);

drop policy if exists "users can read related support tickets" on public.support_tickets;
create policy "users can read related support tickets"
on public.support_tickets for select
to authenticated
using (user_id = auth.uid()::text or (data->>'userId') = auth.uid()::text);

drop policy if exists "authenticated users can create support tickets" on public.support_tickets;
create policy "authenticated users can create support tickets"
on public.support_tickets for insert
to authenticated
with check ((data->>'userId') = auth.uid()::text or user_id = auth.uid()::text);

drop policy if exists "authenticated users can update own support tickets" on public.support_tickets;
create policy "authenticated users can update own support tickets"
on public.support_tickets for update
to authenticated
using (user_id = auth.uid()::text or (data->>'userId') = auth.uid()::text)
with check (user_id = auth.uid()::text or (data->>'userId') = auth.uid()::text);
