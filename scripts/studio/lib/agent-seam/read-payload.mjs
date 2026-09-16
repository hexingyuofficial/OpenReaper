import { readFile } from "node:fs/promises";

export async function readPromptPayload(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}
