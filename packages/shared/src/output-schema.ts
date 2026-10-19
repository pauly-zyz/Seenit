/**
 * Mission output schemas: the JSON Schema a funder attaches to a mission, describing the
 * structured answer the AI vision step extracts from a capture.
 *
 * Only a safe subset of JSON Schema is accepted, so every schema can be (1) sent to Claude as a
 * structured-output format and (2) validated locally with Zod (`z.fromJSONSchema`).
 */

type Json = Record<string, unknown>;

const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

/** Keywords allowed in a mission output schema. */
const ALLOWED_KEYWORDS = new Set([
  "type",
  "title",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "examples",
  "default",
  "format",
  // Checked locally (Zod), stripped from the copy sent to the model.
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
]);

/** Keywords the model-side structured output format does not accept. */
const LOCAL_ONLY_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "examples",
  "default",
]);

/** String formats supported by structured outputs. */
const SUPPORTED_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

export const OUTPUT_SCHEMA_LIMITS = { maxDepth: 6, maxProperties: 60, maxBytes: 16_000 } as const;

/**
 * Returns a list of problems (empty when the schema is usable). Root must be an object with
 * at least one property; no $ref, no recursion, a bounded size.
 */
export function checkOutputSchema(schema: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(schema)) return ["outputSchema must be an object"];
  if (schema.type !== "object") errors.push('outputSchema must have type: "object"');
  if (!isObject(schema.properties) || Object.keys(schema.properties).length === 0) {
    errors.push("outputSchema must declare at least one property");
  }
  if (JSON.stringify(schema).length > OUTPUT_SCHEMA_LIMITS.maxBytes) {
    errors.push(`outputSchema must be under ${OUTPUT_SCHEMA_LIMITS.maxBytes} bytes`);
  }
  let propertyCount = 0;

  const walk = (node: unknown, path: string, depth: number) => {
    if (!isObject(node)) {
      errors.push(`${path} must be a schema object`);
      return;
    }
    if (depth > OUTPUT_SCHEMA_LIMITS.maxDepth) {
      errors.push(`${path} nests deeper than ${OUTPUT_SCHEMA_LIMITS.maxDepth} levels`);
      return;
    }
    for (const key of Object.keys(node)) {
      if (!ALLOWED_KEYWORDS.has(key)) errors.push(`${path}.${key} is not supported`);
    }
    const t = node.type;
    const types = Array.isArray(t) ? t : t === undefined ? [] : [t];
    for (const ty of types) {
      if (typeof ty !== "string" || !TYPES.has(ty))
        errors.push(`${path}.type "${String(ty)}" is not valid`);
    }
    if (
      types.length === 0 &&
      node.enum === undefined &&
      node.const === undefined &&
      node.anyOf === undefined
    ) {
      errors.push(`${path} needs a type, enum, const or anyOf`);
    }
    if (node.format !== undefined && !SUPPORTED_FORMATS.has(String(node.format))) {
      errors.push(`${path}.format "${String(node.format)}" is not supported`);
    }
    if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0)) {
      errors.push(`${path}.enum must be a non-empty array`);
    }
    if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
      errors.push(`${path}.additionalProperties may only be false`);
    }
    if (node.properties !== undefined) {
      if (!isObject(node.properties)) {
        errors.push(`${path}.properties must be an object`);
      } else {
        for (const [k, v] of Object.entries(node.properties)) {
          propertyCount++;
          walk(v, `${path}.properties.${k}`, depth + 1);
        }
        if (node.required !== undefined) {
          const req = node.required;
          if (
            !Array.isArray(req) ||
            req.some((r) => typeof r !== "string" || !(r in (node.properties as Json)))
          ) {
            errors.push(`${path}.required must list declared properties`);
          }
        }
      }
    }
    if (node.items !== undefined) walk(node.items, `${path}.items`, depth + 1);
    if (node.anyOf !== undefined) {
      if (!Array.isArray(node.anyOf) || node.anyOf.length === 0)
        errors.push(`${path}.anyOf must be a non-empty array`);
      else node.anyOf.forEach((s, i) => walk(s, `${path}.anyOf[${i}]`, depth + 1));
    }
  };
  walk(schema, "outputSchema", 0);
  if (propertyCount > OUTPUT_SCHEMA_LIMITS.maxProperties) {
    errors.push(`outputSchema declares more than ${OUTPUT_SCHEMA_LIMITS.maxProperties} properties`);
  }
  return errors;
}

/**
 * The copy of a (checked) mission schema sent to the model as a structured output format:
 * every object is closed (`additionalProperties: false`) and lists all properties as required,
 * with originally-optional ones made nullable; constraint keywords the format doesn't accept
 * are removed (they are still enforced locally with Zod).
 */
export function toModelSchema(schema: Json): Json {
  const convert = (node: Json): Json => {
    const out: Json = {};
    for (const [k, v] of Object.entries(node)) {
      if (LOCAL_ONLY_KEYWORDS.has(k)) continue;
      if (k === "properties" || k === "required" || k === "additionalProperties") continue;
      if (k === "items" && isObject(v)) out.items = convert(v);
      else if (k === "anyOf" && Array.isArray(v)) out.anyOf = v.map((s) => convert(s as Json));
      else out[k] = v;
    }
    if (isObject(node.properties)) {
      const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
      const props: Json = {};
      for (const [k, v] of Object.entries(node.properties)) {
        const child = convert(v as Json);
        props[k] = required.has(k) ? child : { anyOf: [child, { type: "null" }] };
      }
      out.properties = props;
      out.required = Object.keys(props);
      out.additionalProperties = false;
    }
    return out;
  };
  return convert(schema);
}

/**
 * Removes `null` values for properties that were optional in the funder's schema (the model
 * returns null for "not present"; the funder's schema expects the key to be absent).
 */
export function dropNullOptionals(schema: Json, value: unknown): unknown {
  if (Array.isArray(value)) {
    return isObject(schema.items)
      ? value.map((v) => dropNullOptionals(schema.items as Json, v))
      : value;
  }
  if (!isObject(value) || !isObject(schema.properties)) return value;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const out: Json = {};
  for (const [k, v] of Object.entries(value)) {
    const child = (schema.properties as Json)[k];
    if (v === null && !required.has(k)) continue;
    out[k] = isObject(child) ? dropNullOptionals(child, v) : v;
  }
  return out;
}

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ------------------------------------------------------------------------------------------------
// Templates
// ------------------------------------------------------------------------------------------------

export interface OutputSchemaTemplate {
  id: OutputTemplateId;
  name: string;
  description: string;
  mediaType: "photo" | "video";
  /** Starting point for the mission instructions; funders should tailor it. */
  suggestedInstructions: string;
  outputSchema: Json;
}

export const OUTPUT_TEMPLATE_IDS = [
  "stock_check",
  "store_open",
  "construction_progress",
  "billboard_proof",
  "crowd_level",
] as const;
export type OutputTemplateId = (typeof OUTPUT_TEMPLATE_IDS)[number];

/** Ready-made output schemas for common missions. */
export const OUTPUT_SCHEMA_TEMPLATES: Record<OutputTemplateId, OutputSchemaTemplate> = {
  stock_check: {
    id: "stock_check",
    name: "Stock check",
    description: "Is a product on the shelf, roughly how many, and at what price?",
    mediaType: "photo",
    suggestedInstructions:
      "Photograph the shelf where the product is sold, close enough to read labels and price tags.",
    outputSchema: {
      type: "object",
      properties: {
        product_visible: {
          type: "boolean",
          description: "The requested product is visible on the shelf.",
        },
        stock_level: {
          type: "string",
          enum: ["out_of_stock", "low", "medium", "full", "unknown"],
          description: "How full the product's shelf space looks.",
        },
        facings_count: {
          type: "integer",
          minimum: 0,
          description: "Number of product units visible at the front of the shelf.",
        },
        price_text: {
          type: "string",
          maxLength: 60,
          description:
            "Price exactly as shown on the tag, including currency. Omit if not readable.",
        },
        notes: {
          type: "string",
          maxLength: 300,
          description: "Anything notable (promo, damaged stock).",
        },
      },
      required: ["product_visible", "stock_level", "facings_count"],
    },
  },
  store_open: {
    id: "store_open",
    name: "Is the store open?",
    description: "Whether a business is open right now, with any posted hours or notices.",
    mediaType: "photo",
    suggestedInstructions:
      "Photograph the entrance from the outside so the door, signage and any posted notice are visible.",
    outputSchema: {
      type: "object",
      properties: {
        is_open: {
          type: "string",
          enum: ["open", "closed", "unclear"],
          description:
            "Open = doors open or open sign/lights and activity; closed = shutters, closed sign.",
        },
        signage_text: {
          type: "string",
          maxLength: 200,
          description: "Business name as shown on the sign.",
        },
        posted_hours: { type: "string", maxLength: 300, description: "Opening hours if posted." },
        notice_text: {
          type: "string",
          maxLength: 500,
          description: "Text of any temporary notice (closure, renovation, moved).",
        },
      },
      required: ["is_open"],
    },
  },
  construction_progress: {
    id: "construction_progress",
    name: "Construction progress",
    description: "Stage of a construction site, visible activity and equipment.",
    mediaType: "video",
    suggestedInstructions:
      "Record a slow pan of the whole site from a public spot (10–20 s). Include the tallest part of the structure.",
    outputSchema: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          enum: [
            "not_started",
            "site_preparation",
            "foundation",
            "structure",
            "enclosure",
            "finishing",
            "completed",
            "unclear",
          ],
        },
        visible_floors: {
          type: "integer",
          minimum: 0,
          description: "Floors visibly built so far.",
        },
        active_work: { type: "boolean", description: "Workers or machines visibly working." },
        equipment: {
          type: "array",
          maxItems: 10,
          items: {
            type: "string",
            enum: ["crane", "excavator", "concrete_mixer", "scaffolding", "truck", "other"],
          },
        },
        notes: { type: "string", maxLength: 400 },
      },
      required: ["stage", "active_work", "equipment"],
    },
  },
  billboard_proof: {
    id: "billboard_proof",
    name: "Billboard proof of posting",
    description: "Confirms an ad is up at a billboard location and in good condition.",
    mediaType: "photo",
    suggestedInstructions:
      "Photograph the whole billboard face, straight on if possible, with some surroundings for context.",
    outputSchema: {
      type: "object",
      properties: {
        ad_present: {
          type: "boolean",
          description: "An advertisement is displayed on the billboard.",
        },
        brand_or_headline: {
          type: "string",
          maxLength: 200,
          description: "Brand name or headline visible in the ad.",
        },
        condition: { type: "string", enum: ["good", "damaged", "obstructed", "unlit", "unclear"] },
        is_digital: {
          type: "boolean",
          description: "Digital screen rather than a printed poster.",
        },
      },
      required: ["ad_present", "condition"],
    },
  },
  crowd_level: {
    id: "crowd_level",
    name: "Crowd level",
    description: "How busy a place is (queue, venue, station) right now.",
    mediaType: "video",
    suggestedInstructions:
      "Record 10 seconds showing the whole queue or area. Keep your distance and don't focus on any one person.",
    outputSchema: {
      type: "object",
      properties: {
        crowd_level: { type: "string", enum: ["empty", "light", "moderate", "busy", "packed"] },
        estimated_people: {
          type: "integer",
          minimum: 0,
          description: "Rough count of people visible.",
        },
        queue_present: { type: "boolean" },
        estimated_wait_minutes: {
          type: "integer",
          minimum: 0,
          description: "Only if a queue is visible and the wait can be estimated.",
        },
      },
      required: ["crowd_level", "estimated_people", "queue_present"],
    },
  },
};
