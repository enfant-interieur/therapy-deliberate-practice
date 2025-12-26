export const env = {
  aiMode: process.env.AI_MODE ?? "local_prefer",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  localSttUrl: process.env.LOCAL_STT_URL ?? "http://localhost:7001",
  localLlmUrl: process.env.LOCAL_LLM_URL ?? "http://localhost:7002",
  localLlmModel: process.env.LOCAL_LLM_MODEL ?? "mlx-community/Mistral-7B-Instruct-v0.2",
  dbPath: process.env.DB_PATH ?? "./infra/local.db"
};
