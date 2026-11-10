import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// AI Parser Endpoint
app.post('/api/parse-shipment', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `Extract shipment data from this text: "${text}". 
      Fields needed: name (اسم النقلة), category (الصنف), count (العدد), premium (البياعة), weight (الوزن), price (السعر), customerName (اسم الزبون).
      If a field is not found, return 0 for numbers or "غير محدد" for strings.
      The text is likely in Arabic.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "اسم النقلة" },
            category: { type: Type.STRING, description: "الصنف" },
            count: { type: Type.NUMBER, description: "العدد" },
            premium: { type: Type.NUMBER, description: "البياعة" },
            weight: { type: Type.NUMBER, description: "الوزن" },
            price: { type: Type.NUMBER, description: "السعر" },
            customerName: { type: Type.STRING, description: "اسم الزبون" }
          },
          required: ["name", "category", "count", "premium", "weight", "price", "customerName"]
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    res.json(result);
  } catch (error: any) {
    console.error('Gemini Error:', error);
    res.status(500).json({ error: 'Failed to parse text' });
  }
});

// Production Setup
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  // In development, Vite handles the frontend
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
