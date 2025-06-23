// src/utils/geminiUtils.js

import { GoogleGenAI, createUserContent, HarmCategory, HarmBlockThreshold } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export async function callGemini(prompt, imageBuffers, model = 'gemini-2.5-pro', jsonSchema = null, combinedText = '', documentName = '') {
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[GEMINI_UTIL] Próba ${attempt}/${maxRetries} dla dokumentu: ${documentName || 'REDUCE'}`);
      
      const parts = [];
      if (prompt) {
        parts.push(prompt);
      }
      
      let textContent = combinedText;
      if (documentName) {
        textContent = `--- ANALIZA DOKUMENTU: ${documentName} ---\n\n${combinedText}`;
      }
      if (textContent && textContent.trim() !== '') {
        parts.push(textContent);
      }

      if (imageBuffers && imageBuffers.length > 0) {
        for (const buffer of imageBuffers) {
          if (buffer && buffer.length > 0) {
            parts.push({ inlineData: { mimeType: 'image/png', data: buffer.toString('base64') } });
          }
        }
      }

      if (parts.length === 0) {
        throw new Error("Brak danych (tekstu lub obrazów) do wysłania do Gemini.");
      }

      const config = {
        response_mime_type: "application/json",
        // Upewniamy się, że przekazujemy tylko `responseSchema`, jeśli istnieje
        ...(jsonSchema && jsonSchema.responseSchema ? { ...jsonSchema.responseSchema } : {})
      };
      
      // Dołączamy schemat do promptu, aby wzmocnić jego przestrzeganie przez model
      if (jsonSchema && jsonSchema.responseSchema && jsonSchema.responseSchema.schema) {
        const schemaInstruction = `\n\n--- WYMAGANY SCHEMAT JSON ---\nTwoja odpowiedź MUSI być pojedynczym obiektem JSON, który ściśle przestrzega poniższego schematu. Nie dołączaj żadnego innego tekstu, wyjaśnień ani znaczników markdown.\n\n${JSON.stringify(jsonSchema.responseSchema.schema, null, 2)}`;
        parts.push(schemaInstruction);
      }
      
      console.log(`[GEMINI_UTIL] Wysyłanie do Gemini: ${imageBuffers.length} obrazów i ${textContent.length} znaków tekstu.`);
      
      const response = await ai.models.generateContent({
        model,
        contents: createUserContent(parts),
        config
      });
      
      const responseText = response.text || response.candidates?.[0]?.content?.parts?.map(p => p.text).join('');

      if (!responseText) {
        throw new Error("Response candidate contained no text.");
      }

      const cleanedText = responseText.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
      return JSON.parse(cleanedText);

    } catch (error) {
      lastError = error;
      console.error(`[GEMINI_UTIL] Próba ${attempt} dla "${documentName || 'REDUCE'}" nie powiodła się:`, error.message);
      if (attempt < maxRetries) {
        console.log(`[GEMINI_UTIL] Ponawianie próby za 2 sekundy...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  throw new Error(`Gemini API call failed for "${documentName || 'REDUCE'}" after ${maxRetries} attempts: ${lastError.message}`);
}