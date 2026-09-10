import Groq from 'groq-sdk';
import { config } from './config.js';

const groq = new Groq({ apiKey: config.groqApiKey });

export function isGroqRateLimitError(error) {
  return error?.status === 429 || error?.code === 'rate_limit_exceeded' || error?.error?.code === 'rate_limit_exceeded';
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

  const completion = await groq.chat.completions.create({
    model: config.groqModel,
    messages: [
      {
        role: 'system',
        content: `You are ${config.botName}, an 18-year-old female Discord server character. Summarize Discord conversations accurately and neutrally. Do not invent details or pretend people did things they did not do. Focus on the main topics, important points, decisions, plans, disagreements, notable moments, and unresolved questions. Mention people by displayed name when useful. Keep the summary readable and reasonably concise. Do not discuss internal implementation.`
      },
      {
        role: 'user',
        content: `Summarize these ${messages.length} most recent Discord messages. The newest message appears last in this transcript.\n\n${transcript}`
      }
    ],
    temperature: 0.25,
    max_completion_tokens: 900,
    reasoning_effort: 'low',
    include_reasoning: false
  });

  const summary = completion.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error('AI returned an empty summary.');
  return summary;
}
