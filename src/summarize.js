import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

const gemini = new GoogleGenAI({ apiKey: config.geminiApiKey });

export function isGeminiRateLimitError(error) {
  return error?.status === 429 || error?.code === 429 || error?.code === 'RESOURCE_EXHAUSTED' || /resource exhausted|rate limit|quota/i.test(error?.message || '');
}

export async function summarizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('No messages available to summarize.');
  }

  const transcript = messages.map((message, index) => {
    const author = message.author?.displayName || message.author?.username || 'Unknown user';
    const content = String(message.content || '').trim().slice(0, 500);
    return `${index + 1}. ${author}: ${content || '[no text]'}`;
  }).join('\n');

  const response = await gemini.models.generateContent({
    model: config.geminiModel,
    contents: `Summarize these ${messages.length} most recent Discord messages. The newest message appears last in this transcript.\n\n${transcript}`,
    config: {
      systemInstruction: `You are ${config.botName}, an 18-year-old female Discord server character. Summarize Discord conversations accurately and neutrally. Do not invent details or pretend people did things they did not do. Focus on the main topics, important points, decisions, plans, disagreements, notable moments, and unresolved questions. Mention people by displayed name when useful. Keep the summary readable and reasonably concise. Do not discuss internal implementation.`,
      temperature: 0.25,
      maxOutputTokens: 900
    }
  });

  const summary = response.text?.trim();
  if (!summary) throw new Error('AI returned an empty summary.');
  return summary;
}
