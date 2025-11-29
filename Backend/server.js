import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId, UUID } from 'mongodb'
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence } from '@langchain/core/runnables'
import multer from 'multer'
import fs from 'fs/promises';
import PDFParser from 'pdf2json'
import { v4 as uuidv4 } from "uuid"
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
const app = express();
app.use(cors())
app.use(express.json())

const upload = multer({ dest: 'uploads/' })
const client = new MongoClient(process.env.MONGODB_URL)
await client.connect()
console.log("connection established")
const db = client.db('ai')
const collection = db.collection('documents')

const usercollection = db.collection('users')
const embedder = new OpenAIEmbeddings({
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: {
        baseURL: 'https://openrouter.ai/api/v1'
    },
    model: "openai/text-embedding-3-small"
})

const model = new ChatOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: "openai/gpt-4.1-mini",
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    maxTokens: 200,
});

// Prompt template
const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful AI assistant. Use ONLY the provided context."],
    ["human", `
Chat History:
{history}

Context:
{context}

Question:
{question}

Answer clearly:`]
]);

//RAG Chain
const ragChain = new RunnableSequence([
    async (input) => {
        const userId = input.userId
        await client.connect()
        const embedding = await embedder.embedQuery(input.question)
        const docs = await collection.aggregate([
            { $match: { userId } },
            {
                $vectorSearch: {
                    index: 'default',
                    queryVector: embedding,
                    path: 'embedding',
                    limit: 3
                }
            }
        ]).toArray()
        await client.close()
        return {
            question: input.question,
            history: input.history?.map(m => `${m.sender}:${m.text}`).join("\n") || "",
            context: docs.map(d => d.text).join('\n\n')
        }
    },
    prompt,
    model
]);

app.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email and Password is required" })
        }
        const existing = await usercollection.findOne({ email })
        if (existing) return res.status(400).json({ error: "Email already exist" })
        const hasedPassword = await bcrypt.hash(password, 10);
        const newuser = {
            email, password: hasedPassword, createdAt: new Date()
        }
        const result = await usercollection.insertOne(newuser)
        return res.status(201).json({ "message": "User registed sucessfully", userId: result.insertedId })
    } catch (err) {
        console.error("register error:", err)
        res.status(500).json("error", 'server error')
    }
})
app.post('/login',async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email and Password is required" })
        }
        const user = await usercollection.findOne({ email })
        if (!user) {
            return res.status(401).json({ error: 'Email and Password is invalid' })
        }
        const isValid = bcrypt.compare(password, user.password)
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid password or email' })
        }
        //JWT payload
        const token = jwt.sign(
            { sub: user._id.toString(), email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        )
        return res.status(200).json({
            message: "Login Successful",
            token,
            user: { email: user.email, id: user._id }
        })
    } catch (err) {
        console.error("Login error", err)
        res.status(500).json("server error")
    }
})

const auth = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" })
    try {
        const decoded=jwt.verify(token,process.env.JWT_SECRET)
        req.user={id:decoded.sub}
        next();
    }catch(err){
        return res.status(401).json({error:'Invalid token'})
    }
}
//API endpoint
app.post('/ask', auth,async (req, res) => {
    try {
        const { question, chatId } = req.body
        const userId = req.user.id
        if (!question) {
            return res.status(400).json({ error: 'question is required' })
        }
        //1.Save the user message
        await db.collection("messages").insertOne({
            chatId,
            userId,
            role: "user",
            text: question,
            createdAt: new Date()
        })

        //2.Run RAG
        const history = await db.collection("messages")
            .find({ chatId })
            .sort({ createdAt: 1 })
            .toArray()

        const answer = await ragChain.invoke({
            question,
            history: history.map(m => ({ sender: m.role, text: m.text })),
            userId
        })
        //Save AI reply
        await db.collection('chats').updateOne(
            { _id: new ObjectId(chatId) },
            { $set: { updatedAt: new Date() } }
        )
        res.status(201).json({ "message": answer.content })
    } catch (err) {
        console.error('Error:', err)
        res.status(500).json({ error: 'server error' })
    }
})

app.post('/upload', auth,upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        const userId = req.user.id;
        const docId = uuidv4()
        if (!file) return res.status(400).json({ "message": "No file uploaded" })
        let text = "";

        //parse PDF
        if (file.mimetype == "application/pdf") {
            const parser = new PDFParser();

            text = await new Promise((resolve, reject) => {
                parser.on("pdfParser_dataError", (err) => reject(err.parserError));
                parser.on("pdfParser_dataReady", (pdfData) => {
                    const allText = pdfData.Pages.map((page) =>
                        page.Texts.map((t) =>
                            decodeURIComponent(t.R[0].T)
                        ).join(" ")
                    ).join("\n\n");

                    resolve(allText);
                });

                parser.loadPDF(file.path);
            });
        }
        //parse plain text files
        if (file.mimetype == "text/plain") {
            text = fs.readFileSync(file.path, 'utf8')
        }
        //Unsupported files
        else {
            return res.status(400).json({ "message": "unsupported file types" })
        }
        //remove temp file
        fs.unlink(file.path)

        //chunk text
        const chunkSize = 500;
        const overlap = 50;
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize - overlap) {
            const chunk = text.slice(i, i + chunkSize)
            chunks.push(chunk)
        }
        //Embed and store in mongoDB
        for (const chunk of chunks) {
            const vector = await embedder.embedQuery(chunk)
            await collection.insertOne({
                userId,
                docId,
                filename: file.originalname,
                text: chunk,
                embedding: vector,
                createdAt: new Date()
            })
        }
        res.json({ message: "File uploaded and processed successfully" })
    } catch (err) {
        console.error("Uploaded error:", err)
        res.status(500).json({ error: "Upload failed" })
    }
})
// use getTextFromFile Supported all file types


// Add Streaming to Your Express.js API
app.post('/ask/stream',auth, async (req, res) => {
    try {
        const { question } = req.body;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader('Cache-Control', 'no-cache');
        res.flushHeaders();
        const stream = await model.stream(question);
        for await (const chunk of stream) {
            res.write(chunk.concat ?? "")
        }
        res.end();
    } catch (err) {
        console.error("Streaming error:", err);
        res.status(500).json({ error: "Streaming Failed" })
    }
})

app.post('/chat', auth,async (req, res) => {
    const userId = req.user.id;
    const { title } = req.body;
    const chat = {
        userId,
        title: title || "New Chat",
        createdAt: new Date(),
        updatedAt: new Date()
    }
    const result = await db.collection("chats").insertOne(chat)
    res.json({ chatId: result.insertedId })
})
app.post('/chats/:chatId/messages',auth, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;
    const { role, text } = req.body;
    await db.collection('messages').insertOne({
        chatId,
        userId,
        role,
        text,
        createdAt: new Date()
    })
    //update chat timestamp
    await db.collection('chats').updateOne(
        { _id: new ObjectId(chatId) },
        { $set: { updatedAt: new Date() } }
    )
    res.json({ success: true })
})
//get all chat sessions
app.get('/chats',auth, async (req, res) => {
    const chats = await db.collection('chats').find({ userId: req.user.id }).sort({ updatedAt: -1 }).toArray()
    res.json({ chats })
})
//load messages of chat 
app.get("/chats/:chatId/messages",auth, async (req, res) => {
    const { chatId } = req.params;
    const messages = await db.collection("messages").find({ chatId }).sort({ createdAt: -1 }).toArray()
    res.json({ messages })
})
//delete the chats
app.delete("/chats/:chatId",auth, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;
    await db.collection("chats").deleteOne({ _id: new ObjectId(chatId), userId })
    await db.collection("messages").deleteMany({ chatId })
    res.json({ success: true })
})
app.listen(3000, () => {
    console.log('server running on port 3000')
})
