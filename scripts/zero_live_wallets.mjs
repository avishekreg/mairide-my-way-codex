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

if (!url || !serviceKey) {
  throw new Error('Missing required env vars for wallet reset.');
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: users, error: usersError } = await supabase
  .from('users')
  .select('id,email,wallet,data');

if (usersError) throw usersError;

let updated = 0;
for (const user of users || []) {
  const wallet = { balance: 0, pendingBalance: 0 };
  const nextData = {
    ...(user.data || {}),
    wallet,
  };

  const { error } = await supabase
    .from('users')
    .update({ wallet, data: nextData })
    .eq('id', user.id);

  if (error) throw error;
  updated += 1;
}

console.log(
  JSON.stringify(
    {
      users_updated: updated,
      wallet_balance_reset_to: 0,
      pending_balance_reset_to: 0,
    },
    null,
    2
  )
);
