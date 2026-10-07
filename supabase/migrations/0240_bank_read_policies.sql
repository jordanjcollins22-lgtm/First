-- The bank rows the office now reads directly.
--
-- 0193 gave bank_accounts and bank_transactions row security and no policy at
-- all, deliberately: at the time the only thing that read them was a
-- background job and a view, so deny-all was both correct and free.
--
-- It stopped being correct the moment three screens were built on top of those
-- rows -- the subscriptions, the overhead and the statement. RLS with no
-- policy is not an error anybody sees; it is an empty result. So the pages
-- shipped, looked finished, and told the owner no transactions had ever come
-- through while six months of them sat in the table.
--
-- Scoped to the organisation, which is the thing 0193 was actually protecting:
-- there are two businesses on this database and neither may see the other's
-- money. Read-only, because every write comes from the Plaid sync running as
-- the service role, which does not consult policies at all.
--
-- bank_links keeps its deny-all and always will. It holds the access token,
-- and nothing a browser can reach has any business with that.
drop policy if exists bank_accounts_own_org on public.bank_accounts;
create policy bank_accounts_own_org on public.bank_accounts
  for select to authenticated
  using (organization_id = current_org_id());

drop policy if exists bank_transactions_own_org on public.bank_transactions;
create policy bank_transactions_own_org on public.bank_transactions
  for select to authenticated
  using (organization_id = current_org_id());

-- The statement terms are typed in by a person: the rate, the minimum, the
-- limit and the day it is due, which the bank feed does not carry and the debt
-- plan needs. That needs a write, and a row policy would hand over the whole
-- row -- including the balance, which is the bank's to say and nobody else's.
--
-- So the row is writable and the columns are not. Postgres checks the grant
-- before the policy, which makes this the narrowest true statement of what
-- somebody may change.
drop policy if exists bank_accounts_own_terms on public.bank_accounts;
create policy bank_accounts_own_terms on public.bank_accounts
  for update to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

revoke update on public.bank_accounts from authenticated;
grant update (apr, minimum_payment, credit_limit, payment_due_day)
  on public.bank_accounts to authenticated;

notify pgrst, 'reload schema';
