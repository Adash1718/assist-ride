-- 0031 — let a rider correct their own feedback for a short while.
--
-- Round 14 made feedback immutable on purpose, and that was right when a
-- rating only nudged an average. Rounds 29/30 changed the stakes: ratings can
-- now stop a driver being matched for a whole class of ride. A rider who taps
-- the wrong star, or rates the wrong trip after a bad day, currently has no
-- way to put it right — and neither does anyone else, because there is no
-- support in this app. Undoing exactly that situation in test data took a
-- migration.
--
-- The window is deliberately short and belongs to the person who wrote the
-- rating. Nobody else can alter it: not the driver, not another rider.
--
-- The risk this reopens, and why it stays small: editable ratings give a
-- driver something to pressure a rider about. Drivers cannot read individual
-- feedback (0014) — only their own aggregate — so they have no way to know
-- who rated them what, which leaves nothing specific to lean on. That is the
-- property that makes this safe, so it must not be weakened later.

alter table public.ride_feedback
  add column if not exists edited_at timestamptz;

create or replace function public.feedback_edit_window()
returns interval language sql immutable as $$ select interval '24 hours' $$;

-- Update, only by the rider who wrote it, only inside the window, and only to
-- the ratings and comment: the row's identity (which ride, which driver)
-- cannot be moved onto someone else.
drop policy if exists "requester corrects their recent feedback" on public.ride_feedback;
create policy "requester corrects their recent feedback" on public.ride_feedback
  for update
  using (
    rider_id = auth.uid()
    and created_at > now() - public.feedback_edit_window()
  )
  with check (
    rider_id = auth.uid()
    and created_at > now() - public.feedback_edit_window()
  );

-- Still no DELETE policy. A correction replaces a rating with a better one;
-- withdrawing it entirely would let a rating vanish without trace, which is a
-- different thing and not one anybody has asked for.

-- Keep the identity columns pinned. The UPDATE policy above cannot restrict
-- WHICH columns change (RLS has no column granularity — the same limitation
-- that produced matched_driver_public in 0018), so a trigger enforces it:
-- without this, a rider could move their rating onto a different ride or a
-- different driver.
create or replace function public.ride_feedback_guard()
returns trigger
language plpgsql
as $$
begin
  if new.ride_id is distinct from old.ride_id
     or new.rider_id is distinct from old.rider_id
     or new.driver_id is distinct from old.driver_id
     or new.created_at is distinct from old.created_at then
    raise exception 'only the ratings and comment can be corrected' using errcode = '42501';
  end if;
  new.edited_at := now();
  return new;
end;
$$;

drop trigger if exists ride_feedback_guard_trigger on public.ride_feedback;
create trigger ride_feedback_guard_trigger
  before update on public.ride_feedback
  for each row execute function public.ride_feedback_guard();
