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

create table if not exists public.platform_capacity_snapshots (
  id text primary key,
  snapshot_day date not null unique,
  generated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_capacity_alerts (
  id text primary key,
  metric_key text not null,
  severity text not null default 'warning',
  utilization numeric not null default 0,
  observed_at timestamptz not null default now(),
  status text not null default 'open',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_usage_events (
  id text primary key,
  provider text,
  metric_key text not null,
  value numeric not null default 0,
  units text,
  observed_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'partner_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.partner_type as enum ('fleet_owner', 'hotel_partner');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'approval_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.approval_status as enum ('pending', 'approved', 'rejected');
  end if;
end
$$;

create table if not exists public.b2b_partners (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  business_name varchar(255) not null,
  type public.partner_type not null,
  gst_number varchar(15),
  contact_person varchar(150) not null,
  phone varchar(15) not null,
  email varchar(255) not null,
  document_url text not null,
  signup_latitude numeric(10, 7),
  signup_longitude numeric(10, 7),
  commission_percentage numeric(5, 2) not null default 0.00,
  razorpay_linked_account_id varchar(100),
  status public.approval_status not null default 'pending',
  verified_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_bookings (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.b2b_partners(id) on delete cascade,
  ride_id uuid,
  total_fare numeric(10, 2) not null,
  partner_cut numeric(10, 2) not null,
  driver_cut numeric(10, 2) not null,
  settlement_status varchar(50) not null default 'pending',
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

drop trigger if exists platform_capacity_snapshots_set_updated_at on public.platform_capacity_snapshots;
create trigger platform_capacity_snapshots_set_updated_at before update on public.platform_capacity_snapshots
for each row execute procedure public.set_updated_at();

drop trigger if exists platform_capacity_alerts_set_updated_at on public.platform_capacity_alerts;
create trigger platform_capacity_alerts_set_updated_at before update on public.platform_capacity_alerts
for each row execute procedure public.set_updated_at();

drop trigger if exists platform_usage_events_set_updated_at on public.platform_usage_events;
create trigger platform_usage_events_set_updated_at before update on public.platform_usage_events
for each row execute procedure public.set_updated_at();

drop trigger if exists b2b_partners_set_updated_at on public.b2b_partners;
create trigger b2b_partners_set_updated_at before update on public.b2b_partners
for each row execute procedure public.set_updated_at();

drop trigger if exists partner_bookings_set_updated_at on public.partner_bookings;
create trigger partner_bookings_set_updated_at before update on public.partner_bookings
for each row execute procedure public.set_updated_at();

alter table public.users enable row level security;
alter table public.app_config enable row level security;
alter table public.rides enable row level security;
alter table public.bookings enable row level security;
alter table public.transactions enable row level security;
alter table public.referrals enable row level security;
alter table public.support_tickets enable row level security;
alter table public.otp_sessions enable row level security;
alter table public.platform_capacity_snapshots enable row level security;
alter table public.platform_capacity_alerts enable row level security;
alter table public.platform_usage_events enable row level security;
alter table public.b2b_partners enable row level security;
alter table public.partner_bookings enable row level security;

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

drop policy if exists "authenticated users can read capacity snapshots" on public.platform_capacity_snapshots;
create policy "authenticated users can read capacity snapshots"
on public.platform_capacity_snapshots for select
to authenticated
using (true);

drop policy if exists "authenticated users can read capacity alerts" on public.platform_capacity_alerts;
create policy "authenticated users can read capacity alerts"
on public.platform_capacity_alerts for select
to authenticated
using (true);

drop policy if exists "authenticated users can read usage events" on public.platform_usage_events;
create policy "authenticated users can read usage events"
on public.platform_usage_events for select
to authenticated
using (true);

drop policy if exists "partners can read own partner profile" on public.b2b_partners;
create policy "partners can read own partner profile"
on public.b2b_partners for select
to authenticated
using (auth.uid() = auth_user_id);

drop policy if exists "partners can create own partner profile" on public.b2b_partners;
create policy "partners can create own partner profile"
on public.b2b_partners for insert
to anon, authenticated
with check (auth_user_id is null or auth.uid() = auth_user_id);

drop policy if exists "partners can update own pending partner profile" on public.b2b_partners;
create policy "partners can update own pending partner profile"
on public.b2b_partners for update
to authenticated
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

drop policy if exists "admins can read partner profiles" on public.b2b_partners;
create policy "admins can read partner profiles"
on public.b2b_partners for select
to authenticated
using (
  exists (
    select 1
    from public.users admin_user
    where admin_user.id = auth.uid()::text
      and admin_user.role = 'admin'
  )
);

drop policy if exists "admins can update partner profiles" on public.b2b_partners;
create policy "admins can update partner profiles"
on public.b2b_partners for update
to authenticated
using (
  exists (
    select 1
    from public.users admin_user
    where admin_user.id = auth.uid()::text
      and admin_user.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.users admin_user
    where admin_user.id = auth.uid()::text
      and admin_user.role = 'admin'
  )
);

drop policy if exists "partners can read own partner bookings" on public.partner_bookings;
create policy "partners can read own partner bookings"
on public.partner_bookings for select
to authenticated
using (
  exists (
    select 1
    from public.b2b_partners partner
    where partner.id = partner_bookings.partner_id
      and partner.auth_user_id = auth.uid()
  )
);

drop policy if exists "partners can create own partner bookings" on public.partner_bookings;
create policy "partners can create own partner bookings"
on public.partner_bookings for insert
to authenticated
with check (
  exists (
    select 1
    from public.b2b_partners partner
    where partner.id = partner_bookings.partner_id
      and partner.auth_user_id = auth.uid()
  )
);

drop policy if exists "admins can read partner bookings" on public.partner_bookings;
create policy "admins can read partner bookings"
on public.partner_bookings for select
to authenticated
using (
  exists (
    select 1
    from public.users admin_user
    where admin_user.id = auth.uid()::text
      and admin_user.role = 'admin'
  )
);

drop policy if exists "admins can manage partner bookings" on public.partner_bookings;
create policy "admins can manage partner bookings"
on public.partner_bookings for all
to authenticated
using (
  exists (
    select 1
    from public.users admin_user
    where admin_user.id = auth.uid()::text
      and admin_user.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.users admin_user
    where admin_user.id = auth.uid()::text
      and admin_user.role = 'admin'
  )
);

create index if not exists idx_capacity_snapshots_day on public.platform_capacity_snapshots(snapshot_day);
create index if not exists idx_capacity_alerts_observed on public.platform_capacity_alerts(observed_at desc);
create index if not exists idx_capacity_alerts_metric on public.platform_capacity_alerts(metric_key);
create index if not exists idx_platform_usage_events_observed on public.platform_usage_events(observed_at desc);
create index if not exists idx_b2b_partners_auth_user_id on public.b2b_partners(auth_user_id);
create index if not exists idx_b2b_partners_type on public.b2b_partners(type);
create index if not exists idx_b2b_partners_status on public.b2b_partners(status);
create unique index if not exists idx_b2b_partners_email on public.b2b_partners(lower(email));
create index if not exists idx_partner_bookings_partner_id on public.partner_bookings(partner_id);
create index if not exists idx_partner_bookings_ride_id on public.partner_bookings(ride_id);
create index if not exists idx_partner_bookings_settlement_status on public.partner_bookings(settlement_status);
