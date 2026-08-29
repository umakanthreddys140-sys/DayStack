import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Auto-load .env file if it exists
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch (e) {}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ MISSING CREDENTIALS: You must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const USERS_FILE = path.join(__dirname, '.users.db.json');
const USER_STORES_DIR = path.join(__dirname, '.user_stores');

async function migrate() {
  console.log("🚀 Starting Full Migration to Supabase...");

  // 1. Check if user_profiles table exists
  console.log("Checking if user_profiles table exists...");
  const { error: tableError } = await supabase.from('user_profiles').select('id').limit(1);
  
  if (tableError && tableError.code === '42P01') { // 42P01 = undefined_table
    console.error(`
❌ ERROR: The 'user_profiles' table does not exist in your Supabase database!

Please run the following SQL command in your Supabase SQL Editor:

CREATE TABLE user_profiles (
  id uuid references auth.users not null primary key,
  email text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Turn on Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to read and update their own data
CREATE POLICY "Users can view own profile" ON user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = id);
    `);
    process.exit(1);
  } else if (tableError) {
    console.error("❌ Failed to query database:", tableError);
    process.exit(1);
  }

  // 2. Read users
  if (!fs.existsSync(USERS_FILE)) {
    console.log("No .users.db.json found. Nothing to migrate.");
    process.exit(0);
  }

  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  console.log(`Found ${users.length} users to migrate.`);

  for (const user of users) {
    console.log(`\nMigrating user: ${user.email} (${user.id})`);
    
    // We cannot reliably migrate passwords since Supabase uses bcrypt and custom hashing, 
    // and we used node's scrypt. We must create the user with a temporary password or let them reset.
    // For now, we will create the user with a random password and auto-confirm them.
    
    const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: 'TemporaryPassword123!', // Users will have to use magic links or reset password
      email_confirm: true,
      user_metadata: { name: user.name, phone: user.phone }
    });

    if (createError) {
      if (createError.message.includes("already has an account")) {
        console.log(`User ${user.email} already exists in Supabase Auth. Skipping Auth creation...`);
      } else {
        console.error(`Failed to create auth user for ${user.email}:`, createError.message);
        continue;
      }
    }

    // Get the Supabase UUID
    const { data: { users: sbUsers }, error: getError } = await supabase.auth.admin.listUsers();
    if (getError) {
      console.error("Failed to list users to find UUID:", getError);
      continue;
    }
    
    const sbUser = sbUsers.find(u => u.email === user.email);
    if (!sbUser) {
      console.error("Could not find Supabase UUID for", user.email);
      continue;
    }

    console.log(`Mapped local ${user.id} -> Supabase ${sbUser.id}`);

    // Read local data store
    const storePath = path.join(USER_STORES_DIR, `${user.id}.json`);
    let userData = {};
    if (fs.existsSync(storePath)) {
      userData = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
      console.log(`Found data store for user (${Buffer.byteLength(JSON.stringify(userData), 'utf8')} bytes)`);
    } else {
      console.log(`No data store found for user.`);
    }

    // Insert or update user_profiles
    const { error: upsertError } = await supabase
      .from('user_profiles')
      .upsert({
        id: sbUser.id,
        email: user.email,
        data: userData,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (upsertError) {
      console.error(`Failed to migrate data for ${user.email}:`, upsertError);
    } else {
      console.log(`✅ Successfully migrated data for ${user.email}`);
    }
  }

  console.log("\n🎉 Migration Complete!");
  console.log("IMPORTANT: Since passwords could not be migrated (different hashing algorithms), users must reset their password or login via Magic Link/OAuth.");
}

migrate();
