import OpenAI from "openai";

const clients = new Map<string, OpenAI>();

export const getOpenAIClient = (apiKey: string) => {
  if (!apiKey) {
    throw new Error("OpenAI key missing");
  }
  const existing = clients.get(apiKey);
  if (existing) return existing;

  const client = new OpenAI({
    apiKey,
    maxRetries: 5,
    timeout: 120_000
  });
  clients.set(apiKey, client);
  return client;
};
