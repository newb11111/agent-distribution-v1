# Commission / Reward Ledger Fix Notes

## Fixed
1. Disabled the old cleanup that deleted Leader/Admin commission rules when they matched HQ rules.
2. Annual-fee activation now stops with `ANNUAL_FEE_COMMISSION_RULES_NOT_SET` if a Sales Adviser has eligible uplines but that Admin has no positive annual-fee payout rule. This prevents an activation from silently putting the full annual fee into company ledger.
3. Admin-created Sales Advisers now require the sponsor/upline to be ACTIVE and annual-fee-valid, matching public registration behavior.
4. Reward ledger API now joins commission ledger so the UI can show the source downline, receiver, generation, and commission details.
5. Reward ledger UI now shows receiver, source downline, type, amount, generation, note, and date. Search also matches source downline code/name.

## Commission owner logic
Commission rules follow the Sales Adviser's `owner_admin_id`:
- If the Sales Adviser belongs to a Leader/Admin, activation/order commission uses that Leader/Admin's rules.
- If the Sales Adviser belongs to `admin_super`, it uses HQ/Super Admin rules.
- Normal Leader/Admin rules do not inherit HQ rules automatically.
