-- Rooms
create table if not exists rooms (
  id text primary key,
  created_at timestamptz default now() not null,
  status text default 'collecting' not null,
  constraint rooms_status_check check (status in ('collecting', 'synthesizing', 'done'))
);

-- Participants
create table if not exists participants (
  id uuid default gen_random_uuid() primary key,
  room_id text not null references rooms(id) on delete cascade,
  name text not null,
  role text not null,
  color text not null,
  joined_at timestamptz default now() not null,
  constraint participants_role_check check (
    role in ('designer', 'copywriter', 'developer', 'product', 'marketing', 'employee')
  )
);

-- Intents
create table if not exists intents (
  id uuid default gen_random_uuid() primary key,
  room_id text not null references rooms(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  section text default '整体' not null,
  content text not null,
  created_at timestamptz default now() not null
);

alter table intents add column if not exists section text default '整体' not null;

-- Room sections
create table if not exists room_sections (
  id uuid default gen_random_uuid() primary key,
  room_id text not null references rooms(id) on delete cascade,
  name text not null,
  created_by uuid references participants(id) on delete set null,
  created_at timestamptz default now() not null,
  constraint room_sections_unique_name unique (room_id, name)
);

-- Synthesis results
create table if not exists synthesis_results (
  id uuid default gen_random_uuid() primary key,
  room_id text not null references rooms(id) on delete cascade,
  round integer default 1 not null,
  html_content text not null,
  attribution_map jsonb,
  conflicts_resolved text[],
  created_at timestamptz default now() not null
);

-- Row Level Security (open for hackathon demo — no auth needed)
alter table rooms enable row level security;
alter table participants enable row level security;
alter table intents enable row level security;
alter table room_sections enable row level security;
alter table synthesis_results enable row level security;

create policy "allow all on rooms" on rooms for all using (true) with check (true);
create policy "allow all on participants" on participants for all using (true) with check (true);
create policy "allow all on intents" on intents for all using (true) with check (true);
create policy "allow all on room_sections" on room_sections for all using (true) with check (true);
create policy "allow all on synthesis_results" on synthesis_results for all using (true) with check (true);

-- Enable realtime for live intent feed
alter publication supabase_realtime add table intents;
alter publication supabase_realtime add table room_sections;
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table synthesis_results;
