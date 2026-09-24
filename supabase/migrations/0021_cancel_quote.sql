-- 0021 — tell the rider what a cancellation costs BEFORE they commit to it.
--
-- Until now the en-route screen worked the fee out for itself, from a
-- best-effort read of the event log plus its own copy of the 15-minute rule.
-- That is a second implementation of a money decision, and it drifted: a
-- stale clock or a failed fetch made it say "free to cancel" while
-- rider_cancel_ride charged $12. The client fix made it fail safe; this makes
-- it unnecessary.
--
-- The rule now lives in ONE place — cancel_decision() — which both the quote
-- and the real cancel call. They cannot disagree, because there is nothing
-- left to disagree about.

-- ---------------------------------------------------------------------------
-- 1. The rule, in one place
-- ---------------------------------------------------------------------------
-- Internal: assumes the caller has already checked who's asking. Returns what
-- cancelling this ride costs right now, plus the moment the free window shuts
-- (null when there's nothing to count down to).
create or replace function public.cancel_decision(p_ride_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  grace_minutes constant int := 15;
  late_fee_cents constant int := 1200;
  v_matched_at timestamptz;
  v_free_until timestamptz := null;
  v_fee int := 0;
  v_reason text := null;
begin
  -- Never matched? Nobody was inconvenienced, so never a fee.
  if p_status <> 'requested' then
    v_matched_at := public.ride_matched_at(p_ride_id);
    if v_matched_at is not null then
      v_free_until := v_matched_at + make_interval(mins => grace_minutes);
      if now() > v_free_until then
        v_fee := late_fee_cents;
        v_reason := 'late_cancellation';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'fee_cents', v_fee,
    'fee_reason', v_reason,
    'grace_minutes', grace_minutes,
    'free_until', v_free_until
  );
end;
$$;

revoke execute on function public.cancel_decision(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The quote — a read, charging nothing
-- ---------------------------------------------------------------------------
-- Same permission check as the cancel itself, so a quote can't be used to
-- probe someone else's ride. `cancellable` lets the screen know the ride has
-- moved past the point of cancelling without having to hard-code the states.
create or replace function public.cancel_quote(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_status text;
  v_requested_by uuid;
  v_rider_id uuid;
begin
  select status, requested_by, rider_id into v_status, v_requested_by, v_rider_id
  from ride_requests where id = p_ride_id;

  if not found or (v_requested_by is distinct from auth.uid() and v_rider_id is distinct from auth.uid()) then
    raise exception 'only the requester or the rider can cancel this ride' using errcode = '42501';
  end if;

  if v_status not in ('requested', 'matched', 'driver_en_route', 'arrived') then
    return jsonb_build_object('cancellable', false, 'fee_cents', 0, 'fee_reason', null, 'free_until', null);
  end if;

  return public.cancel_decision(p_ride_id, v_status) || jsonb_build_object('cancellable', true);
end;
$$;

revoke execute on function public.cancel_quote(uuid) from public, anon;
grant execute on function public.cancel_quote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The cancel, now reading from the same rule
-- ---------------------------------------------------------------------------
-- Behaviour is unchanged — the fee logic is lifted out verbatim into
-- cancel_decision(). Still takes `for update`, because this one writes and
-- two taps must not both bill.
create or replace function public.rider_cancel_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_requested_by uuid;
  v_rider_id uuid;
  v_decision jsonb;
  v_fee int;
  v_reason text;
begin
  select status, requested_by, rider_id into v_status, v_requested_by, v_rider_id
  from ride_requests where id = p_ride_id for update;

  if not found or (v_requested_by is distinct from auth.uid() and v_rider_id is distinct from auth.uid()) then
    raise exception 'only the requester or the rider can cancel this ride' using errcode = '42501';
  end if;

  if v_status not in ('requested', 'matched', 'driver_en_route', 'arrived') then
    raise exception 'this ride can no longer be cancelled (status: %)', v_status using errcode = '55000';
  end if;

  v_decision := public.cancel_decision(p_ride_id, v_status);
  v_fee := (v_decision ->> 'fee_cents')::int;
  v_reason := v_decision ->> 'fee_reason';

  update ride_requests
  set status = 'cancelled', fee_cents = v_fee, fee_reason = v_reason, updated_at = now()
  where id = p_ride_id;

  return v_decision;
end;
$$;
