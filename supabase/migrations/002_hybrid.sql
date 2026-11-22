-- Galaxy-Memory 002: dedup/pin/archive columns + diacritic-insensitive
-- hybrid search (FTS + vector, Reciprocal Rank Fusion). Idempotent.

alter table public.memories
  add column if not exists content_hash text,
  add column if not exists pinned boolean not null default false,
  add column if not exists archived boolean not null default false;

create index if not exists memories_content_hash_idx on public.memories (content_hash);
create index if not exists memories_archived_idx on public.memories (archived) where archived;

-- ---------------------------------------------------------------------------
-- diacritic-insensitive FTS: unaccent + generated tsvector over title+content.
-- 'simple' config keeps language-agnostic tokens (Czech + English both fold
-- cleanly through unaccent); generated column requires an IMMUTABLE wrapper.
-- ---------------------------------------------------------------------------
create extension if not exists unaccent;

create or replace function public.f_unaccent(input text)
returns text
language sql
immutable
strict
parallel safe
as $$ select public.unaccent('public.unaccent'::regdictionary, input) $$;

alter table public.memories
  add column if not exists search_doc tsvector
  generated always as (
    to_tsvector('simple', public.f_unaccent(coalesce(title, '') || ' ' || coalesce(content, '')))
  ) stored;

create index if not exists memories_search_idx on public.memories using gin (search_doc);

-- ---------------------------------------------------------------------------
-- match_memories (001): identical signature, now skips archived rows.
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
    and not m.archived
    and (filter_cluster is null or m.cluster = filter_cluster)
    and 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- hybrid_search: RRF over pgvector cosine rank + ts_rank FTS rank, then
-- mild recency decay and a pin multiplier — mirrors packages/shared/search.ts.
-- Pass query_embedding = null for keyword-only search (embedder offline).
-- ---------------------------------------------------------------------------
create or replace function public.hybrid_search(
  query_embedding vector(1536),
  fts_query text,
  match_count int,
  filter_cluster text default null
)
returns table (
  id           uuid,
  title        text,
  content      text,
  summary      text,
  cluster      text,
  tags         text[],
  source       text,
  pinned       boolean,
  archived     boolean,
  content_hash text,
  created_at   timestamptz,
  updated_at   timestamptz,
  similarity   float,
  via          text
)
language sql
stable
as $$
with vec as (
  select m.id,
         row_number() over (order by m.embedding <=> query_embedding) as r
  from public.memories m
  where query_embedding is not null
    and m.embedding is not null
    and not m.archived
    and (filter_cluster is null or m.cluster = filter_cluster)
  limit match_count * 4
),
fts as (
  select m.id,
         row_number() over (order by ts_rank(m.search_doc, q.q) desc) as r
  from public.memories m
  cross join (select websearch_to_tsquery('simple', public.f_unaccent(fts_query)) as q) q
  where fts_query is not null
    and fts_query <> ''
    and m.search_doc @@ q.q
    and not m.archived
    and (filter_cluster is null or m.cluster = filter_cluster)
  limit match_count * 4
),
fused as (
  select coalesce(v.id, f.id) as id,
         coalesce(1.0 / (60 + v.r), 0) + coalesce(1.0 / (60 + f.r), 0) as rrf,
         (v.id is not null and f.id is not null) as both_hit,
         (v.id is not null) as vec_hit
  from vec v
  full join fts f on v.id = f.id
)
select
  m.id,
  m.title,
  m.content,
  m.summary,
  m.cluster,
  m.tags,
  m.source,
  m.pinned,
  m.archived,
  m.content_hash,
  m.created_at,
  m.updated_at,
  (f.rrf
    * (1 + 0.1 * exp(-extract(epoch from now() - m.updated_at) / 2592000.0))
    * case when m.pinned then 1.5 else 1 end)::float as similarity,
  case when f.both_hit then 'both' when f.vec_hit then 'vector' else 'fts' end as via
from fused f
join public.memories m on m.id = f.id
order by similarity desc
limit match_count;
$$;
