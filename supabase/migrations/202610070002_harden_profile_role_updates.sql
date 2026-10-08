-- Phase 0 security hardening: prevent authenticated clients from changing
-- their own application role. Trusted server-side operations using the
-- Supabase service-role context remain able to perform role administration.

create or replace function public.prevent_untrusted_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Role changes must be performed by a trusted server-side operation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_untrusted_role_change on public.profiles;
create trigger profiles_prevent_untrusted_role_change
before update on public.profiles
for each row execute function public.prevent_untrusted_role_change();

-- The trigger is the defense-in-depth boundary. Keep direct profile updates
-- available for non-privileged profile fields; role changes are blocked above.
