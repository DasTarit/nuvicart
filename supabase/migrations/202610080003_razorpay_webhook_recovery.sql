-- Phase 4B.2: Razorpay webhook recovery and release hardening.
-- Small in-place hardening pass. Preserves the Phase 4B/4B.1 payment architecture.

-- A single centralized stale-claim threshold is used by the claim function.
-- Five minutes is intentionally fixed and is not user-configurable.
create or replace function public.claim_razorpay_webhook_event(
  p_provider_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_signature_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.payment_webhook_events;
  v_token uuid;
  v_now timestamptz := timezone('utc', now());
  v_stale_after interval := interval '5 minutes';
begin
  if not p_signature_verified then
    raise exception 'SIGNATURE_NOT_VERIFIED';
  end if;

  if p_provider_event_id is null or length(trim(p_provider_event_id)) = 0 then
    raise exception 'INVALID_PROVIDER_EVENT_ID';
  end if;

  -- First verified payload wins. ON CONFLICT DO NOTHING deliberately prevents
  -- a later duplicate delivery from replacing the authoritative stored payload.
  insert into public.payment_webhook_events(
    provider, provider_event_id, event_type, payload, signature_verified
  )
  values (
    'razorpay', p_provider_event_id, coalesce(p_event_type, ''), p_payload, true
  )
  on conflict (provider, provider_event_id) do nothing;

  -- Row-level locking serializes concurrent deliveries for this provider event.
  select * into v_event
  from public.payment_webhook_events
  where provider = 'razorpay'
    and provider_event_id = p_provider_event_id
  for update;

  if v_event.processed_at is not null then
    return jsonb_build_object(
      'status', 'processed',
      'event_id', v_event.id
    );
  end if;

  -- A live claim is deliberately not acknowledged as successful. The HTTP
  -- endpoint returns a retryable non-2xx response so a lost worker cannot turn
  -- an event into a permanently acknowledged-but-unprocessed notification.
  if v_event.processing_at is not null
     and v_event.processing_at > v_now - v_stale_after then
    return jsonb_build_object(
      'status', 'in_progress',
      'event_id', v_event.id
    );
  end if;

  -- Reclaim stale work transactionally under the row lock. Replacing the token
  -- invalidates every completion/release call made by the old worker.
  v_token := gen_random_uuid();

  update public.payment_webhook_events
  set processing_at = v_now,
      processing_token = v_token
  where id = v_event.id
    and processed_at is null;

  return jsonb_build_object(
    'status', 'claimed',
    'event_id', v_event.id,
    'processing_token', v_token
  );
end;
$$;

revoke all on function public.claim_razorpay_webhook_event(text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_razorpay_webhook_event(text, text, jsonb, boolean)
  to service_role;

-- Only the currently owning token may complete an event. An old worker's token
-- becomes invalid immediately after a stale claim is reclaimed.
create or replace function public.complete_razorpay_webhook_event(
  p_event_id uuid,
  p_processing_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_webhook_events
  set processed_at = coalesce(processed_at, timezone('utc', now())),
      processing_at = null,
      processing_token = null
  where id = p_event_id
    and processing_token = p_processing_token
    and processed_at is null;

  return found;
end;
$$;

revoke all on function public.complete_razorpay_webhook_event(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_razorpay_webhook_event(uuid, uuid)
  to service_role;

-- Likewise, an old worker cannot release a claim after another worker has
-- reclaimed it with a new token.
create or replace function public.release_razorpay_webhook_event(
  p_event_id uuid,
  p_processing_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_webhook_events
  set processing_at = null,
      processing_token = null
  where id = p_event_id
    and processing_token = p_processing_token
    and processed_at is null;

  return found;
end;
$$;

revoke all on function public.release_razorpay_webhook_event(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_razorpay_webhook_event(uuid, uuid)
  to service_role;

-- The existing unique provider/event constraint remains authoritative. No
-- duplicate webhook table or event record is introduced in 4B.2.
