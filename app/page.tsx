"use client";

import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'


const TimerDisplay = () => {
  const [timer, setTimer] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setTimer(t => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  return <>{formatTimer(timer)}</>
}

function AppContent() {
  const [transcript, setTranscript] = useState("Waiting for speech...")
  const transcriptRef = useRef("Waiting for speech...")

  const [ipcRenderer, setIpcRenderer] = useState<any>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setRuntimeError(event.error?.message || event.message);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).electron) {
      setIpcRenderer((window as any).electron.ipcRenderer);
    } else {
      console.warn("Electron contextBridge not available");
    }
  }, []);

  const [history, setHistory] = useState<{ question: string, answer: string }[]>([])
  const historyRef = useRef<{ question: string, answer: string }[]>([])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isMicActive, setIsMicActive] = useState(true)
  const [isSystemAudioActive, setIsSystemAudioActive] = useState(true)
  const [analyzeScreen, setAnalyzeScreen] = useState(false)
  const analyzeScreenRef = useRef(false)
  const [includeResume, setIncludeResume] = useState(false)
  const includeResumeRef = useRef(true)

  useEffect(() => {
    analyzeScreenRef.current = analyzeScreen
    includeResumeRef.current = includeResume
  }, [analyzeScreen, includeResume])

  // Dynamically resize the Electron window to match the React app height
  useEffect(() => {
    const root = document.getElementById('app-container');
    if (!root) return;

    let lastHeight = 0;
    let throttleTimeout: any = null;

    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const height = Math.ceil(entry.target.getBoundingClientRect().height);
        if (height === lastHeight) continue;

        // Throttle the OS-level window resize to prevent drag lag
        if (!throttleTimeout) {
          throttleTimeout = setTimeout(() => {
            if (typeof window !== 'undefined' && window.resizeTo) {
              window.resizeTo(800, height);
            }
            lastHeight = height;
            throttleTimeout = null;
          }, 40); // 40ms throttle (~25 FPS) keeps it smooth without lagging the OS
        }
      }
    });

    observer.observe(root);
    return () => {
      observer.disconnect();
      if (throttleTimeout) clearTimeout(throttleTimeout);
    };
  }, [])


  const [showSettings, setShowSettings] = useState(false)
  const [showAnswerPanel, setShowAnswerPanel] = useState(true)
  const [resume, setResume] = useState('')
  const [jobRole, setJobRole] = useState('')
  const [appOpacity, setAppOpacity] = useState(0.95)
  const [isGhostMode, setIsGhostMode] = useState(false)
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)

  // Initialize settings from localStorage on client side
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setResume(localStorage.getItem('resume') || '')
      setJobRole(localStorage.getItem('jobRole') || '')
      const storedOpacity = localStorage.getItem('appOpacity');
      if (storedOpacity) {
        const val = parseFloat(storedOpacity);
        setAppOpacity(isNaN(val) || val <= 0.1 ? 0.95 : val);
      } else {
        setAppOpacity(0.95);
      }
      setIsSettingsLoaded(true);
    }
  }, [])

  useEffect(() => {
    if (isSettingsLoaded && typeof window !== 'undefined') {
      localStorage.setItem('resume', resume)
      localStorage.setItem('jobRole', jobRole)
      localStorage.setItem('appOpacity', appOpacity.toString())
    }
  }, [resume, jobRole, appOpacity, isSettingsLoaded])

  useEffect(() => {
    // Port 8000 is our Node WebSocket/API backend
    const backendUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'
    const ws = new WebSocket(`${backendUrl}/ws/copilot`)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('Connected to backend WS')
      startAudioCapture(ws)
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'transcript') {
        setTranscript(data.text)
        transcriptRef.current = data.text
      } else if (data.type === 'answer_chunk') {
        setHistory(prev => {
          if (prev.length === 0) return prev;
          const newHistory = [...prev];
          newHistory[newHistory.length - 1] = {
            ...newHistory[newHistory.length - 1],
            answer: data.text
          };
          return newHistory;
        });
      }
    }

    return () => {
      ws.close()
      mediaRecorderRef.current?.stop()

      micStreamRef.current?.getTracks().forEach(t => t.stop())
      systemStreamRef.current?.getTracks().forEach(t => t.stop())
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    if (!ipcRenderer) return;

    const handleTrigger = () => triggerTextOnly()
    ipcRenderer.on('trigger-llm', handleTrigger)

    const handleToggleGhostMode = (_event: any, state: boolean) => {
      setIsGhostMode(state);
    }
    ipcRenderer.on('toggle-ghost-mode', handleToggleGhostMode)

    return () => {
      ipcRenderer.removeListener('trigger-llm', handleTrigger)
      ipcRenderer.removeListener('toggle-ghost-mode', handleToggleGhostMode)
    }
  }, [ipcRenderer])

  const startAudioCapture = async (ws: WebSocket) => {
    try {
      // First get basic permission so we can read device labels
      let micStream = await navigator.mediaDevices.getUserMedia({ audio: true })

      let systemStream: MediaStream | null = null as MediaStream | null;
      try {
        // Limited framerate to 5-10fps to completely eliminate the screen lag issue
        systemStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 5, max: 10 } },
          audio: true
        })
        if (videoRef.current) {
          videoRef.current.srcObject = systemStream
        }
      } catch (e) {
        console.warn("Could not get display media (screen recording permissions might be denied).", e)
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      console.log("Available audio inputs:", audioInputs.map(d => d.label));

      const blackHole = audioInputs.find(d => d.label.toLowerCase().includes('blackhole'));

      // If the default mic is BlackHole, try to find a real mic instead
      if (blackHole && micStream.getAudioTracks()[0]?.label.toLowerCase().includes('blackhole')) {
        const realMic = audioInputs.find(d => !d.label.toLowerCase().includes('blackhole') && d.deviceId !== 'default' && d.deviceId !== 'communications');
        if (realMic) {
          console.log("Default mic was BlackHole, switching to real mic:", realMic.label);
          micStream.getTracks().forEach(t => t.stop());
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: realMic.deviceId } }
          });
        }
      }

      micStreamRef.current = micStream;

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext;
      const dest = audioContext.createMediaStreamDestination()

      const micSource = audioContext.createMediaStreamSource(micStream)
      micSource.connect(dest)

      if (blackHole) {
        console.log("Found BlackHole! Attempting to connect...", blackHole.label);
        try {
          const bhStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: blackHole.deviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          });
          systemStreamRef.current = bhStream;
          const systemSource = audioContext.createMediaStreamSource(bhStream);
          systemSource.connect(dest);
          console.log("Successfully connected BlackHole for System Audio");
        } catch (e) {
          console.error("Failed to connect BlackHole", e);
        }
      } else if (systemStream) {
        console.log("BlackHole not found. Falling back to default system audio.");
        systemStreamRef.current = systemStream;
        if (systemStream.getAudioTracks().length > 0) {
          const systemSource = audioContext.createMediaStreamSource(systemStream);
          systemSource.connect(dest);
        }
      }

      await audioContext.resume()

      const mixedStream = dest.stream
      const mediaRecorder = new MediaRecorder(mixedStream, { mimeType: 'audio/webm;codecs=opus' })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        console.log("Audio chunk generated, size:", e.data.size)
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data)
        }
      }

      mediaRecorder.start(250)
    } catch (err: any) {
      console.error('Error capturing audio', err)
      setTranscript(`Error: ${err.message || err.name || 'Microphone access denied or no device found.'}`)
      transcriptRef.current = `Error: ${err.message || err.name || 'Microphone access denied or no device found.'}`
    }
  }

  const triggerTextOnly = () => {
    const q = transcriptRef.current;

    let imageBase64 = ""
    if (analyzeScreenRef.current && videoRef.current && canvasRef.current) {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          imageBase64 = canvas.toDataURL('image/jpeg', 0.7)
        }
      }
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'trigger_llm',
        resume: includeResumeRef.current ? (localStorage.getItem('resume') || '') : '',
        jobRole: localStorage.getItem('jobRole') || '',
        image: imageBase64,
        history: historyRef.current
      }))
    }
    setHistory(prev => {
      const next = [...prev, { question: imageBase64 ? "Analyzing screen..." : q, answer: "Generating answer..." }];
      setCurrentIndex(next.length - 1);
      return next;
    });
    setShowAnswerPanel(true)
  }

  const closeApp = () => {
    if (typeof window !== 'undefined') {
      window.close()
    }
  }

  const clearData = () => {
    setTranscript("Waiting for speech...")
    transcriptRef.current = "Waiting for speech..."
    setHistory([])
    setCurrentIndex(-1)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'clear_transcript' }))
    }
  }

  const goBack = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
  }

  const exportInterview = () => {
    console.log("jshdjhsdjhsdjhs")
    if (history.length === 0) return;

    let content = "# Interview Transcript & AI Responses\n\n";
    history.forEach((item, index) => {
      content += `## Q${index + 1}: ${item.question}\n\n`;
      content += `**AI Copilot Answer:**\n${item.answer}\n\n`;
      content += `---\n\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview_export_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const goForward = () => {
    if (currentIndex < history.length - 1) setCurrentIndex(currentIndex + 1)
  }

  const toggleMic = () => {
    setIsMicActive(prev => {
      const nextState = !prev;
      if (micStreamRef.current) {
        micStreamRef.current.getAudioTracks().forEach(track => {
          track.enabled = nextState;
        });
      }
      return nextState;
    });
  }

  const toggleSystemAudio = () => {
    console.log("Hiiiii")
    setIsSystemAudioActive(prev => {
      const nextState = !prev;
      if (systemStreamRef.current) {
        systemStreamRef.current.getAudioTracks().forEach(track => {
          track.enabled = nextState;
        });
      }
      return nextState;
    });
  }

  const clearCurrentQuestion = () => {
    if (history.length === 0) return;
    setHistory(prev => {
      const next = [...prev];
      next.splice(currentIndex, 1);
      return next;
    });
    setCurrentIndex(prev => Math.max(0, Math.min(prev, history.length - 2)));
  }

  const renderAnswer = (text: string) => {
    if (text === "Generating answer..." || text === "") {
      return (
        <div className="flex items-center gap-2 text-zinc-400 text-sm mt-3 font-medium">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading...
        </div>
      )
    }

    return (
      <div className="mt-3 text-zinc-100 text-[15px] font-medium leading-relaxed tracking-wide">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            ul: ({ ...props }) => <ul className="space-y-3 mt-3 ml-2" {...props} />,
            li: ({ ...props }) => (
              <li className="flex gap-3">
                <span className="text-zinc-300 mt-2 h-1.5 w-1.5 rounded-full bg-zinc-300 flex-shrink-0" />
                <span className="flex-1">{props.children}</span>
              </li>
            ),
            p: ({ ...props }) => <p className="mb-3 last:mb-0" {...props} />,
            table: ({ ...props }) => <div className="overflow-x-auto my-4 rounded-lg border border-zinc-800"><table className="w-full text-left border-collapse text-[13.5px]" {...props} /></div>,
            thead: ({ ...props }) => <thead className="bg-[#1e1f2e] text-zinc-200 font-semibold uppercase text-[11px] tracking-wider" {...props} />,
            tbody: ({ ...props }) => <tbody className="divide-y divide-zinc-800/50 bg-[#12131a]" {...props} />,
            tr: ({ ...props }) => <tr className="hover:bg-[#1a1b26]/50 transition-colors" {...props} />,
            th: ({ ...props }) => <th className="px-4 py-3 font-semibold" {...props} />,
            td: ({ ...props }) => <td className="px-4 py-3 text-zinc-300 align-top" {...props} />,
            code: ({ inline, className, children, ...props }: any) => {
              const codeText = String(children).replace(/\n$/, '')
              const isShortSnippet = !codeText.includes('\n') && codeText.length < 60 && !className

              if (inline || isShortSnippet) {
                return <strong className="text-emerald-400 font-bold" {...props}>{children}</strong>
              }
              return (
                <div className="relative group my-4">
                  <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button
                      onClick={() => navigator.clipboard.writeText(codeText)}
                      className="p-1.5 bg-zinc-700/80 hover:bg-zinc-600 rounded text-zinc-300 hover:text-white transition-colors"
                      title="Copy code"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    </button>
                  </div>
                  <pre className="bg-[#121212] p-4 rounded-lg text-[13.5px] font-mono text-emerald-400 overflow-x-auto border border-zinc-800 shadow-inner">
                    <code {...props}>{children}</code>
                  </pre>
                </div>
              )
            },
            pre: ({ children }: any) => <>{children}</>
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    )
  }

  const currentItem = history[currentIndex];

  return (
    <div id="app-container" ref={containerRef} className="w-full flex flex-col font-sans select-none overflow-hidden relative text-white bg-transparent h-auto transition-opacity duration-200" style={{ opacity: isGhostMode ? 0.1 : appOpacity }}>
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="hidden" />

      {runtimeError && (
        <div className="bg-red-500/90 text-white p-3 rounded-lg m-2 text-xs font-mono select-text z-50">
          <strong>Runtime Error:</strong> {runtimeError}
        </div>
      )}

      <div className="no-drag mt-2 mb-2 rounded-[16px] bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-transparent p-[1px] drop-shadow-2xl">
        <div className="drag bg-[#13141c] rounded-[15px] flex items-center justify-between p-2 px-3 backdrop-blur-2xl">
          <div className="flex items-center gap-3 pl-1">
            <div className="flex items-center gap-2 font-bold text-[15px] tracking-wide text-zinc-100">
              <span className="text-xl">🧑‍💻</span>
              <span>HelperAI</span>
            </div>
            <div className="w-[1px] h-5 bg-zinc-700/50 mx-1"></div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleMic}
                title={isMicActive ? "Mute Microphone" : "Unmute Microphone"}
                className="no-drag p-1.5 rounded-lg transition-colors bg-[#1e1f2e] hover:bg-[#2a2b3d] border border-indigo-500/10"
              >
                <svg className={`w-4 h-4 ${isMicActive ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'text-red-400'}`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              </button>
              <button
                onClick={toggleSystemAudio}
                title={isSystemAudioActive ? "Mute System Audio" : "Unmute System Audio"}
                className="no-drag p-1.5 rounded-lg transition-colors bg-[#1e1f2e] hover:bg-[#2a2b3d] border border-indigo-500/10"
              >
                <svg className={`w-4 h-4 ${isSystemAudioActive ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'text-red-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
              </button>
            </div>
          </div>

          <div className="no-drag flex items-center gap-2">
            <button
              onClick={triggerTextOnly}
              className="flex items-center gap-2 bg-[#1e1f2e] hover:bg-[#2a2b3d] transition-all duration-200 border border-indigo-500/20 shadow-sm rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide text-zinc-200 hover:text-white"
            >
              <span>AI Help</span>
            </button>

            <label title="Include Screen" className="flex items-center gap-2 bg-[#1e1f2e] border border-indigo-500/20 shadow-sm rounded-full px-2.5 py-1.5 text-zinc-300 cursor-pointer hover:bg-[#2a2b3d] transition-colors">
              <input
                type="checkbox"
                checked={analyzeScreen}
                onChange={(e) => setAnalyzeScreen(e.target.checked)}
                className="rounded bg-[#13141c] border-zinc-600 text-indigo-500 focus:ring-indigo-500/50 focus:ring-offset-0 focus:ring-1 cursor-pointer"
              />
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
            </label>

            <label title="Include Resume Context" className="flex items-center gap-2 bg-[#1e1f2e] border border-indigo-500/20 shadow-sm rounded-full px-2.5 py-1.5 text-zinc-300 cursor-pointer hover:bg-[#2a2b3d] transition-colors">
              <input
                type="checkbox"
                checked={includeResume}
                onChange={(e) => setIncludeResume(e.target.checked)}
                className="rounded bg-[#13141c] border-zinc-600 text-indigo-500 focus:ring-indigo-500/50 focus:ring-offset-0 focus:ring-1 cursor-pointer"
              />
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 8 8 9"></polyline></svg>
            </label>

            <button onClick={exportInterview} title="Save Interview as Markdown" className="flex items-center gap-2 bg-[#1e1f2e] hover:bg-[#2a2b3d] transition-all duration-200 border border-indigo-500/20 shadow-sm rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide text-zinc-200 hover:text-white">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Save</span>
            </button>
            <button onClick={clearData} className="flex items-center gap-2 bg-[#1e1f2e] hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 transition-all duration-200 border border-indigo-500/20 shadow-sm rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide text-zinc-200 group">
              <span>Clear</span>
            </button>
          </div>

          <div className="no-drag flex items-center gap-1.5 pr-1">
            <div className="flex items-center gap-2 bg-[#1e1f2e] border border-indigo-500/20 rounded-lg px-2.5 py-1 text-[13px] font-mono tracking-wider font-semibold text-zinc-300">
              <TimerDisplay />
            </div>
            <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 bg-[#1e1f2e] hover:bg-[#2a2b3d] border border-indigo-500/20 rounded-lg transition-colors">
              <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <button onClick={closeApp} className="p-1.5 bg-[#1e1f2e] hover:bg-red-500/20 border border-indigo-500/20 hover:border-red-500/50 rounded-lg transition-colors">
              <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
      </div>
      <div className="no-drag mt-2 mb-2 rounded-[16px] bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-transparent p-[1px] drop-shadow-2xl">
        <div className="bg-[#13141c] rounded-[15px] px-4 py-2.5 flex justify-between items-center text-[13px] text-zinc-300 font-medium tracking-wide backdrop-blur-2xl">
          <div className="truncate pr-4 flex-1 text-wrap">{transcript || "Waiting for transcript..."}</div>
          <button onClick={() => setShowAnswerPanel(!showAnswerPanel)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1e1f2e] hover:bg-[#2a2b3d] border border-indigo-500/10 text-zinc-300 transition-colors shadow-sm whitespace-nowrap group">
            <span className="font-semibold text-[12px]">{showAnswerPanel ? "Hide Answer" : "Show Answer"}</span>
            {showAnswerPanel ? (
              <svg className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            )}
          </button>
        </div>
      </div>

      {showSettings && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm no-drag" onClick={() => setShowSettings(false)} />
          <div className="no-drag fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md max-h-[90vh] overflow-y-auto bg-[#13141c] rounded-[16px] border border-indigo-500/20 p-6 z-50 flex flex-col gap-4 shadow-2xl">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-zinc-100 font-bold text-base tracking-wide">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-white p-1 rounded-md transition-colors">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-zinc-300 text-[13px] font-semibold tracking-wide">App Opacity: {Math.round(appOpacity * 100)}%</label>
              <input type="range" min="0.1" max="1" step="0.05" value={appOpacity} onChange={(e) => setAppOpacity(parseFloat(e.target.value))} className="accent-indigo-500" />
            </div>
            <input type="text" value={jobRole} onChange={(e) => setJobRole(e.target.value)} placeholder="Target Job Role" className="bg-[#09090B] border border-zinc-800 focus:border-indigo-500/50 rounded-lg px-3 py-2.5 text-[14px] text-zinc-200 outline-none transition-colors" />
            <textarea value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Resume Context" rows={5} className="bg-[#09090B] border border-zinc-800 focus:border-indigo-500/50 rounded-lg px-3 py-2.5 text-[14px] text-zinc-200 outline-none transition-colors" />
          </div>
        </>
      )}

      {currentItem && showAnswerPanel && (
        <div className="no-drag mt-2 mb-2 rounded-[16px] bg-gradient-to-br from-indigo-500/30 via-purple-500/10 to-transparent p-[1px] drop-shadow-2xl">
          <div ref={panelRef} className="bg-[#13141c]/95 backdrop-blur-3xl rounded-[15px] p-6 pt-5 pb-8 overflow-hidden flex flex-col relative" style={{ height: '320px' }}>
            <div className="flex justify-between items-start mb-5">
              <div className="flex gap-3 text-zinc-500">
                <button onClick={goBack} disabled={currentIndex <= 0} className="hover:text-zinc-300 disabled:opacity-30 bg-white/5 hover:bg-white/10 p-1.5 rounded-md transition-colors"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
                <button onClick={goForward} disabled={currentIndex >= history.length - 1} className="hover:text-zinc-300 disabled:opacity-30 bg-white/5 hover:bg-white/10 p-1.5 rounded-md transition-colors"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
                <span className="text-xs font-mono self-center px-2 opacity-50">{currentIndex + 1} / {history.length}</span>
              </div>
              <button onClick={clearCurrentQuestion} className="hover:text-zinc-300 bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors p-1.5 rounded-md"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
            </div>
            <div className="flex-1 overflow-y-auto pr-3 pb-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent select-text">
              <div className="mb-6 text-[14px] font-medium tracking-wide text-zinc-400 leading-relaxed">
                <span className="font-bold text-zinc-300 mr-2 uppercase text-[12px] tracking-wider">Question</span> {currentItem.question}
              </div>
              <div className="text-[15.5px] font-medium tracking-wide text-zinc-100 leading-relaxed">
                <span className="font-bold text-indigo-400 mr-2 uppercase text-[12px] tracking-wider">Answer</span>
                {renderAnswer(currentItem.answer)}
              </div>
            </div>

            {/* Custom Drag Handle */}
            <div
              className="absolute bottom-0 left-0 w-full h-6 flex items-center justify-center hover:bg-white/5 transition-colors group z-50"
              onPointerDown={(e) => {
                const el = e.currentTarget;
                el.setPointerCapture(e.pointerId);
                const startY = e.clientY;
                const startHeight = panelRef.current ? panelRef.current.getBoundingClientRect().height : 320;

                const onMove = (moveEvent: PointerEvent) => {
                  const newHeight = Math.max(150, Math.min(startHeight + (moveEvent.clientY - startY), 1000));
                  if (panelRef.current) {
                    panelRef.current.style.height = `${newHeight}px`;
                  }
                };

                const onUp = (upEvent: PointerEvent) => {
                  el.releasePointerCapture(upEvent.pointerId);
                  el.removeEventListener('pointermove', onMove);
                  el.removeEventListener('pointerup', onUp);
                };

                el.addEventListener('pointermove', onMove);
                el.addEventListener('pointerup', onUp);
              }}
            >
              <div className="w-12 h-1 bg-zinc-600 rounded-full group-hover:bg-zinc-400 transition-colors"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div style={{ background: 'transparent' }} />;
  }

  return <AppContent />;
}
