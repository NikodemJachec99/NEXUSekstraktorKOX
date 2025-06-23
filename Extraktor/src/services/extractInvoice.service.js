// src/services/extractInvoice.service.js

import { downloadWithRetry, detectFileType } from '../utils/fileUtils.js';
import { convertPdfToAllImageBuffers } from '../utils/convertPdfPageToImageBuffer.js';
import { callGemini } from '../utils/geminiUtils.js';
import { detectTextInImageBuffer } from '../utils/visionUtils.js';
import mammoth from 'mammoth';
import MsgReader from '@kenjiuno/msgreader';
import unzipper from 'unzipper';
import { parseStringPromise } from 'xml2js';

const MAX_FILES = 500;
const MAX_IMAGES_PER_DOCUMENT = 10;
const CONCURRENT_MAP_LIMIT = 40; // Przetwarzaj maksymalnie 5 plików jednocześnie

// Funkcja pomocnicza do wyciągania tekstu z parsowanego XML (.odt)
function extractTextFromXml(node) {
  let text = '';
  if (typeof node === 'string') {
    return node.trim() + ' ';
  }
  if (node && typeof node === 'object') {
    if (node._) {
      text += node._.trim() + ' ';
    }
    for (const key in node) {
      if (key !== '$') {
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(item => {
            text += extractTextFromXml(item);
          });
        } else if (typeof child === 'object') {
          text += extractTextFromXml(child);
        }
      }
    }
  }
  return text;
}


// Domyślny prompt, jeśli użytkownik nie dostarczy własnego z n8n
const DEFAULT_INTERMEDIATE_PROMPT = `
Twoim zadaniem jest wcielenie się w rolę asystenta analityka w kancelarii prawno-detektywistycznej. Analizujesz JEDEN dokument, który jest częścią skomplikowanej sprawy dotyczącej oszustwa finansowego. Twoja analiza musi być skrupulatna i niezwykle dokładna.
Przeanalizuj dostarczony tekst i/lub obrazy, a następnie wyekstrahuj WSZYSTKIE kluczowe informacje, wypełniając poniższy schemat JSON. Nic nie może zostać pominięte.
Instrukcje szczegółowe:
- document_source: To pole zostanie wypełnione automatycznie, zostaw je puste.
- summary: Stwórz obiektywne, szczegółowe streszczenie. Rozpocznij od słów "Dokument '__FILENAME__'...", a następnie opisz, czego dotyczy, jaki jest jego cel w sprawie (np. dowód wpłaty, wezwanie do zapłaty, historia czatu, umowa) oraz opisz kluczowe zdarzenia i informacje.
- people: Zidentyfikuj WSZYSTKIE osoby wymienione w dokumencie. Podaj ich pełne imię i nazwisko oraz, jeśli to możliwe, ich rolę w sprawie (np. "klient", "oskarżony", "świadek", "przedstawiciel banku").
- companies_and_entities: Wymień wszystkie nazwy firm, banków, giełd kryptowalut, platform inwestycyjnych lub innych podmiotów.
- dates_and_events: Wylistuj wszystkie daty wraz z krótkim opisem zdarzenia, które miało miejsce tego dnia (np. "2023-01-15: Pierwszy kontakt z oszustem", "2023-02-10: Wykonano przelew").
- financial_data: Wyekstrahuj wszystkie dane finansowe. Dla każdej transakcji podaj kwotę z walutą, numery kont (nadawcy i odbiorcy), numery kart, tytuły przelewów.
- contact_info: Zbierz wszystkie dane kontaktowe: numery telefonów, adresy e-mail, adresy zamieszkania, adresy IP.
- key_facts_and_claims: Wypunktuj kluczowe fakty, twierdzenia, obietnice lub groźby, które padają w dokumencie. Cytuj najważniejsze fragmenty, jeśli to konieczne.
Odpowiedz wyłącznie w formacie JSON zgodnym ze schematem. Jeśli jakaś kategoria danych nie występuje w dokumencie, zwróć pustą tablicę \`[]\` lub \`null\` dla obiektów.
`;

const INTERMEDIATE_SCHEMA = {
  responseMimeType: "application/json",
  responseSchema: {
    name: "Intermediate_Fraud_Case_File_Summary",
    schema: {
      type: "object",
      properties: {
        document_source: { type: "string" },
        summary: { type: "string" },
        people: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } }, required: ["name", "role"] } },
        companies_and_entities: { type: "array", items: { type: "string" } },
        dates_and_events: { type: "array", items: { type: "object", properties: { date: { type: "string" }, event: { type: "string" } }, required: ["date", "event"] } },
        financial_data: { type: "array", items: { type: "object", properties: { amount: { type: "string" }, from_account: { type: "string" }, to_account: { type: "string" }, transaction_date: { type: "string" }, description: { type: "string" } } } },
        contact_info: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["email", "phone", "address", "ip"] }, value: { type: "string" } }, required: ["type", "value"] } },
        key_facts_and_claims: { type: "array", items: { type: "string" } }
      },
      required: [ "document_source", "summary", "people", "companies_and_entities", "dates_and_events", "financial_data", "contact_info", "key_facts_and_claims" ]
    }
  }
};

export async function handleInvoiceExtraction(prompt, inputs = [], fileUploads = [], json_schema, model, promptPerPlik) {
  console.log('\n==================================================');
  console.log('=== ROZPOCZYNANIE NOWEGO PROCESU MAP-REDUCE ===');
  console.log('==================================================');
  
  const mapPromptTemplate = promptPerPlik || DEFAULT_INTERMEDIATE_PROMPT;
  
  console.log(`[KONFIGURACJA] Używany model AI: ${model}`);
  if (promptPerPlik) {
    console.log(`[KONFIGURACJA] Użyto promptu dla etapu MAP dostarczonego z n8n o treści: "${promptPerPlik.substring(0, 150)}..."`);
  } else {
    console.log(`[KONFIGURACJA] Użyto domyślnego promptu dla etapu MAP.`);
  }

  if (!json_schema) {
    throw new Error('Final JSON schema is required for the REDUCE step.');
  }

  const filesToProcess = [];
  (inputs || []).forEach(input => {
    if (input.type === 'url' && input.content && input.name) {
      filesToProcess.push({ type: 'url', url: input.content, sourceName: input.name });
    }
  });
  (fileUploads || []).forEach(file => {
    filesToProcess.push({ type: 'upload', sourceName: file.originalname, file });
  });

  if (filesToProcess.length === 0) {
      throw new Error('No files to process. Check your input configuration.');
  }
  if (filesToProcess.length > MAX_FILES) throw new Error(`Too many files. Max is ${MAX_FILES}.`);

  console.log(`[INFO] Łączna liczba plików do przetworzenia: ${filesToProcess.length}`);
  
  const allIntermediateSummaries = [];
  for (let i = 0; i < filesToProcess.length; i += CONCURRENT_MAP_LIMIT) {
    const batch = filesToProcess.slice(i, i + CONCURRENT_MAP_LIMIT);
    console.log(`\n--- Przetwarzanie paczki ${Math.floor(i / CONCURRENT_MAP_LIMIT) + 1} (pliki od ${i + 1} do ${i + batch.length}) ---`);
    
    const mapPromises = batch.map(async (job, index) => {
      const docIdentifier = `[DOC ${i + index + 1}/${filesToProcess.length}: ${job.sourceName}]`;
      try {
        console.log(`\n${docIdentifier} Rozpoczynanie przetwarzania.`);
        let buffer;
        if (job.type === 'url') buffer = await downloadWithRetry(job.url);
        else buffer = job.file.buffer;
        
        let mime = (await detectFileType(buffer))?.mime;
        const lowerCaseName = job.sourceName.toLowerCase();
        
        let images = [], documentText = '', wasProcessed = false;

        if (mime?.startsWith('image/') || lowerCaseName.endsWith('.jpg') || lowerCaseName.endsWith('.jpeg') || lowerCaseName.endsWith('.png')) {
          images = [buffer];
          wasProcessed = true;
        } else if (mime === 'application/pdf' || lowerCaseName.endsWith('.pdf')) {
          images = await convertPdfToAllImageBuffers(buffer);
          wasProcessed = true;
        } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerCaseName.endsWith('.docx')) {
          const result = await mammoth.extractRawText({ buffer });
          documentText = result.value;
          wasProcessed = true;
        } else if (mime === 'application/vnd.oasis.opendocument.text' || lowerCaseName.endsWith('.odt')) {
          const directory = await unzipper.Open.buffer(buffer);
          const contentXmlFile = directory.files.find(file => file.path === 'content.xml');
          if (contentXmlFile) {
            const contentXmlBuffer = await contentXmlFile.buffer();
            const parsedXml = await parseStringPromise(contentXmlBuffer.toString());
            documentText = extractTextFromXml(parsedXml).replace(/\s+/g, ' ').trim();
            wasProcessed = true;
          } else {
             throw new Error('Nie znaleziono pliku content.xml w archiwum .odt');
          }
        } else if (mime === 'application/vnd.ms-outlook' || lowerCaseName.endsWith('.msg')) {
          const msgReader = new MsgReader(buffer);
          const fileData = msgReader.getFileData();
          let emailContent = `--- E-MAIL: ${job.sourceName} ---\n`;
          if(fileData.senderName) emailContent += `Od: ${fileData.senderName} <${fileData.senderEmail}>\n`;
          if(fileData.recipients) emailContent += `Do: ${fileData.recipients.map(r => `${r.name} <${r.email}>`).join(', ')}\n`;
          if(fileData.cc) emailContent += `DW: ${fileData.cc.map(r => `${r.name} <${r.email}>`).join(', ')}\n`;
          if(fileData.messageDeliveryTime) emailContent += `Data: ${fileData.messageDeliveryTime}\n`;
          if(fileData.subject) emailContent += `Temat: ${fileData.subject}\n`;
          emailContent += `--------------------------------------\n\n${fileData.body}`;
          documentText = emailContent;
          wasProcessed = true;
        } else {
          console.warn(`${docIdentifier} UWAGA: Nieznany typ pliku (${mime}). Próba przetworzenia jako PDF...`);
          try {
            images = await convertPdfToAllImageBuffers(buffer);
            if (images.length > 0) wasProcessed = true;
          } catch (e) {
            console.error(`${docIdentifier} BŁĄD: Plik nie jest ani PDF, ani obrazem. Pomijanie.`);
          }
        }

        if (!wasProcessed) {
          return { document_source: job.sourceName, summary: `Pominięto - nie udało się przetworzyć pliku typu: ${mime}`, error: false };
        }
        
        const imagesForAnalysis = images.slice(0, MAX_IMAGES_PER_DOCUMENT);
        
        if (imagesForAnalysis.length > 0) {
          let ocrText = '';
          for (let i = 0; i < imagesForAnalysis.length; i++) {
            ocrText += await detectTextInImageBuffer(imagesForAnalysis[i], `${docIdentifier} Strona ${i+1}`) + '\n\n';
          }
          documentText += ocrText;
        }
        
        if (documentText.trim() === '' && imagesForAnalysis.length === 0) {
          return { document_source: job.sourceName, summary: `Pominięto - brak treści do analizy`, error: false }; 
        }

        const finalMapPrompt = mapPromptTemplate.replace(/__FILENAME__/g, `'${job.sourceName}'`);
        const intermediateResult = await callGemini(finalMapPrompt, imagesForAnalysis, model, INTERMEDIATE_SCHEMA, documentText);
        
        intermediateResult.document_source = job.sourceName;
        
        console.log(`${docIdentifier} Zakończono etap MAP z sukcesem.`);
        console.log(`PODSUMOWANIE AI dla pliku "${job.sourceName}": ${intermediateResult.summary}`);

        return intermediateResult;
      } catch (error) {
        console.error(`${docIdentifier} KRYTYCZNY BŁĄD w etapie MAP:`, error.message);
        return { document_source: job.sourceName, summary: `Failed to process: ${error.message}`, error: true };
      }
    });

    const batchResults = await Promise.all(mapPromises);
    allIntermediateSummaries.push(...batchResults);
  }

  const successfulSummaries = allIntermediateSummaries.filter(s => s && !s.error);

  if (successfulSummaries.length === 0) {
    throw new Error('Etap MAP nie wygenerował żadnych poprawnych streszczeń. Nie można kontynuować do etapu REDUCE.');
  }

  console.log(`\n--- ETAP REDUCE: Synteza raportu z ${successfulSummaries.length} poprawnych streszczeń ---`);
  
  const finalContext = `
  Otrzymałem streszczenia z ${successfulSummaries.length} dokumentów. Twoim zadaniem jest ich synteza w jeden, spójny raport, zgodny z przekazanym głównym promptem i finalnym schematem JSON.

  --- ZEBRANE DANE Z POSZCZEGÓLNYCH DOKUMENTÓW ---
  ${JSON.stringify(successfulSummaries, null, 2)}
  --- KONIEC ZEBRANYCH DANYCH ---

  Teraz, na podstawie powyższych danych, wygeneruj finalny raport.`;
  
  try {
    const finalResult = await callGemini(prompt, [], model, json_schema, finalContext);
    console.log('[SUCCESS] Etap REDUCE zakończony pomyślnie.');
    return finalResult;
  } catch (error) {
    console.error('[FATAL] Błąd w etapie REDUCE:', error);
    throw new Error(`Failed to synthesize the final report: ${error.message}`);
  }
}