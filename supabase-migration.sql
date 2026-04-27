-- DeepWork v2: Requirements → Parallel Agent Submissions
-- Run this in Supabase SQL Editor

-- Projects (replaces rooms)
create table if not exists projects (
  id text primary key,
  name text not null default 'Untitled Project',
  created_at timestamptz default now() not null
);

-- Agents (autonomous workers connected to a project)
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  role_description text not null default '',
  status text not null default 'idle',  -- 'idle' | 'working'
  last_seen_at timestamptz default now() not null,
  created_at timestamptz default now() not null
);

-- Requirements (what panel users broadcast)
create table if not exists requirements (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  content text not null,
  posted_by text not null default 'Panel',
  created_at timestamptz default now() not null
);

-- Submissions (each agent's result for a requirement)
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  requirement_id uuid not null references requirements(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  html_content text not null,
  summary text not null default '',
  created_at timestamptz default now() not null
);

-- Enable Realtime on the tables agents need to listen to
alter publication supabase_realtime add table requirements;
alter publication supabase_realtime add table submissions;
alter publication supabase_realtime add table agents;
