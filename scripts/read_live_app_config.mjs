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
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.from('app_config').select('*').eq('id', 'global').maybeSingle();
if (error) throw error;

console.log(JSON.stringify(data, null, 2));
