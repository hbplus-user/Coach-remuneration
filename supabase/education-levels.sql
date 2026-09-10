-- ---------------------------------------------------------------------
-- Education master: moves the education scoring matrix out of the code
-- and into two tables HR / Super Admin can edit in the app.
--
--   education_formats  — how a qualification was studied
--   education_levels   — the points a qualification + format pair carries
--
-- Safe to run on an existing project: it creates the tables, enables the
-- same domain-gated RLS every other table uses, and seeds the rows the
-- app previously hardcoded. Re-running it changes nothing.
--
--   Supabase dashboard -> SQL Editor -> paste -> Run
-- ---------------------------------------------------------------------

-- 1. Study formats. `id` is the value coach records already store, so it
--    is fixed at creation; only the label is meant to change later.
create table if not exists public.education_formats (
  id          text primary key,                        -- "offline_india"
  label       text not null,                           -- "Offline — India"
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.education_formats (id, label) values
  ('offline_india',   'Offline — India'),
  ('online_global',   'Online — Global / India'),
  ('offline_outside', 'Offline — Outside India')
on conflict (id) do nothing;

-- 2. The scoring matrix. One row per qualification + format pair.
--    The format is a foreign key rather than a frozen check list, so HR
--    can add a format in the app without a migration. `on delete restrict`
--    stops a format disappearing out from under rows that still use it.
create table if not exists public.education_levels (
  id             text primary key,                     -- "ED07"
  qualification  text not null,                        -- "PhD (Doctorate)"
  format         text not null
                 references public.education_formats(id)
                 on update cascade on delete restrict,
  score          numeric(4,2) not null check (score >= 0 and score <= 10),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- a qualification/format pair carries exactly one score
  unique (qualification, format)
);

insert into public.education_levels (id, qualification, format, score) values
  ('ED01', '3-Year Bachelor''s',                'online_global',   1.0),
  ('ED02', '3-Year Bachelor''s',                'offline_india',   3.0),
  ('ED03', '3-Year Bachelor''s',                'offline_outside', 5.0),
  ('ED04', '4/5-Year Professional Bachelor''s', 'online_global',   1.5),
  ('ED05', '4/5-Year Professional Bachelor''s', 'offline_india',   3.5),
  ('ED06', '4/5-Year Professional Bachelor''s', 'offline_outside', 5.5),
  ('ED07', 'Post-Grad / Master''s / CA / CS',   'online_global',   3.0),
  ('ED08', 'Post-Grad / Master''s / CA / CS',   'offline_india',   6.0),
  ('ED09', 'Post-Grad / Master''s / CA / CS',   'offline_outside', 8.0),
  ('ED10', 'PhD (Doctorate)',                   'online_global',   4.0),
  ('ED11', 'PhD (Doctorate)',                   'offline_india',   8.0),
  ('ED12', 'PhD (Doctorate)',                   'offline_outside', 10.0)
on conflict (id) do nothing;

-- 3. Same policy as every other table: a session AND an @hbplus.fit identity.
do $$
declare t text;
begin
  foreach t in array array['education_formats','education_levels']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "hbplus_domain_all" on public.%I', t);
    execute format(
      'create policy "hbplus_domain_all" on public.%I
         for all to authenticated
         using (public.is_allowed_domain())
         with check (public.is_allowed_domain())', t);
  end loop;
end $$;

select
  (select count(*) from public.education_formats) as formats,
  (select count(*) from public.education_levels)  as levels;
