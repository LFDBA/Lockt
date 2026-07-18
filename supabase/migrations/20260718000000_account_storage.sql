-- Lockt account storage. Safe to run repeatedly through Supabase migrations.

create extension if not exists pgcrypto;

create table if not exists public.projects (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 120),
    board jsonb not null default '{"lists": []}'::jsonb,
    whiteboard jsonb,
    settings jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    opened_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1
);

create unique index if not exists projects_user_name_unique
    on public.projects (user_id, lower(btrim(name)));

create index if not exists projects_user_opened_index
    on public.projects (user_id, opened_at desc);

create or replace function public.lockt_set_project_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at = now();
    new.version = old.version + 1;
    return new;
end;
$$;

drop trigger if exists lockt_projects_updated_at on public.projects;
create trigger lockt_projects_updated_at
before update on public.projects
for each row execute function public.lockt_set_project_updated_at();

alter table public.projects enable row level security;

drop policy if exists "Users can read their projects" on public.projects;
create policy "Users can read their projects"
on public.projects for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their projects" on public.projects;
create policy "Users can create their projects"
on public.projects for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their projects" on public.projects;
create policy "Users can update their projects"
on public.projects for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their projects" on public.projects;
create policy "Users can delete their projects"
on public.projects for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.projects from anon;
grant select, insert, update, delete on table public.projects to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'project-assets',
    'project-assets',
    false,
    15728640,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their project assets" on storage.objects;
create policy "Users can read their project assets"
on storage.objects for select
to authenticated
using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can upload their project assets" on storage.objects;
create policy "Users can upload their project assets"
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can update their project assets" on storage.objects;
create policy "Users can update their project assets"
on storage.objects for update
to authenticated
using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can delete their project assets" on storage.objects;
create policy "Users can delete their project assets"
on storage.objects for delete
to authenticated
using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from auth.users where id = (select auth.uid());
end;
$$;

revoke all on function public.delete_current_user() from public, anon;
grant execute on function public.delete_current_user() to authenticated;

