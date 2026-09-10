# Elias

A private, conversational Discord AI bot built with Node.js, discord.js, Groq, Supabase/PostgreSQL, and Railway.

## Features

- Locked to one Discord server with `GUILD_ID`
- `MAIN` channels: actively respond to normal user messages
- `SEMI-ACTIVE` channels: respond to mentions/replies and occasionally join conversations
- `BLOCKED` channels: never respond to normal messages
- Multiple main/semi channels supported
- Prefix commands for channel configuration
- Persistent user memories in Supabase
- `!memory` sends a user's stored memories by DM
- `!forget` deletes a user's stored memories
- Recent channel conversation context
- Groq JSON responses for reply + memory extraction
- Per-channel queueing and spontaneous-response cooldowns
- No secrets committed to the repository

## Setup

1. Create a Supabase project.
2. Open `supabase/schema.sql` and run it once in the Supabase SQL Editor.
3. Create a Groq API key.
4. Create/configure the Discord application and bot, then enable the **Message Content Intent** in the Discord Developer Portal.
5. Copy `.env.example` to `.env` for local development, or add the same variables to Railway.
6. Run `npm install` and `npm start`.

Supabase is used only from the server-side bot. The secret key must never be exposed to a browser or committed to Git.

## Commands

- `!main [#channel]`
- `!unmain [#channel]`
- `!semi [#channel]`
- `!unsemi [#channel]`
- `!block [#channel]`
- `!unblock [#channel]`
- `!channels`
- `!memory`
- `!forget`
- `!help`

Channel commands require **Manage Server** or **Administrator** permission.

## Railway variables

Required:

```env
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=
GROQ_API_KEY=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

Optional:

```env
GROQ_MODEL=openai/gpt-oss-20b
BOT_PREFIX=!
SPONTANEOUS_CHANCE=0.04
SEMI_COOLDOWN_SECONDS=300
MAX_CONTEXT_MESSAGES=18
MAX_MEMORIES_PER_USER=12
BOT_NAME=Elias
```
