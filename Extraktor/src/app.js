import "dotenv/config"; // Loads environment variables from .env
import express from "express";
import multer from "multer";
import checkApiKey from "./middlewares/auth.js";
import extractRouter from "./routes/extract.controller.js";
import extractInvoiceRouter from "./routes/extract-invoice.controller.js";
import setupSwagger from "./utils/swagger.js";

const app = express();
const port = process.env.PORT || 3000;

// Parse JSON and URL-encoded bodies with increased limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// setting up route for swagger
setupSwagger(app);

// Authentication middleware
app.use(checkApiKey);

// Mount the extract route
app.use("/extract", extractRouter);
app.use("/extract-invoice", extractInvoiceRouter);

// Simple health check
app.get("/", (req, res) => {
  res.send("API is running");
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
