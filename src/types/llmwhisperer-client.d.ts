declare module "llmwhisperer-client" {
  export class LLMWhispererClientV2 {
    constructor(config: {
      apiKey: string;
      baseUrl?: string;
      apiTimeout?: number;
    });

    whisper(options: Record<string, unknown>): Promise<Record<string, unknown>>;
    whisperStatus(whisperHash: string): Promise<Record<string, unknown>>;
    whisperRetrieve(whisperHash: string): Promise<Record<string, unknown>>;
  }
}
