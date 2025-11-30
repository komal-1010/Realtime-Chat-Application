import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import multer from "multer";
import fs from "fs/promises";
import PDFParser from "pdf2json";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(express.json());

// ---------- FILE UPLOAD ----------
const upload = multer({ dest: "uploads/" });

// ---------- MONGODB ----------
const client = new MongoClient(process.env.MONGODB_URL);
await client.connect();
console.log("MongoDB connection established");

const db = client.db("ai");
const collection = db.collection("documents");
const usercollection = db.collection("users");

// ---------- OPENAI MODELS ----------
const embedder = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  apiKey: process.env.OPENAI_API_KEY,
});

const model = new ChatOpenAI({
  model: "gpt-4.1-mini",
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- PROMPT ----------
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful AI assistant. Use ONLY the provided context."],
  [
    "human",
    `
Chat History:
{history}

Context:
{context}

Question:
{question}

Answer clearly:`,
  ],
]);

// ---------- RAG CHAIN ----------
const ragChain = RunnableSequence.from([
  // 1) Build RAG context
  async (input) => {
    const userId = input.userId;

    // embed question
    const embedding = await embedder.embedQuery(input.question);

    // find matching docs
    const docs = await collection
      .aggregate([
        { $match: { userId } },
        {
          $vectorSearch: {
            index: "default",
            queryVector: embedding,
            path: "embedding",
            limit: 3,
          },
        },
      ])
      .toArray();

    return {
      question: input.question,
      history:
        input.history?.map((m) => `${m.sender}: ${m.text}`).join("\n") || "",
      context: docs.map((d) => d.text).join("\n\n"),
    };
  },
  // 2) Fill prompt
  prompt,
  // 3) Call model
  model,
]);

// ---------- AUTH HELPERS ----------
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.sub };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ---------- AUTH ROUTES ----------
app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and Password are required" });
    }

    const existing = await usercollection.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newuser = {
      email,
      password: hashedPassword,
      createdAt: new Date(),
    };
    const result = await usercollection.insertOne(newuser);

    return res
      .status(201)
      .json({ message: "User registered successfully", userId: result.insertedId });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ error: "server error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and Password are required" });
    }

    const user = await usercollection.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Email or password is invalid" });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Email or password is invalid" });
    }

    const token = jwt.sign(
      { sub: user._id.toString(), email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      message: "Login Successful",
      token,
      user: { email: user.email, id: user._id },
    });
  } catch (err) {
    console.error("Login error", err);
    res.status(500).json({ error: "server error" });
  }
});

// ---------- CHAT ROUTES ----------

// Create chat
app.post("/chat", auth, async (req, res) => {
  const userId = req.user.id;
  const { title } = req.body;
  const chat = {
    userId,
    title: title || "New Chat",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await db.collection("chats").insertOne(chat);
  res.json({ chatId: result.insertedId });
});

// Save message (generic)
app.post("/chats/:chatId/messages", auth, async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;
  const { role, text } = req.body;

  await db.collection("messages").insertOne({
    chatId,
    userId,
    role,
    text,
    createdAt: new Date(),
  });

  await db.collection("chats").updateOne(
    { _id: new ObjectId(chatId) },
    { $set: { updatedAt: new Date() } }
  );

  res.json({ success: true });
});

// Get all chats
app.get("/chats", auth, async (req, res) => {
  const chats = await db
    .collection("chats")
    .find({ userId: req.user.id })
    .sort({ updatedAt: -1 })
    .toArray();
  res.json({ chats });
});

// Get messages of a chat
app.get("/chats/:chatId/messages", auth, async (req, res) => {
  const { chatId } = req.params;
  const messages = await db
    .collection("messages")
    .find({ chatId })
    .sort({ createdAt: 1 })
    .toArray();
  res.json({ messages });
});

// Delete chat
app.delete("/chats/:chatId", auth, async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.id;

  await db.collection("chats").deleteOne({ _id: new ObjectId(chatId), userId });
  await db.collection("messages").deleteMany({ chatId });

  res.json({ success: true });
});

// ---------- RAG /ask (non-stream) ----------
app.post("/ask", auth, async (req, res) => {
  try {
    const { question, chatId } = req.body;
    const userId = req.user.id;

    if (!question) {
      return res.status(400).json({ error: "question is required" });
    }
    if (!chatId) {
      return res.status(400).json({ error: "chatId is required" });
    }

    // 1. Save user message
    await db.collection("messages").insertOne({
      chatId,
      userId,
      role: "user",
      text: question,
      createdAt: new Date(),
    });

    // 2. Load history
    const history = await db
      .collection("messages")
      .find({ chatId })
      .sort({ createdAt: 1 })
      .toArray();

    // 3. Run RAG chain
    const answer = await ragChain.invoke({
      question,
      history: history.map((m) => ({ sender: m.role, text: m.text })),
      userId,
    });

    const answerText =
      typeof answer.content === "string"
        ? answer.content
        : Array.isArray(answer.content)
        ? answer.content.map((c) => c?.text ?? "").join("")
        : String(answer.content ?? "");

    // 4. Save AI reply
    await db.collection("messages").insertOne({
      chatId,
      userId,
      role: "assistant",
      text: answerText,
      createdAt: new Date(),
    });

    await db.collection("chats").updateOne(
      { _id: new ObjectId(chatId) },
      { $set: { updatedAt: new Date() } }
    );

    res.status(201).json({ message: answerText });
  } catch (err) {
    console.error("Error in /ask:", err);
    res.status(500).json({ error: "server error" });
  }
});

// ---------- STREAMING (no RAG, just model) ----------
app.post("/ask/stream", auth, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: "question is required" });
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const stream = await model.stream([
      { role: "user", content: question },
    ]);

    for await (const chunk of stream) {
      const text = chunk?.delta?.content || "";
      if (text) {
        res.write(text);
      }
    }

    res.end();
  } catch (err) {
    console.error("Streaming error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Streaming Failed" });
    } else {
      try {
        res.end();
      } catch {}
    }
  }
});

// ---------- FILE UPLOAD / RAG INGEST ----------
app.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const userId = req.user.id;
    const docId = uuidv4();

    if (!file) return res.status(400).json({ message: "No file uploaded" });

    let text = "";

    if (file.mimetype === "application/pdf") {
      const parser = new PDFParser();

      text = await new Promise((resolve, reject) => {
        parser.on("pdfParser_dataError", (err) => reject(err.parserError));
        parser.on("pdfParser_dataReady", (pdfData) => {
          const allText = pdfData.Pages.map((page) =>
            page.Texts.map((t) => decodeURIComponent(t.R[0].T)).join(" ")
          ).join("\n\n");
          resolve(allText);
        });

        parser.loadPDF(file.path);
      });
    } else if (file.mimetype === "text/plain") {
      text = await fs.readFile(file.path, "utf8");
    } else {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ message: "unsupported file type" });
    }

    // Remove temp file
    await fs.unlink(file.path).catch(() => {});

    // Chunk text
    const chunkSize = 500;
    const overlap = 50;
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
      const chunk = text.slice(i, i + chunkSize);
      chunks.push(chunk);
    }

    // Embed and store in MongoDB
    for (const chunk of chunks) {
      const vector = await embedder.embedQuery(chunk);
      await collection.insertOne({
        userId,
        docId,
        filename: file.originalname,
        text: chunk,
        embedding: vector,
        createdAt: new Date(),
      });
    }

    res.json({ message: "File uploaded and processed successfully" });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ---------- START SERVER ----------
app.listen(3000, () => {
  console.log("server running on port 3000");
});
