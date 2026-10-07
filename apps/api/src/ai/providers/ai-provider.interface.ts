export interface AiSummaryInput {
  requests: Array<{
    id: string;
    code: string;
    priority: 'ALTA' | 'MEDIA' | 'BAJA';
    neededBy: Date;
    items: Array<{
      sku: string;
      name: string;
      quantity: number;
      available: number;
    }>;
    notes: string | null;
  }>;
  now: Date;
}

export interface AiProvider {
  summarize(input: AiSummaryInput, signal: AbortSignal): Promise<unknown>;
}

export const AI_PROVIDER_TOKEN = 'AI_PROVIDER';