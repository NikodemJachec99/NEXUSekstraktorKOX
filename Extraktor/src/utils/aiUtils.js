// src/utils/aiUtils.js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function callOpenAI(finalContent, model) {
  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'user',
          content: finalContent
        }
      ],
      max_tokens: 10000,
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI error:', error);
    throw new Error('Failed to call OpenAI');
  }
}

export async function callOpenAIJson(finalContent, format, model) {
  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages:[
        { role: "system", content: "you have to extracted the requested parameter from the given text in json format" },
        { role: "user", content: finalContent}
    ],
      response_format:format
      
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI error:', error);
    throw new Error('Failed to call OpenAI');
  }
}