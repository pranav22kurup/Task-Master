import type { AppDatabase } from './db/database';

export interface AiTaskRequest {
  title: string;
  context?: string;
  audience?: string;
  tone?: string;
  mode: 'description' | 'summary';
}

export interface AiTaskResult {
  provider: 'local' | 'openai';
  text: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildLocalResponse(request: AiTaskRequest) {
  const title = request.title.trim();
  const context = request.context?.trim();
  const audience = request.audience?.trim();
  const tone = request.tone?.trim() || 'clear';

  if (request.mode === 'summary') {
    return `Summary for ${title}: ${context ?? 'Capture the key outcomes, blockers, and next steps.'}`;
  }

  const lines = [
    `${title} - ${tone} task description`,
    context ? `Context: ${context}` : 'Context: Define the problem and expected outcome.',
    audience ? `Audience: ${audience}` : 'Audience: Team members responsible for execution.',
    'Acceptance criteria: clarify deliverables, edge cases, and completion requirements.',
  ];

  return lines.join('\n');
}

async function buildOpenAiResponse(request: AiTaskRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    console.warn('OpenAI API key not set or placeholder detected; skipping OpenAI request.');
    return null;
  }

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';

  const prompt = request.mode === 'summary'
    ? `Summarize this task in 3 concise bullets:\nTitle: ${request.title}\nContext: ${request.context ?? 'None'}`
    : `Write a professional task description with acceptance criteria.\nTitle: ${request.title}\nContext: ${request.context ?? 'None'}\nAudience: ${request.audience ?? 'Team member'}\nTone: ${request.tone ?? 'clear'}`;

  const fetchFn = (globalThis as any).fetch;
  if (typeof fetchFn !== 'function') {
    console.warn('Fetch is not available in this Node environment; cannot call OpenAI API.');
    return null;
  }

  const url = `${baseUrl}/chat/completions`;
  const payload = {
    model,
    messages: [
      { role: 'system', content: 'You help generate task descriptions and summaries for a team task tracker.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4,
  };

  // Try up to 2 attempts with small backoff
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`OpenAI request attempt ${attempt} -> model=${model}, url=${url}`);
      // Do not log the API key
      const resp = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const textBody = await resp.text();
      console.log(`OpenAI response status=${resp.status}`);
      // Log a truncated body for debugging (avoid logging entire huge responses)
      console.log('OpenAI response body (truncated):', textBody.slice(0, 2000));

      if (!resp.ok) {
        // Non-200, try again if attempt remains
        if (attempt === 2) return null;
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(textBody);
      } catch (e) {
        console.warn('Failed to parse OpenAI JSON response.');
        return null;
      }

      const text = parsed?.choices?.[0]?.message?.content?.trim();
      if (text) return { provider: 'openai' as const, text };
      return null;
    } catch (err) {
      console.error('OpenAI request error:', err);
      if (attempt === 2) return null;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  return null;
}

export async function generateTaskText(_database: AppDatabase, request: AiTaskRequest): Promise<AiTaskResult> {
  const openAiResult = await buildOpenAiResponse(request);

  if (openAiResult) {
    return openAiResult;
  }

  return {
    provider: 'local',
    text: buildLocalResponse(request),
  };
}

export function validateAiTaskRequest(input: unknown): AiTaskRequest | { error: string } {
  if (typeof input !== 'object' || input === null) {
    return { error: 'Request body must be an object.' };
  }

  const candidate = input as Partial<AiTaskRequest>;

  if (!isNonEmptyString(candidate.title)) {
    return { error: 'Title is required.' };
  }

  if (candidate.mode !== 'description' && candidate.mode !== 'summary') {
    return { error: 'Mode must be description or summary.' };
  }

  return {
    title: candidate.title.trim(),
    context: isNonEmptyString(candidate.context) ? candidate.context.trim() : undefined,
    audience: isNonEmptyString(candidate.audience) ? candidate.audience.trim() : undefined,
    tone: isNonEmptyString(candidate.tone) ? candidate.tone.trim() : undefined,
    mode: candidate.mode,
  };
}