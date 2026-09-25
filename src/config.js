import 'dotenv/config';

const required = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY'
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error('Missing required environment variable: ' + key);
  }
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY
};