-- Galaxy-Memory 001: core schema
-- PostgreSQL + pgvector. Apply with `supabase db push` or paste into the SQL editor.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- memories: one row per note. `embedding` is text-embedding-3-small sized.
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null,                      -- markdown
  summary     text,                               -- 1-sentence, 3D tooltips
  cluster     text not null default 'General',    -- Projects / Architecture / Reference / Ideas / Logs / ...
  tags        text[] not null default '{}',
  embedding   vector(1536),
  source      text not null default 'user' check (source in ('user', 'ai_agent')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- memory_edges: explicit = resolved [[wikilinks]] (weight 1.0),
--               semantic = vector similarity (weight = similarity).
-- ---------------------------------------------------------------------------
create table if not exists public.memory_edges (
  id         uuid primary key default gen_random_uuid(),
  source_id  uuid not null references public.memories (id) on delete cascade,
  target_id  uuid not null references public.memories (id) on delete cascade,
  edge_type  text not null check (edge_type in ('explicit', 'semantic')),
  weight     float not null default 1.0 check (weight >= 0.0 and weight <= 1.0),
  created_at timestamptz not null default now(),
  unique (source_id, target_id, edge_type)
);

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index if not exists memories_embedding_hnsw_idx
  on public.memories using hnsw (embedding vector_cosine_ops);

create index if not exists memories_cluster_idx on public.memories (cluster);
create index if not exists memory_edges_source_idx on public.memory_edges (source_id);
create index if not exists memory_edges_target_idx on public.memory_edges (target_id);

-- keep updated_at honest on every write
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists memories_set_updated_at on public.memories;
create trigger memories_set_updated_at
  before update on public.memories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- match_memories: cosine-ranked neighbors via the HNSW index.
-- similarity = 1 - cosine distance.
-- ---------------------------------------------------------------------------
create or replace function public.match_memories(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_cluster text default null
)
returns table (
  id          uuid,
  title       text,
  content     text,
  summary     text,
  cluster     text,
  tags        text[],
  source      text,
  created_at  timestamptz,
  updated_at  timestamptz,
  similarity  float
)
language sql
stable
as $$
  select
    m.id,
    m.title,
    m.content,
    m.summary,
    m.cluster,
    m.tags,
    m.source,
    m.created_at,
    m.updated_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.embedding is not null
    and (filter_cluster is null or m.cluster = filter_cluster)
    and 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- RLS is intentionally left off: this schema assumes a single-user
-- self-hosted deployment behind the service/anon keys. Enable and add
-- policies before exposing it to multiple users.

-- ---------------------------------------------------------------------------
-- realtime: web UI live-syncs when the MCP server (or any writer) changes
-- memories/edges. Remove these two lines if you don't want the publication.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.memories;
alter publication supabase_realtime add table public.memory_edges;
