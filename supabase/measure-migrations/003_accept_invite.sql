-- A non-admin invitee could not get in.
--
-- The invite flow assumed the signing-in person could flip their own
-- membership to 'active'. They cannot, and the two halves of the deadlock are
-- both deliberate:
--
--   * memberships_write is admin-only, so a plain member's UPDATE is refused.
--   * current_company_id() requires status = 'active', so before activation
--     the invitee resolves to no company — which means memberships_read shows
--     them nothing, and they cannot even SEE the invite addressed to them.
--
-- So the activation has to happen somewhere neither RLS policy applies:
-- a security-definer function that will only ever touch a row whose email
-- equals the address on the caller's own verified token.
--
-- Trust boundary: auth.jwt() ->> 'email' is set by GoTrue from the address the
-- code was mailed to, already lowercased, and this app signs in by emailed OTP
-- only. Proving you can read that inbox is exactly what accepting an invite
-- means, so matching on it is the whole authorisation.
--
-- Deliberately cannot create a membership: a company exists only when Mitch
-- sets one up, and an uninvited address must still bounce off.
create or replace function accept_invite()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_email text := lower(auth.jwt() ->> 'email');
  target memberships%rowtype;
begin
  if auth.uid() is null or coalesce(claimed_email, '') = '' then
    return null;
  end if;

  -- Someone already on a team keeps that team: a later invite from a second
  -- company must not silently move them (one company per person is a known
  -- limitation, and switching underfoot is the worst way to hit it).
  -- `is not distinct from` rather than `=` so a null user_id sorts as false
  -- instead of null, which DESC would otherwise put first.
  select * into target
  from memberships m
  where not m.deleted
    and lower(m.email) = claimed_email
  order by
    (m.user_id is not distinct from auth.uid()) desc,
    (m.status = 'active') desc,
    m.updated_at asc,
    m.id asc
  limit 1;

  if not found then
    return null;
  end if;

  -- Bind the row to the account that just proved it owns the address. Also
  -- repairs a row bound to the wrong account, which the old client-side
  -- claim (an unfiltered limit(1) over the roster) could produce.
  -- `role` is never touched: the inviter chose it.
  if target.status <> 'active' or target.user_id is distinct from auth.uid() then
    update memberships
    set status = 'active',
        user_id = auth.uid(),
        updated_at = now()
    where id = target.id;
  end if;

  return target.company_id;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on a new function, and PUBLIC includes
-- anon. Same revoke-then-grant as the helpers in 001.
revoke execute on function accept_invite() from public, anon;
grant execute on function accept_invite() to authenticated;
