import { readFile, writeFile } from "node:fs/promises";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is required.");
}

const model = "gemini-2.5-flash";
const template = await readFile(
new URL("../prompts/elsewhere/plan-trip-v2.md", import.meta.url),
  "utf8",
);

function render(values) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_m, key) => {
    if (!(key in values)) {
      throw new Error(`Missing value: ${key}`);
    }
    return String(values[key]);
  });
}

function transportLegSchema() {
  return {
    type: "OBJECT",
    required: [
      "type",
      "transport_mode",
      "identifier",
      "operator",
      "departure",
      "arrival",
    ],
    properties: {
      type: { type: "STRING", enum: ["flight", "train"] },
      transport_mode: { type: "STRING", enum: ["airplane", "train"] },
      identifier: { type: "STRING" },
      operator: { type: "STRING" },
      departure: {
        type: "OBJECT",
        required: ["station", "time"],
        properties: {
          station: { type: "STRING" },
          time: { type: "STRING" },
        },
      },
      arrival: {
        type: "OBJECT",
        required: ["station", "time"],
        properties: {
          station: { type: "STRING" },
          time: { type: "STRING" },
        },
      },
    },
  };
}

function activitySchema() {
  return {
    type: "OBJECT",
    required: [
      "time_slot",
      "location",
      "address",
      "type",
      "description",
      "arrival_context",
      "real_time_info",
    ],
    properties: {
      time_slot: { type: "STRING" },
      location: { type: "STRING" },
      address: { type: "STRING" },
      type: {
        type: "STRING",
        enum: [
          "sightseeing",
          "food",
          "transport",
          "shopping",
          "accommodation",
        ],
      },
      description: { type: "STRING" },
      arrival_context: {
        type: "OBJECT",
        required: [
          "from_location",
          "transport_mode",
          "duration_minutes",
        ],
        properties: {
          from_location: { type: "STRING" },
          transport_mode: {
            type: "STRING",
            enum: ["airplane", "train", "car", "subway", "walk"],
          },
          duration_minutes: {
            type: "INTEGER",
            minimum: 0,
            maximum: 600,
          },
        },
      },
      route: {
        type: "OBJECT",
        required: [
          "from_location",
          "to_location",
          "transport_mode",
        ],
        properties: {
          from_location: { type: "STRING" },
          to_location: { type: "STRING" },
          transport_mode: {
            type: "STRING",
            enum: ["airplane", "train", "car", "subway", "walk"],
          },
        },
      },
      real_time_info: {
        type: "OBJECT",
        required: ["live_update"],
        properties: {
          live_update: { type: "STRING" },
        },
      },
    },
  };
}

function planSchema() {
  return {
    type: "OBJECT",
    required: ["tripId", "metadata", "transportation", "daily_itinerary"],
    properties: {
      tripId: { type: "STRING" },
      metadata: {
        type: "OBJECT",
        required: ["origin", "destination", "days"],
        properties: {
          origin: { type: "STRING" },
          destination: { type: "STRING" },
          days: { type: "INTEGER", minimum: 1, maximum: 14 },
        },
      },
      transportation: {
        type: "OBJECT",
        required: ["departure", "return"],
        properties: {
          departure: transportLegSchema(),
          return: transportLegSchema(),
        },
      },
      daily_itinerary: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["day", "date", "weather_forecast", "theme", "activities"],
          properties: {
            day: { type: "INTEGER" },
            date: { type: "STRING" },
            weather_forecast: { type: "STRING" },
            theme: { type: "STRING" },
            activities: {
              type: "ARRAY",
              items: activitySchema(),
            },
          },
        },
      },
    },
  };
}

async function callGemini(prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: planSchema(),
          temperature: 0.3,
          maxOutputTokens: 16384,
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (!text) {
    throw new Error("Gemini response did not contain JSON text.");
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    await writeFile(
      new URL("../docs/plan-probe-v2-last-raw.txt", import.meta.url),
      text,
      "utf8",
    );
    throw error;
  }
}

const cases = [
  {
    tripId: "probe-beijing-tianjin-3d",
    originCity: "北京",
    destinationCity: "天津",
    tripDays: 3,
    startWindow: "Choose the nearest realistic 3-day departure window.",
    output: new URL("../docs/plan-probe-v2-beijing-tianjin-3d.json", import.meta.url),
  },
  {
    tripId: "probe-shanghai-tokyo-5d",
    originCity: "上海",
    destinationCity: "东京",
    tripDays: 5,
    startWindow: "Choose the nearest realistic 5-day departure window.",
    output: new URL("../docs/plan-probe-v2-shanghai-tokyo-5d.json", import.meta.url),
  },
].filter((testCase) => {
  const only = process.env.PLAN_PROBE_ONLY;
  return !only || testCase.tripId === only;
});

for (const testCase of cases) {
  const prompt = render({
    tripId: testCase.tripId,
    currentDate: new Date().toISOString().slice(0, 10),
    originCity: testCase.originCity,
    destinationCity: testCase.destinationCity,
    tripDays: testCase.tripDays,
    startWindow: testCase.startWindow,
    personaSummary: [
      "Name: 小美",
      "Traits: 敏感, 黏人, 恋人感",
      "Relationship to user: 恋人",
      "Tone style: 亲密",
    ].join("\n"),
  });

  const result = await callGemini(prompt);
  await writeFile(testCase.output, JSON.stringify(result, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        output: testCase.output.pathname,
        destination: result.metadata?.destination,
        days: result.metadata?.days,
      },
      null,
      2,
    ),
  );
}
