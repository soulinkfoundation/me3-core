import {
  AGENT_CHECKOUT_HOLD_MINUTES,
  AGENT_COMMERCE_API_VERSION,
  BUYER_INSTALL_AUDIENCE,
  BUYER_INSTALL_HEADER,
} from "./agent-commerce";

// Public OpenAPI document for one site's agent commerce API. me.json `book` and
// `purchase` actions point here with operationId `createCheckout`.
export function buildAgentCommerceOpenApi(input: { serverUrl: string; siteName: string }) {
  const errors = {
    400: { $ref: "#/components/responses/Error" },
    401: { $ref: "#/components/responses/Error" },
    403: { $ref: "#/components/responses/Error" },
    404: { $ref: "#/components/responses/Error" },
    409: { $ref: "#/components/responses/Error" },
    429: { $ref: "#/components/responses/Error" },
    503: { $ref: "#/components/responses/Error" },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: `${input.siteName} agent commerce`,
      version: `${AGENT_COMMERCE_API_VERSION}.0.0`,
      description: [
        "Book and buy from this ME3 site on behalf of a person.",
        "List offerings, check live availability, then create a checkout with the exact price the buyer approved.",
        "The buyer pays on their own device by opening payUrl; agents never pay here.",
        `Booking slots are held for ${AGENT_CHECKOUT_HOLD_MINUTES} minutes. Opening payUrl inside the hold keeps the slot until the payment page closes.`,
        "All amounts are integers in the currency's minor unit (6000 means 60.00).",
        "Retry a checkout with the same idempotencyKey to get the same checkout back.",
      ].join(" "),
    },
    servers: [{ url: input.serverUrl }],
    security: [{}, { buyerInstall: [] }],
    paths: {
      "/offerings": {
        get: {
          operationId: "listOfferings",
          summary: "List offerings an agent can check out",
          responses: {
            200: {
              description: "Agent-ready offerings with live prices.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["offerings"],
                    properties: {
                      offerings: { type: "array", items: { $ref: "#/components/schemas/Offering" } },
                    },
                  },
                },
              },
            },
            ...errors,
          },
        },
      },
      "/offerings/{offeringId}/availability": {
        get: {
          operationId: "getOfferingAvailability",
          summary: "Bookable slots for an offering",
          parameters: [
            { name: "offeringId", in: "path", required: true, schema: { type: "string" } },
            {
              name: "from",
              in: "query",
              description: "Seller-local date (YYYY-MM-DD) or RFC 3339 time. Defaults to today.",
              schema: { type: "string" },
            },
            {
              name: "to",
              in: "query",
              description: "Inclusive seller-local date or RFC 3339 time. Defaults to seven days; at most 31.",
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Slots in UTC with the seller-local date and time.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Availability" } } },
            },
            ...errors,
          },
        },
      },
      "/checkouts": {
        post: {
          operationId: "createCheckout",
          summary: "Create a checkout the buyer pays on their own device",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CheckoutRequest" } } },
          },
          responses: {
            201: {
              description: "Checkout created. Keep statusSecret: it is needed to read the checkout.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreatedCheckout" } } },
            },
            200: {
              description: "The checkout already created with this idempotencyKey.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreatedCheckout" } } },
            },
            ...errors,
          },
        },
      },
      "/checkouts/{checkoutId}": {
        get: {
          operationId: "getCheckout",
          summary: "Checkout status, booking or order reference and paid amount",
          security: [{ checkoutStatusSecret: [] }],
          parameters: [
            { name: "checkoutId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "Current checkout state.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Checkout" } } },
            },
            ...errors,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        checkoutStatusSecret: {
          type: "http",
          scheme: "bearer",
          description: "The statusSecret returned when the checkout was created.",
        },
        buyerInstall: {
          type: "apiKey",
          in: "header",
          name: BUYER_INSTALL_HEADER,
          description: `Optional ME3 Cloud-signed JWT for the buying installation (aud ${BUYER_INSTALL_AUDIENCE}, install_id, at most 15 minutes). Raises rate limits; anonymous requests also work.`,
        },
      },
      responses: {
        Error: {
          description: "The request was refused.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
      schemas: {
        Offering: {
          type: "object",
          required: ["id", "kind", "title", "amount", "currency", "free", "requiresSlot", "maxQuantity", "buyerFields", "refundPolicy"],
          properties: {
            id: { type: "string", description: "Matches the offering id in me.json." },
            kind: { type: "string", enum: ["booking", "event", "product"] },
            title: { type: "string" },
            description: { type: "string" },
            amount: { type: "integer", minimum: 0, description: "Minor units; per attendee for events." },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            free: { type: "boolean" },
            durationMinutes: { type: "integer" },
            timezone: { type: "string", description: "The seller's IANA timezone." },
            eventType: { type: "string", enum: ["class", "retreat"] },
            schedule: { type: "object", additionalProperties: true },
            capacity: { type: ["integer", "null"] },
            online: { type: "boolean" },
            requiresSlot: { type: "boolean" },
            maxQuantity: { type: "integer", minimum: 1 },
            buyerFields: { type: "array", items: { type: "string", enum: ["name", "email"] } },
            refundPolicy: { type: ["string", "null"] },
          },
        },
        Availability: {
          type: "object",
          required: ["offeringId", "kind", "available", "slots"],
          properties: {
            offeringId: { type: "string" },
            kind: { type: "string", enum: ["booking", "event", "product"] },
            timezone: { type: "string" },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            available: { type: "boolean" },
            slots: {
              type: "array",
              items: {
                type: "object",
                required: ["start", "end", "localDate", "localTime"],
                properties: {
                  start: { type: "string", format: "date-time" },
                  end: { type: "string", format: "date-time" },
                  localDate: { type: "string" },
                  localTime: { type: "string" },
                  remaining: { type: ["integer", "null"], description: "Spaces left for events." },
                },
              },
            },
          },
        },
        CheckoutRequest: {
          type: "object",
          required: ["offeringId", "buyer", "expectedAmount", "expectedCurrency", "idempotencyKey"],
          properties: {
            offeringId: { type: "string" },
            slot: {
              type: "object",
              required: ["start"],
              description: "Required for bookings and classes: a slot from the availability endpoint.",
              properties: {
                start: { type: "string", format: "date-time" },
                end: { type: "string", format: "date-time" },
              },
            },
            quantity: { type: "integer", minimum: 1, default: 1, description: "Attendees; events only." },
            buyer: {
              type: "object",
              required: ["name", "email"],
              description: "Shared with the seller only after the buyer approved the purchase.",
              properties: {
                name: { type: "string", maxLength: 120 },
                email: { type: "string", format: "email" },
              },
            },
            expectedAmount: {
              type: "integer",
              minimum: 0,
              description: "The total the buyer approved in minor units: offering amount times quantity. A different live price is refused with price_changed.",
            },
            expectedCurrency: { type: "string", pattern: "^[A-Za-z]{3}$" },
            idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
          },
        },
        Checkout: {
          type: "object",
          required: ["checkoutId", "status", "offeringId", "kind", "quantity", "amount", "currency", "payUrl", "expiresAt", "reference", "paidAmount", "paidCurrency", "paidAt"],
          properties: {
            checkoutId: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "paid", "expired", "cancelled"],
              description: "paid also covers free offerings, confirmed at once with amount 0. cancelled means the seller cancelled or refunded it.",
            },
            offeringId: { type: "string" },
            kind: { type: "string", enum: ["booking", "event", "product"] },
            quantity: { type: "integer" },
            slot: {
              type: ["object", "null"],
              properties: {
                start: { type: "string", format: "date-time" },
                end: { type: "string", format: "date-time" },
              },
            },
            amount: { type: "integer" },
            currency: { type: "string" },
            payUrl: {
              type: ["string", "null"],
              format: "uri",
              description: "Open on the buyer's own device to pay. Null once paid, expired or for free offerings.",
            },
            expiresAt: { type: "string", format: "date-time" },
            reference: {
              type: ["object", "null"],
              properties: {
                type: { type: "string", enum: ["booking", "order"] },
                id: { type: "string" },
              },
            },
            paidAmount: { type: ["integer", "null"] },
            paidCurrency: { type: ["string", "null"] },
            paidAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        CreatedCheckout: {
          allOf: [
            { $ref: "#/components/schemas/Checkout" },
            {
              type: "object",
              required: ["statusSecret", "statusUrl"],
              properties: {
                statusSecret: { type: "string", description: "Send as a bearer token to getCheckout." },
                statusUrl: { type: "string", format: "uri" },
              },
            },
          ],
        },
        Error: {
          type: "object",
          required: ["error", "code"],
          properties: {
            error: { type: "string" },
            code: {
              type: "string",
              description: "For example invalid_request, offering_not_found, price_changed, slot_unavailable, idempotency_conflict, agent_checkout_disabled, commerce_unavailable, rate_limited.",
            },
            amount: { type: "integer", description: "With price_changed: the current total." },
            currency: { type: "string" },
            unitAmount: { type: "integer" },
            retryAfterSeconds: { type: "integer" },
          },
        },
      },
    },
  };
}
