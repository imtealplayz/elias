import 'dotenv/config';

const required = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'GEMINI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY'
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiClassifierModel: process.env.GEMINI_CLASSIFIER_MODEL || 'gemini-2.5-flash-lite',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
  prefix: process.env.BOT_PREFIX || '!',
  botName: process.env.BOT_NAME || 'Elias',
  spontaneousChance: Math.min(1, Math.max(0, Number(process.env.SPONTANEOUS_CHANCE || 0.02))),
  semiCooldownMs: Math.max(0, Number(process.env.SEMI_COOLDOWN_SECONDS || 600) * 1000),
  maxContextMessages: Math.max(4, Number(process.env.MAX_CONTEXT_MESSAGES || 12)),
  maxMemoriesPerUser: Math.max(1, Number(process.env.MAX_MEMORIES_PER_USER || 12))
};
