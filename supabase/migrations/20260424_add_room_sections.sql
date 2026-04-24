create table if not exists room_sections (
  id uuid default gen_random_uuid() primary key,
  room_id text not null references rooms(id) on delete cascade,
  name text not null,
  created_by uuid references participants(id) on delete set null,
  created_at timestamptz default now() not null,
  constraint room_sections_unique_name unique (room_id, name)
);

alter publication supabase_realtime add table room_sections;
