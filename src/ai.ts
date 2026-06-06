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
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';

  const prompt = request.mode === 'summary'
    ? `Summarize this task in 3 concise bullets:\nTitle: ${request.title}\nContext: ${request.context ?? 'None'}`
    : `Write a professional task description with acceptance criteria.\nTitle: ${request.title}\nContext: ${request.context ?? 'None'}\nAudience: ${request.audience ?? 'Team member'}\nTone: ${request.tone ?? 'clear'}`;

  const fetchFn = globalThis.fetch;
  const response = await fetchFn(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You help generate task descriptions and summaries for a team task tracker.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = payload.choices?.[0]?.message?.content?.trim();

  return text ? { provider: 'openai' as const, text } : null;
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