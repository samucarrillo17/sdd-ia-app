import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvider, AiSummaryInput, AI_PROVIDER_TOKEN } from './ai-provider.interface.js';

@Injectable()
export class MockAiProvider implements AiProvider {
  constructor(private readonly configService: ConfigService) {}

  async summarize(input: AiSummaryInput, signal: AbortSignal): Promise<unknown> {
    const mode = this.configService.get<string>('AI_MOCK_MODE') ?? 'ok';
    
    if (mode === 'slow') {
      await new Promise((_, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 6000);
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Aborted'));
        });
      });
    }
    
    if (mode === 'error') {
      throw new Error('Provider error');
    }
    
    if (mode === 'invalid-json') {
      return 'not valid json';
    }
    
    // ok mode - return a valid fixture-like response
    return {
      summary: 'Resumen de prueba generado por mock',
      recommendations: input.requests.map((req, index) => ({
        requestId: req.id,
        rank: index + 1,
        action: 'RESERVAR',
        reason: `Prioridad ${req.priority}, necesaria en ${Math.ceil((req.neededBy.getTime() - input.now.getTime()) / (1000 * 60 * 60 * 24))} días.`,
      })),
    };
  }
}

export const mockAiProviderFactory = (configService: ConfigService) => new MockAiProvider(configService);