import { WebSocket, WebSocketServer } from 'ws';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { getSystemPrompt } from './prompts';

// Load environment variables from frontend and backend directories
const cwd = process.cwd();
const frontendEnv = path.join(cwd, '.env');
const backendEnv = path.join(cwd, '../backend/.env');

if (fs.existsSync(frontendEnv)) {
  dotenv.config({ path: frontendEnv });
} else {
  const fallbackFrontend = path.join(cwd, 'frontend', '.env');
  if (fs.existsSync(fallbackFrontend)) {
    dotenv.config({ path: fallbackFrontend });
  }
}

if (fs.existsSync(backendEnv)) {
  dotenv.config({ path: backendEnv });
} else {
  const fallbackBackend = path.join(cwd, 'backend', '.env');
  if (fs.existsSync(fallbackBackend)) {
    dotenv.config({ path: fallbackBackend });
  }
}

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

let openaiClient: OpenAI | null = null;
let groqClient: OpenAI | null = null;

if (OPENAI_API_KEY) {
  openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
}
if (GROQ_API_KEY) {
  groqClient = new OpenAI({
    apiKey: GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });
}

const keywordList = [
  "multithreading", "backend", "frontend", "LLM", "RAG", "API",
  "React", "FastAPI", "type hints", "Pydantic", "BaseModel", "CORS",
  "Node.js", "LoRA", "fine-tuning", "zero-shot", "few-shot", "vector database",
  "Chain-of-Thought", "CoT", "hallucination", "Hugging Face", "semantic search",
  "ChromaDB", "LangGraph", "LangChain", "LiteLLM", "qTest", "NetApp",
  "Graphene", "Next.js", "Redux", "DevOps", "CI/CD",
  "ChatGPT", "Anthropic", "Llama", "Mistral", "Langfuse", "vLLM",
  "quantization", "chunking", "embeddings", "Prompt Engineering",
  "ROUGE", "BLEU", "FAISS", "Qdrant", "Pinecone", "Agentic", "CrewAI", "AutoGen",
  "PostgreSQL", "MongoDB", "Redis", "Kafka", "GraphQL", "WebSockets",
  "Kubernetes", "Tailwind", "Zustand", "Vite", "OAuth", "JWT",
  "Nginx", "SQLAlchemy", "Prisma", "ORM",
  "Context API", "useEffect", "useState", "useMemo", "useCallback",
  "Virtual DOM", "React Router", "Next.js App Router", "Server Components",
  "Client Components", "hydration", "memoization", "lazy loading",
  "Redux Thunk", "Redux Saga", "Redux Toolkit", "RTK", "React Query",
  "TanStack", "Material UI", "MUI", "Framer Motion", "Webpack", "Babel",
  "Event Loop", "libuv", "V8 engine", "Call Stack", "Microtask Queue",
  "Macrotask Queue", "Worker Threads", "Child Processes", "streams",
  "EventEmitter", "middleware", "Express", "NestJS", "CommonJS", "ESM",
  "SSR", "SSG", "ISR", "CSR", "App Router", "Pages Router",
  "getStaticProps", "getServerSideProps", "Server Actions",
  "Code Splitting", "Image Optimization",
  "uvicorn", "Alembic", "asyncio", "FastAPI cors", "response_model",
  "LangChain Expression Language", "LCEL", "Runnable", "PromptTemplate",
  "Chroma", "OpenAIEmbeddings", "ColBERT", "Momentum Black",
  "ChatPromptTemplate", "MessagesPlaceholder", "StrOutputParser",
  "Docker", "docker-compose", "GitHub Actions", "GitLab CI", "Azure DevOps",
  "CI/CD pipeline", "deployment", "automation", "Azure App Service",
  "MySQL", "OpenSearch", "Supabase", "Azure Blob Storage", "Cloud Storage", "data persistence",
  "Retrieval Augmented Generation", "zero-shot prompting", "few-shot prompting",
  "parameter-efficient fine-tuning", "PEFT", "QLoRA", "instruction following", "role-playing"
];

const keywordsQuery = keywordList.map(k => `&keywords=${encodeURIComponent(k)}:2`).join('');
const DEEPGRAM_URL = `wss://api.deepgram.com/v1/listen?model=nova-2&language=en-IN&smart_format=true${keywordsQuery}`;

export function startWebSocketServer(port: number = 8000) {
  const wss = new WebSocketServer({ port });
  console.log(`WebSocket server started on port ${port}`);

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket server');
    let contextBuffer = '';
    let dgWs: WebSocket | null = null;
    let dgConnected = false;
    let keepAliveInterval: NodeJS.Timeout | null = null;
    let audioChunksReceived = 0;

    // Helper to connect/reconnect to Deepgram
    const connectToDeepgram = () => {
      if (dgConnected || !DEEPGRAM_API_KEY) return;
      console.log('Connecting to Deepgram API directly...');

      dgWs = new WebSocket(DEEPGRAM_URL, {
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`
        }
      });

      dgWs.on('open', () => {
        console.log('Connected to Deepgram API directly');
        dgConnected = true;
        ws.send(JSON.stringify({ type: 'restart_audio' }));

        // Start KeepAlive
        keepAliveInterval = setInterval(() => {
          if (dgConnected && dgWs && dgWs.readyState === WebSocket.OPEN) {
            console.log('Sending KeepAlive to Deepgram...');
            dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 5000);
      });

      dgWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'Results') {
            const isFinal = msg.is_final || false;
            const sentence = msg.channel?.alternatives?.[0]?.transcript || '';

            if (sentence && isFinal) {
              console.log(`Deepgram transcript (final): ${sentence}`);
              contextBuffer += sentence + ' ';
              ws.send(JSON.stringify({
                type: 'transcript',
                text: contextBuffer
              }));
            } else if (sentence) {
              ws.send(JSON.stringify({
                type: 'transcript',
                text: contextBuffer + sentence
              }));
            }
          }
        } catch (err) {
          console.error('Error parsing Deepgram message:', err);
        }
      });

      dgWs.on('close', () => {
        console.log('Deepgram connection closed.');
        cleanupDeepgram();
        // Reconnect after 2 seconds
        setTimeout(connectToDeepgram, 2000);
      });

      dgWs.on('error', (err) => {
        console.error('Deepgram WebSocket error:', err);
        cleanupDeepgram();
      });
    };

    const cleanupDeepgram = () => {
      dgConnected = false;
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      if (dgWs) {
        try {
          dgWs.close();
        } catch (e) { }
        dgWs = null;
      }
    };

    // Connect to Deepgram initially
    if (DEEPGRAM_API_KEY) {
      connectToDeepgram();
    } else {
      console.warn("DEEPGRAM_API_KEY is not defined. Transcription features will not work.");
    }

    ws.on('message', async (message, isBinary) => {
      if (isBinary) {
        // Handle audio bytes
        audioChunksReceived++;
        if (audioChunksReceived === 1) {
          console.log("Received first audio chunk from client!");
        } else if (audioChunksReceived % 100 === 0) {
          console.log(`Received ${audioChunksReceived} audio chunks from client.`);
        }

        if (dgConnected && dgWs && dgWs.readyState === WebSocket.OPEN) {
          try {
            dgWs.send(message);
          } catch (err) {
            console.error('Error sending audio to Deepgram:', err);
          }
        }
      } else {
        // Handle text message
        try {
          const data = JSON.parse(message.toString());

          if (data.type === 'clear_transcript') {
            console.log("Clearing transcript buffer...");
            contextBuffer = '';
            return;
          }

          if (data.type === 'trigger_llm') {
            console.log("Trigger received, querying LLM...");
            let resumeCtx = data.resume || '';
            const jobRole = data.jobRole || '';
            const imageData = data.image || '';

            if (resumeCtx.length > 15000) {
              console.log("Truncating massive resume context to prevent API rate limits...");
              resumeCtx = resumeCtx.slice(0, 15000) + "\n...\n[TRUNCATED TO SAVE TOKENS]";
            }

            if (!contextBuffer.trim() && !imageData) {
              ws.send(JSON.stringify({
                type: 'answer_chunk',
                text: 'Waiting for enough transcript context or screen image...'
              }));
              return;
            }

            const systemMessage = getSystemPrompt("v6", jobRole, resumeCtx);
            const userContent: any[] = [];

            if (contextBuffer.trim()) {
              let queryText = contextBuffer.trim();
              const chatHistory = data.history || [];
              if (chatHistory.length > 0) {
                const lastQ = chatHistory[chatHistory.length - 1]?.question || '';
                if (lastQ) {
                  queryText += ` (Context hint: The user is asking a follow-up about the exact topic of their previous question: '${lastQ}')`;
                }
              }
              userContent.push({ type: 'text', text: queryText });
            } else {
              userContent.push({ type: 'text', text: 'No transcript available. Analyze the screen and provide guidance.' });
            }

            if (imageData) {
              userContent.push({
                type: 'image_url',
                image_url: {
                  url: imageData
                }
              });
            }

            const messages: any[] = [
              { role: 'system', content: systemMessage }
            ];

            const chatHistory = data.history || [];
            const recentHistory = chatHistory.slice(-2);
            for (const item of recentHistory) {
              if (item.question && item.answer) {
                messages.push({ role: 'user', content: item.question });
                const truncatedAns = item.answer.length > 300 ? item.answer.slice(0, 300) + '...' : item.answer;
                messages.push({ role: 'assistant', content: truncatedAns });
              }
            }

            messages.push({ role: 'user', content: userContent });

            const startTime = Date.now();
            let firstTokenTime: number | null = null;

            // Decide between Groq and OpenAI
            const useGroq = (process.env.USE_GROQ || 'true').toLowerCase() === 'true' && groqClient !== null;
            let activeClient = openaiClient;
            let activeModel = 'gpt-4o-mini';

            if (useGroq && !imageData && groqClient) {
              activeClient = groqClient;
              activeModel = 'llama-3.1-8b-instant';
            }

            if (!activeClient) {
              ws.send(JSON.stringify({
                type: 'answer_chunk',
                text: 'Error: No OpenAI/Groq API client configured. Please check your API keys.'
              }));
              return;
            }

            console.log(`🚀 Request sent to ${useGroq && !imageData ? 'Groq' : 'OpenAI'} (${activeModel})...`);

            try {
              const stream = await activeClient.chat.completions.create({
                model: activeModel,
                messages: messages,
                stream: true,
                max_tokens: 1000
              });

              let fullAnswer = '';
              for await (const chunk of stream) {
                if (firstTokenTime === null) {
                  firstTokenTime = Date.now();
                  const ttft = firstTokenTime - startTime;
                  console.log(`⏱️  Time to First Token (TTFT): ${ttft} ms`);
                }

                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                  fullAnswer += content;
                  ws.send(JSON.stringify({
                    type: 'answer_chunk',
                    text: fullAnswer
                  }));
                }
              }

              const endTime = Date.now();
              const totalTime = endTime - startTime;
              if (firstTokenTime) {
                const generationTime = (endTime - firstTokenTime) / 1000;
                const approxTokens = fullAnswer.length / 4;
                const tps = generationTime > 0 ? approxTokens / generationTime : 0;
                console.log(`✅  Total Latency: ${totalTime} ms | Speed: ${tps.toFixed(1)} tokens/sec`);
              }

              contextBuffer = '';
            } catch (err: any) {
              console.error('Error during LLM completion:', err);
              // Fallback to OpenAI if Groq failed
              if (useGroq && !imageData && openaiClient) {
                console.log('⚠️ Groq request failed. Falling back to OpenAI (gpt-4o-mini)...');
                try {
                  const fallbackStream = await openaiClient.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: messages,
                    stream: true,
                    max_tokens: 1000
                  });
                  let fullAnswer = '';
                  for await (const chunk of fallbackStream) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    if (content) {
                      fullAnswer += content;
                      ws.send(JSON.stringify({
                        type: 'answer_chunk',
                        text: fullAnswer
                      }));
                    }
                  }
                  contextBuffer = '';
                } catch (fallbackErr: any) {
                  console.error('Fallback LLM failure:', fallbackErr);
                  ws.send(JSON.stringify({
                    type: 'answer_chunk',
                    text: `Error calling LLM: ${fallbackErr.message || fallbackErr}`
                  }));
                }
              } else {
                ws.send(JSON.stringify({
                  type: 'answer_chunk',
                  text: `Error calling LLM: ${err.message || err}`
                }));
              }
            }
          }
        } catch (err) {
          console.error('Error parsing client message:', err);
        }
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected from WebSocket server');
      cleanupDeepgram();
    });

    ws.on('error', (err) => {
      console.error('Client WebSocket connection error:', err);
      cleanupDeepgram();
    });
  });
}
