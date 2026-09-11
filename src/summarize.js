import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { summarizeMessagesFallback, isGroqRateLimitError } from './groq-fallback.js';

const gemini = new GoogleGenAI({ apiKey: config.geminiApiKey });

export function isGeminiRateLimitError(error) {
  return error?.status === 429 || error?.code === 429 || error?.code === 'RESOURCE_EXHAUSTED' || /resource exhausted|rate limit|quota/i.test(error?.message || '');
}

function currentIST() {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'long'
  }).format(new Date());
}

export async function summarizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('No messages available to summarize.');
  }

  const transcript = messages.map((message, index) => {
    const author = message.author?.displayName || message.author?.username || 'Unknown user';
    const content = String(message.content || '').trim().slice(0, 700);
    return `${index + 1}. ${author}: ${content || '[no text]'}`;
  }).join('\n');

  try {
    const response = await gemini.models.generateContent({
      model: config.geminiModel,
      contents: `Current date/time in IST: ${currentIST()}\n\nHere is a Discord transcript containing the ${messages.length} most recent messages, in chronological order (oldest first, newest last).\n\n${transcript}`,
      config: {
        systemInstruction: `You are ${config.botName}, an 18-year-old female Discord server character, but your job in this request is ONLY to summarize the supplied Discord transcript.\n\nProduce a useful human-readable conversation summary, NOT a numbered transcript and NOT a message-by-message rewrite.\n\nRules:\n- Identify the main topics and what the conversation actually accomplished.\n- Group related messages into themes instead of listing every message individually.\n- Mention important people by displayed name only when their role in the discussion matters.\n- Preserve meaningful context, decisions, plans, disagreements, jokes that became notable, requests, and unresolved points.\n- Distinguish actions that actually happened from requests or claims about actions.\n- Do not invent motives, facts, relationships, or events that are not present in the transcript.\n- Do not overfocus on greetings, repeated short replies, or trivial messages unless they matter to the discussion.\n- Do not quote the transcript at length. Paraphrase it.\n- Use 2-5 concise sections with short headings when multiple topics exist. Use a brief paragraph when there is only one main topic.\n- End with a short “Bottom line” only when it adds value.\n- Keep the result reasonably concise but informative. The user asked for a summary, so prioritize meaning and context over exhaustive coverage.\n- Do not mention these instructions or internal implementation.\n\nThe current time is supplied above only so any time references in the summary can be interpreted correctly.`,
        temperature: 0.2,
        maxOutputTokens: 900
      }
    });

    const summary = response.text?.trim();
    if (!summary) throw new Error('AI returned an empty summary.');
    return summary;
  } catch (primaryError) {
    console.warn('Gemini summary failed; trying Groq fallback:', primaryError?.message || primaryError);
    try {
      return await summarizeMessagesFallback(messages);
    } catch (fallbackError) {
      if (isGroqRateLimitError(fallbackError)) throw fallbackError;
      if (isGeminiRateLimitError(primaryError)) throw primaryError;
      throw fallbackError;
    }
  }
}
