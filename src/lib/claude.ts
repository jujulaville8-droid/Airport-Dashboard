import Anthropic from '@anthropic-ai/sdk';
import { storeAIAnalysis } from './db';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an expert airport retail analytics advisor for The Tailor's Daughter, a gift shop at V.C. Bird International Airport in Antigua & Barbuda.

The shop sells travel accessories, souvenirs, local crafts, snacks, and convenience items to international travelers (primarily from the US, UK, and Caribbean).

Constraints you must factor into recommendations:
- Limited storage space, high rent per square foot
- Captive audience: travelers with limited time
- 3-person staff covering 6am-11pm
- Seasonal tourism patterns (peak: December-April, hurricane season: June-November)
- Caribbean/island context: local crafts, rum, hot sauce, beach items are strong sellers

Always provide:
1. Specific, actionable recommendations
2. Estimated revenue impact where possible
3. Confidence level for each recommendation: HIGH, MEDIUM, or LOW
4. Consider the Caribbean tourism context`;

export type AnalysisType =
  | 'daily_summary'
  | 'bundle_recommendations'
  | 'pricing_strategy'
  | 'weekly_performance'
  | 'staff_briefing'
  | 'restock_briefing';

const ANALYSIS_PROMPTS: Record<AnalysisType, (data: string) => string> = {
  daily_summary: (data) =>
    `Analyze today's sales data for The Tailor's Daughter and provide a concise daily summary with key insights, notable trends, and any immediate actions needed.\n\nSales Data:\n${data}`,

  bundle_recommendations: (data) =>
    `Based on these product sales and association patterns, recommend 3-5 product bundles that would increase average transaction value. For each bundle, suggest a bundle price, estimated uptake rate, and why it works for airport travelers.\n\nSales Data:\n${data}`,

  pricing_strategy: (data) =>
    `Review these items and their sales performance. Suggest pricing adjustments considering: airport markup expectations, competitor pricing, demand elasticity, and the Caribbean tourism market. Flag items that are underpriced or overpriced.\n\nSales & Pricing Data:\n${data}`,

  weekly_performance: (data) =>
    `Provide a comprehensive weekly performance review for The Tailor's Daughter. Include: revenue trends, top/bottom performers, day-of-week patterns, correlation with flight activity, and strategic recommendations for next week.\n\nWeekly Data:\n${data}`,

  staff_briefing: (data) =>
    `Create a brief, actionable staff briefing for today. Include: expected busy periods based on flight schedule, items to push/restock, any promotions to highlight, and break timing recommendations.\n\nSchedule & Flight Data:\n${data}`,

  restock_briefing: (data) =>
    `You are helping an airport gift shop owner decide what to reorder this week.

Based on the inventory and flight data below, produce a concise weekly restock briefing with these sections:

1. **ORDER NOW** — specific items that are CRITICAL or AT_RISK. For each, state the current stock, daily sell-through, and a suggested order quantity that covers lead time + a safety buffer. Prioritize by urgency (lowest days-of-cover first).

2. **WATCH LIST** — items trending toward at-risk status based on recent velocity. Not urgent, but worth monitoring.

3. **DISCOUNT / CLEAR** — dead stock items (zero sales 30+ days). Suggest a discount strategy based on tied-up capital.

4. **DEMAND OUTLOOK** — given the upcoming flight schedule, which categories should be over-weighted this week? Call out specific days/flights if relevant.

5. **RISK FLAGS** — anything unusual in the data (e.g. a category dropping hard, a former top-seller going dead).

Be concrete and quantitative. No filler. Use bullet points. Assume the reader has 2 minutes to read this.

Inventory & Flight Data:
${data}`,
};

// Model selection: Haiku for simple tasks, Sonnet for complex analysis
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';

type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

function selectModel(type: AnalysisType): string {
  switch (type) {
    case 'daily_summary':
    case 'staff_briefing':
      return HAIKU_MODEL;
    case 'bundle_recommendations':
    case 'pricing_strategy':
    case 'weekly_performance':
    case 'restock_briefing':
      return SONNET_MODEL;
    default:
      return SONNET_MODEL;
  }
}

function selectMaxTokens(type: AnalysisType): number {
  switch (type) {
    case 'daily_summary':
    case 'staff_briefing':
      return 500;
    case 'bundle_recommendations':
    case 'pricing_strategy':
      return 1000;
    case 'weekly_performance':
    case 'restock_briefing':
      return 1500;
    default:
      return 1000;
  }
}

export async function runAnalysis(
  analysisType: AnalysisType,
  inputData: Record<string, unknown>
): Promise<{
  analysis: string;
  confidenceLevel: ConfidenceLevel;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read: number; cache_creation: number };
}> {
  const dataString = JSON.stringify(inputData, null, 2);
  const promptFn = ANALYSIS_PROMPTS[analysisType];
  if (!promptFn) throw new Error(`Unknown analysis type: ${analysisType}`);

  const model = selectModel(analysisType);
  const maxTokens = selectMaxTokens(analysisType);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: promptFn(dataString),
      },
    ],
  });

  const block = response.content[0];
  const analysisText = block?.type === 'text' ? block.text : null;
  if (!analysisText) {
    throw new Error(
      `Claude returned no text content (stop_reason: ${response.stop_reason ?? 'unknown'})`
    );
  }

  // Infer confidence from the response content — word-boundary match so "highlight" doesn't trigger HIGH
  let confidenceLevel: ConfidenceLevel = 'MEDIUM';
  if (/\bLOW\b/.test(analysisText)) {
    confidenceLevel = 'LOW';
  } else if (/\bHIGH\b/.test(analysisText)) {
    confidenceLevel = 'HIGH';
  }

  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_read: response.usage.cache_read_input_tokens ?? 0,
    cache_creation: response.usage.cache_creation_input_tokens ?? 0,
  };

  // Store in database
  await storeAIAnalysis({
    analysis_date: new Date().toISOString().split('T')[0],
    analysis_type: analysisType,
    input_context: inputData,
    claude_response: { text: analysisText },
    confidence_level: confidenceLevel,
    action_items: extractActionItems(analysisText),
    model_used: model,
    token_usage: usage,
  });

  return { analysis: analysisText, confidenceLevel, model, usage };
}

// Pull out action items from Claude's response
function extractActionItems(text: string): string {
  const lines = text.split('\n');
  const actions = lines.filter(
    (line) =>
      line.match(/^[\s]*[-•*]\s/) ||
      line.match(/^\d+\.\s/) ||
      line.toLowerCase().includes('action') ||
      line.toLowerCase().includes('recommend')
  );
  return actions.slice(0, 10).join('\n');
}

export async function generateScheduleBriefing(
  schedule: Record<string, unknown>,
  flightData: Record<string, unknown>
): Promise<string> {
  const result = await runAnalysis('staff_briefing', { schedule, flightData });
  return result.analysis;
}
