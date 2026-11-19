import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';


export { TaskType };

if (!process.env.GEMINI_API_KEY) {
  throw new Error('CRITICAL ERROR: GEMINI_API_KEY is not defined in the environment variables.');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const getEmbedding = async (
  text: string,
  taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
): Promise<number[]> => {
  try {
    const embeddingModel = genAI.getGenerativeModel({
      model: 'gemini-embedding-001'
    });

    const result = await embeddingModel.embedContent({
      content: { role: 'user', parts: [{ text }] },
      taskType,
    });

    console.log("Embedding length:", result.embedding.values.length);

    return result.embedding.values;

  } catch (error: any) {

    throw new Error(`Embedding request failed: ${error.message || 'Unknown error'}`);
  }
};

export const callAI = async (
  systemPrompt: string,
  userPrompt: string
): Promise<string> => {
  const maxAttempts = 3;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Gemini attempt ${attempt}/${maxAttempts}`);

      const model = genAI.getGenerativeModel({
        model: 'gemini-3.5-flash-lite',
        systemInstruction: systemPrompt,
      });

      console.time('Gemini API response');

      const result = await model.generateContent(userPrompt);

      console.timeEnd('Gemini API response');

      return result.response.text() || '';
    } catch (error: unknown) {
      const err = error as {
        status?: number;
        message?: string;
      };

      const status = err.status;
      const message = err.message || 'Unknown error';

      // Retry only temporary service failures
      const isRetryable =
        status === 503 ||
        status === 502 ||
        status === 504;

      console.error(
        `Gemini attempt ${attempt} failed:`,
        message
      );

      if (!isRetryable || attempt === maxAttempts) {
        throw new Error(`AI request failed: ${message}`);
      }

      // Exponential backoff: 2s, then 4s
      const delay = 2000 * Math.pow(2, attempt - 1);

      console.log(`Retrying Gemini in ${delay / 1000}s...`);

      await sleep(delay);
    }
  }

  throw new Error('Gemini request failed.');
};

export const safeParseJSON = <T>(rawText: string, fallback: T): T => {
  try {

    let cleanedText = rawText.trim();

    if (cleanedText.startsWith('```')) {

      const firstNewlineIndex = cleanedText.indexOf('\n');
      if (firstNewlineIndex !== -1) {
        cleanedText = cleanedText.substring(firstNewlineIndex + 1);
      }

      if (cleanedText.endsWith('```')) {

        cleanedText = cleanedText.substring(0, cleanedText.length - 3).trim();
      }
    }

    return JSON.parse(cleanedText) as T;
  } catch (error) {
    console.error('JSON Parsing failed. Raw text was:', rawText);
    return fallback;
  }
};
