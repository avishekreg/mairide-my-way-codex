import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

function readEnvFile(path) {
  const envText = fs.readFileSync(path, 'utf8');
  return Object.fromEntries(
    envText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=');
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
        return [key, value];
      })
  );
}

const env = readEnvFile('/Users/avishek/Documents/Playground/mairide-my-way/.env.local');
const url = env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (env.VITE_SUPER_ADMIN_EMAIL || '').toLowerCase();

if (!url || !serviceKey || !superAdminEmail) {
  throw new Error('Missing required env vars for cleanup.');
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function summarizeTable(table, filter) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function deleteAll(table) {
  const { error } = await supabase.from(table).delete().not('id', 'is', null);
  if (error) throw error;
}

const before = {
  users_non_admin: await summarizeTable('users', (q) => q.neq('email', superAdminEmail)),
  rides: await summarizeTable('rides'),
  bookings: await summarizeTable('bookings'),
  transactions: await summarizeTable('transactions'),
  referrals: await summarizeTable('referrals'),
  support_tickets: await summarizeTable('support_tickets'),
};

await deleteAll('bookings');
await deleteAll('rides');
await deleteAll('transactions');
await deleteAll('referrals');
await deleteAll('support_tickets');

const { data: nonAdminUsers, error: usersError } = await supabase
  .from('users')
  .select('id,email,role')
  .neq('email', superAdminEmail);

if (usersError) throw usersError;

const userIdsToDelete = (nonAdminUsers || []).map((user) => user.id);
if (userIdsToDelete.length) {
  const { error: deleteUsersError } = await supabase.from('users').delete().in('id', userIdsToDelete);
  if (deleteUsersError) throw deleteUsersError;
}

const { data: authUsersData, error: listAuthError } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});

if (listAuthError) throw listAuthError;

const deletedAuthIdentifiers = [];
for (const user of authUsersData?.users || []) {
  const email = (user.email || '').toLowerCase();
  if (email && email === superAdminEmail) continue;
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error) throw error;
  deletedAuthIdentifiers.push(user.email || user.id);
}

const after = {
  users_non_admin: await summarizeTable('users', (q) => q.neq('email', superAdminEmail)),
  rides: await summarizeTable('rides'),
  bookings: await summarizeTable('bookings'),
  transactions: await summarizeTable('transactions'),
  referrals: await summarizeTable('referrals'),
  support_tickets: await summarizeTable('support_tickets'),
};

console.log(
  JSON.stringify(
    {
      preserved_super_admin: superAdminEmail,
      before,
      after,
      deleted_user_rows: userIdsToDelete.length,
      deleted_auth_accounts: deletedAuthIdentifiers.length,
      deleted_auth_identifiers: deletedAuthIdentifiers,
    },
    null,
    2
  )
);
