import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

// Re-export TaskType so consumers of aiClient can specify RETRIEVAL_QUERY or RETRIEVAL_DOCUMENT
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


export const callAI = async (systemPrompt: string, userPrompt: string): Promise<string> => {
  try {

    const model = genAI.getGenerativeModel({
      model: 'gemini-3.8-flash',
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent(userPrompt);
    const text = result.response.text();

    return text || '';
  } catch (error: any) {
    throw new Error(`AI request failed: ${error.message || 'Unknown error'}`);
  }
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
 