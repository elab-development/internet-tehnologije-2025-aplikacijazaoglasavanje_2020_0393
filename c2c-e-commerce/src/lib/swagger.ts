import swaggerJsdoc from "swagger-jsdoc";

const swaggerDefinition: swaggerJsdoc.Options["swaggerDefinition"] = {
  openapi: "3.0.0",
  info: {
    title: "C2C E-Commerce API",
    version: "1.0.0",
    description:
      "RESTful API for the C2C (consumer-to-consumer) e-commerce marketplace. " +
      "Supports user authentication, listings management, orders, reviews, and categories.",
    contact: {
      name: "C2C Market",
    },
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Development server",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Enter the JWT token obtained from POST /api/auth/login",
      },
    },
    schemas: {
      // ─── Reusable error response ────────────────────────────────────────
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string", example: "Something went wrong" },
          status: { type: "integer", example: 400 },
        },
      },

      // ─── User ───────────────────────────────────────────────────────────
      User: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          email: { type: "string", format: "email", example: "john@example.com" },
          name: { type: "string", example: "John Doe" },
          role: { type: "string", enum: ["buyer", "seller", "admin"], example: "buyer" },
          phoneNumber: { type: "string", nullable: true, example: "+381601234567" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },

      // ─── Category ──────────────────────────────────────────────────────
      Category: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          name: { type: "string", example: "Electronics" },
          slug: { type: "string", example: "electronics" },
          description: { type: "string", nullable: true, example: "Gadgets & devices" },
          createdAt: { type: "string", format: "date-time" },
        },
      },

      // ─── Listing ───────────────────────────────────────────────────────
      Listing: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          title: { type: "string", example: "iPhone 15 Pro" },
          description: { type: "string", example: "Brand new, sealed." },
          price: { type: "string", example: "999.99" },
          imageUrl: { type: "string", nullable: true, example: "https://images.unsplash.com/photo-abc" },
          status: { type: "string", enum: ["active", "sold", "removed"], example: "active" },
          sellerId: { type: "integer", example: 1 },
          categoryId: { type: "integer", nullable: true, example: 2 },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },

      // ─── Order ─────────────────────────────────────────────────────────
      Order: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          buyerId: { type: "integer", example: 3 },
          status: {
            type: "string",
            enum: ["pending", "approved", "rejected", "paid", "shipped", "completed", "cancelled"],
            example: "pending",
          },
          totalAmount: { type: "string", example: "1299.98" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },

      // ─── OrderItem ─────────────────────────────────────────────────────
      OrderItem: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          orderId: { type: "integer", example: 1 },
          listingId: { type: "integer", example: 5 },
          quantity: { type: "integer", example: 1 },
          priceAtPurchase: { type: "string", example: "999.99" },
        },
      },

      // ─── Review ────────────────────────────────────────────────────────
      Review: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          rating: { type: "integer", minimum: 1, maximum: 5, example: 4 },
          comment: { type: "string", nullable: true, example: "Great seller!" },
          reviewerId: { type: "integer", example: 3 },
          listingId: { type: "integer", example: 5 },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },

      // ─── Pagination wrapper ────────────────────────────────────────────
      Pagination: {
        type: "object",
        properties: {
          page: { type: "integer", example: 1 },
          limit: { type: "integer", example: 20 },
          total: { type: "integer", example: 57 },
          totalPages: { type: "integer", example: 3 },
        },
      },
    },
  },
  tags: [
    { name: "Auth", description: "Authentication & session management" },
    { name: "Users", description: "User accounts" },
    { name: "Categories", description: "Product categories" },
    { name: "Listings", description: "Marketplace listings" },
    { name: "Orders", description: "Purchase orders" },
    { name: "Reviews", description: "Listing reviews & ratings" },
  ],
};

const options: swaggerJsdoc.Options = {
  swaggerDefinition,
  // Glob patterns pointing to files with @swagger JSDoc annotations
  apis: ["./src/app/api/**/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
