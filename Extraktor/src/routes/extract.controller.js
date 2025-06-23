import express from "express";
import multer from "multer";
import axios from "axios";
import os from "os";
import { handleExtraction } from "../services/extract.service.js";

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * @swagger
 * /extract:
 *   post:
 *     summary: Generyczna ekstrakcja danych z różnych źródeł (OpenAI).
 *     description: |
 *       Akceptuje prompt, opcjonalne dane wejściowe (tekst, linki URL do obrazów/PDF), opcjonalne pliki oraz opcjonalny schemat JSON do strukturyzacji odpowiedzi.
 *       Ten endpoint używa domyślnie modeli OpenAI.
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
 *                 description: Główny prompt lub pytanie do AI.
 *                 format: textarea
 *                 example: "Extract all purchased products and respond with a JSON array."
 *               inputs:
 *                 type: string
 *                 format: textarea
 *                 description: 'Tablica obiektów w formacie JSON: [{"type":"text","content":"..."},{"type":"url","content":"http..."}]'
 *                 example: '[{"type":"text","content":"Grzesiek 1.33 zł, 1 szt"},{"type":"url","content":"https://i.imgur.com/25yvkLt.jpeg"}]'
 *               jsonSchema:
 *                 type: string
 *                 format: textarea
 *                 description: Schemat JSON dla odpowiedzi AI.
 *                 example: '{"type":"object","properties":{"products":{"type":"array"}}}'
 *               model:
 *                 type: string
 *                 description: Model OpenAI do użycia (domyślnie gpt-4o).
 *                 example: "gpt-4o"
 *               postUrl:
 *                 type: string
 *                 description: Opcjonalny URL webhooka do asynchronicznego otrzymania odpowiedzi.
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Pliki do wgrania (obrazy, PDF).
 *     responses:
 *       200:
 *         description: Pomyślna ekstrakcja.
 *       500:
 *         description: Błąd serwera.
 */

router.post("/", upload.any(), async (req, res) => {
  try {
    const { prompt } = req.body;

    let { inputs } = req.body;
    if (typeof inputs === "string") {
      inputs = JSON.parse(inputs);
    }

    let { jsonSchema } = req.body;
    if (typeof jsonSchema === "string") {
      jsonSchema = JSON.parse(jsonSchema);
    }
    const { model = "gpt-4o" } = req.body;
    const { postUrl } = req.body;
    const fileUploads = req.files || [];

    const handleRequest = () => {
        return handleExtraction(prompt, inputs, fileUploads, jsonSchema, model);
    };

    if (postUrl) {
      res.send({ message: "Processing started" });
      try {
        const responseData = await handleRequest();
        await axios.post(postUrl, responseData, { headers: { "Content-Type": "application/json" } });
        console.log("Data successfully sent to webhook.");
      } catch (error) {
        console.error("Error during async processing:", error.message);
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