import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express"; // Import swagger-ui-express

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Data Extractor API",
      version: "1.0.0",
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
  },
  apis: ["src/routes/**/*.js"],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

function setupSwagger(app) {
  app.get("/swagger.json", (_, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customOptions: {
        defaultModelsExpandDepth: -1,
      },
    }),
  );
}

export default setupSwagger;
