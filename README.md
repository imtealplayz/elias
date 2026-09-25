# Elias

A conversational Discord AI bot built with Node.js, discord.js, Gemini, Groq fallback, Supabase/PostgreSQL, and Railway.

## Features

- Locked to one Discord server with `GUILD_ID`
- Persistent user memories in Supabase
- `!memory` sends a user's stored memories by DM
- `!forget` deletes a user's stored memories
- Recent channel conversation context
- Groq JSON responses for reply + memory extraction
- Live currency conversion using the latest available exchange rate
- Live crypto prices and crypto/fiat or crypto/crypto conversion
- Natural-language reminders with persistent scheduling
- No secrets committed to the repository

## Natural language features

Elias can handle live financial requests through normal conversation, for example:

- `convert 100 USD to INR`
- `what is 0.5 BTC worth in USD?`
- `how much is 100 dollars in bitcoin?`
- `what's BTC worth right now?`

Currency conversion uses the public Frankfurter v2 API, so no additional API key or environment variable is required. Frankfurter provides daily reference exchange rates rather than live trading quotes. Crypto prices use CoinGecko's public price endpoint. Elias performs the final conversion arithmetic locally.

Elias also understands natural-language reminders without commands:

- `remind me in 30 minutes to check Railway`
- `remind me tomorrow at 6pm to work on LOZ`
- `what are my reminders?`
- `cancel my Railway reminder`

Reminders are stored in Supabase and delivered to the user's Discord DMs. Pending reminders survive bot restarts. Reminder times are interpreted in IST (Asia/Kolkata).

## Setup

1. Create a Supabase project.
2. Open `supabase/schema.sql` and run it once in the Supabase SQL Editor.
3. Create a Gemini API key.
4. Create a Groq API key if fallback replies are desired.
5. Create/configure the Discord application and bot, then enable the **Message Content Intent** in the Discord Developer Portal.
6. Copy `.env.example` to `.env` for local development, or add the same variables to Railway.
7. Run `npm install` and `npm start`.

Supabase is used only from the server-side bot. The secret key must never be exposed to a browser or committed to Git.

## Commands

- `!memory`
- `!forget`
- `!help`


## Railway variables

Required:

```env
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=
GEMINI_API_KEY=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

Optional:

```env
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
BOT_PREFIX=!
MAX_CONTEXT_MESSAGES=18
MAX_MEMORIES_PER_USER=12
BOT_NAME=Elias
```
