import OpenAI from "openai";

type OpenAIClientOptions = {
  apiKey: string;
  baseURL?: string;
};

const clients = new Map<string, OpenAI>();

export const getOpenAIClient = ({ apiKey, baseURL }: OpenAIClientOptions) => {
  if (!apiKey) {
    throw new Error("OpenAI key missing");
  }
  const cacheKey = `${apiKey}::${baseURL ?? "default"}`;
  const existing = clients.get(cacheKey);
  if (existing) return existing;

  const client = new OpenAI({
    apiKey,
    baseURL,
    maxRetries: 5,
    timeout: 120_000,
  });
  clients.set(cacheKey, client);
  return client;
};
