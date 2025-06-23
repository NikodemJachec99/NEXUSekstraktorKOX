Getting Started
1. Clone this repository or copy the files into your own project.
2. Install Dependencies:
```bash
npm install
```

3. Create a .env File at the project root (see sample below):
```makefile
API_KEY=YOUR_CUSTOM_API_KEY
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
GOOGLE_CREDENTIALS=BASE64_ENCODED_GOOGLE_SERVICE_ACCOUNT_JSON
PORT=3000
```

4. Start the Server:
```bash
npm run start
```

The server should be running on `http://localhost:3000`

Uploads are limited to 10 MB per file by default.

## Endpoints

- `POST /extract` – Generic extraction endpoint. Optional body parameter `ocrProvider` can be `google` or `openai`.
- `POST /extract-invoice` – Invoice specific extraction processed via Gemini with automatic total calculations.
