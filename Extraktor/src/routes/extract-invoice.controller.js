import express from "express";
import multer from "multer";
import axios from "axios";
import os from "os";
import { handleInvoiceExtraction } from "../services/extractInvoice.service.js";

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * @swagger
 * /extract-invoice:
 *   post:
 *     summary: Przetwarza i analizuje zbiór dokumentów (faktur, umów, etc.).
 *     description: |
 *       Endpoint dedykowany do kompleksowej analizy wielu plików (PDF, DOCX, obrazów) przy użyciu architektury Map-Reduce z Gemini.
 *       Akceptuje listę linków do plików, przetwarza je indywidualnie, a następnie syntetyzuje zbiorczy raport.
 *       Wynik może zostać wysłany asynchronicznie na podany `postUrl` (webhook).
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: Główny prompt dla finalnego raportu (etap REDUCE).
 *                 format: textarea
 *                 example: "Na podstawie poniższych streszczeń, stwórz finalny raport sprawy..."
 *               # ... kolejne pola, Z KAŻDYM KLUCZEM TYLKO RAZ!
 *     responses:
 *       200:
 *         description: Pomyślna ekstrakcja lub rozpoczęcie przetwarzania asynchronicznego.
 *       500:
 *         description: Błąd serwera podczas przetwarzania.
 */

router.post("/", upload.any(), async (req, res) => {
  try {
    const { 
      prompt, 
      postUrl,
      promptPerPlik
    } = req.body;
    
    const model = req.body.model || 'gemini-2.0-flash';

    let { inputs } = req.body;
    if (typeof inputs === "string") {
      try {
        inputs = JSON.parse(inputs);
      } catch (e) {
        return res.status(400).json({ success: false, message: "Invalid JSON in 'inputs' field." });
      }
    }

    let { jsonSchema } = req.body;
    if (typeof jsonSchema === "string") {
      try {
        jsonSchema = JSON.parse(jsonSchema);
      } catch(e) {
        return res.status(400).json({ success: false, message: "Invalid JSON in 'jsonSchema' field." });
      }
    }

    const fileUploads = req.files || [];

    const handleRequest = () => {
      return handleInvoiceExtraction(prompt, inputs, fileUploads, jsonSchema, model, promptPerPlik);
    };

    if (postUrl) {
      res.send({ message: "Processing started. The result will be sent to the webhook." });
      try {
        const responseData = await handleRequest();
        await axios.post(postUrl, responseData, { headers: { "Content-Type": "application/json" } });
        console.log("Data successfully sent to webhook.");
      } catch (error) {
        console.error("Error during asynchronous processing:", error.message);
        axios.post(postUrl, { success: false, error: error.message, message: "Processing failed." })
          .catch(webhookError => console.error("Failed to send error to webhook:", webhookError.message));
      }
    } else {
      const responseData = await handleRequest();
      res.json({
        success: true,
        data: responseData,
      });
    }
  } catch (error) {
    console.error("Extraction error:", error);
    res.status(500).json({
      success: false,
      message: "Extraction failed.",
      error: error.message,
    });
  }
});

export default router;