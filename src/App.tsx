import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'

const { ipcRenderer } = (window as any).require('electron')

function App() {
  const [transcript, setTranscript] = useState("Waiting for speech...")
  const transcriptRef = useRef("Waiting for speech...")

  const [history, setHistory] = useState<{ question: string, answer: string }[]>([])
  const historyRef = useRef<{ question: string, answer: string }[]>([])
  
  useEffect(() => {
    historyRef.current = history
  }, [history])

  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isMicActive, setIsMicActive] = useState(true)
  const [isSystemAudioActive, setIsSystemAudioActive] = useState(true)

  const [showSettings, setShowSettings] = useState(false)
  const [showAnswerPanel, setShowAnswerPanel] = useState(true)
  const [resume, setResume] = useState(() => localStorage.getItem('resume') || '')
  const [jobRole, setJobRole] = useState(() => localStorage.getItem('jobRole') || '')
  const [appOpacity, setAppOpacity] = useState(() => parseFloat(localStorage.getItem('appOpacity') || '0.95'))
  const [timer, setTimer] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const isExpanded = showAnswerPanel && history.length > 0;
      // Only auto-shrink when the panel is closed, otherwise let the user manually resize
      if (!isExpanded) {
        for (let entry of entries) {
          ipcRenderer.send('resize-window', { height: entry.contentRect.height });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [showAnswerPanel, history.length]);

  useEffect(() => {
    const isExpanded = showAnswerPanel && history.length > 0;
    if (isExpanded) {
      // Expand to a good default height when opened
      ipcRenderer.send('resize-window', { height: 600 });
    }
  }, [showAnswerPanel, history.length]);

  useEffect(() => {
    localStorage.setItem('resume', resume)
    localStorage.setItem('jobRole', jobRole)
    localStorage.setItem('appOpacity', appOpacity.toString())
  }, [resume, jobRole, appOpacity])

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

  useEffect(() => {
    const backendUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'
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

    const handleTrigger = () => triggerTextOnly()
    ipcRenderer.on('trigger-llm', handleTrigger)

    return () => {
      ws.close()
      ipcRenderer.removeListener('trigger-llm', handleTrigger)
      mediaRecorderRef.current?.stop()
      
      micStreamRef.current?.getTracks().forEach(t => t.stop())
      systemStreamRef.current?.getTracks().forEach(t => t.stop())
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close()
      }
    }
  }, [])

  const startAudioCapture = async (ws: WebSocket) => {
    try {
      // First get basic permission so we can read device labels
      let micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      let systemStream: MediaStream | null = null;
      try {
        systemStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
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
        } catch(e) {
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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'trigger_llm',
        resume: localStorage.getItem('resume') || '',
        jobRole: localStorage.getItem('jobRole') || '',
        image: '',
        history: historyRef.current
      }))
    }
    setHistory(prev => {
      const next = [...prev, { question: q, answer: "Generating answer..." }];
      setCurrentIndex(next.length - 1);
      return next;
    });
    setShowAnswerPanel(true)
  }

  const triggerScreenAnalysis = () => {
    let imageBase64 = ""
    if (videoRef.current && canvasRef.current) {
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
        resume: localStorage.getItem('resume') || '',
        jobRole: localStorage.getItem('jobRole') || '',
        image: imageBase64,
        history: historyRef.current
      }))
    }
    setHistory(prev => {
      const next = [...prev, { question: "Analyzing screen...", answer: "Generating answer..." }];
      setCurrentIndex(next.length - 1);
      return next;
    });
    setShowAnswerPanel(true)
  }

  const closeApp = () => {
    window.close()
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
          components={{
            ul: ({ node, ...props }) => <ul className="space-y-3 mt-3 ml-2" {...props} />,
            li: ({ node, ...props }) => (
              <li className="flex gap-3">
                <span className="text-zinc-300 mt-2 h-1.5 w-1.5 rounded-full bg-zinc-300 flex-shrink-0" />
                <span className="flex-1">{props.children}</span>
              </li>
            ),
            p: ({ node, ...props }) => <p className="mb-3 last:mb-0" {...props} />,
            code: ({ node, inline, className, children, ...props }: any) => {
              if (inline) {
                return <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-[13px] font-mono text-amber-200" {...props}>{children}</code>
              }
              const codeText = String(children).replace(/\n$/, '')
              return (
                <div className="relative group my-4">
                  <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <button 
                      onClick={() => navigator.clipboard.writeText(codeText)}
                      className="cursor-pointer p-1.5 bg-zinc-700/80 hover:bg-zinc-600 rounded text-zinc-300 hover:text-white transition-colors"
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
    <div ref={containerRef} className={`w-full flex flex-col font-sans select-none overflow-hidden relative text-white bg-transparent ${showAnswerPanel && currentItem ? 'h-screen' : 'h-auto'}`} style={{ opacity: appOpacity }}>
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="hidden" />

      <div className="[-webkit-app-region:drag] mt-2 bg-[#1C1C1E] rounded-[16px] border border-white/10 flex items-center justify-between p-2 px-3 backdrop-blur-2xl">
        <div className="flex items-center gap-3 pl-1">
          <div className="flex items-center gap-2 font-bold text-[15px] tracking-wide text-zinc-100">
            <span className="text-xl">🧑‍💻</span>
            <span>HelperAI</span>
          </div>
          <div className="w-[1px] h-5 bg-zinc-700 mx-1"></div>
          <div className="flex items-center gap-1">
            <button 
              onClick={toggleMic} 
              title={isMicActive ? "Mute Microphone" : "Unmute Microphone"}
              className="[-webkit-app-region:no-drag] p-1.5 rounded-lg transition-colors bg-[#2C2C2E] hover:bg-[#3A3A3C] border border-zinc-600/50"
            >
              <svg className={`w-4 h-4 ${isMicActive ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'text-red-400'}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </button>
            <button 
              onClick={toggleSystemAudio} 
              title={isSystemAudioActive ? "Mute System Audio" : "Unmute System Audio"}
              className="[-webkit-app-region:no-drag] p-1.5 rounded-lg transition-colors bg-[#2C2C2E] hover:bg-[#3A3A3C] border border-zinc-600/50"
            >
              <svg className={`w-4 h-4 ${isSystemAudioActive ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'text-red-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
            </button>
          </div>
        </div>

        <div className="[-webkit-app-region:no-drag] flex items-center gap-2">
          <button
            onClick={triggerTextOnly}
            className="flex items-center gap-2 bg-[#2C2C2E] hover:bg-[#3A3A3C] transition-all duration-200 border border-zinc-600/50 shadow-sm rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide text-zinc-200 hover:text-white"
          >
            <span>AI Help</span>
          </button>
          <button
            onClick={triggerScreenAnalysis}
            className="flex items-center gap-2 bg-[#2C2C2E] hover:bg-[#3A3A3C] transition-all duration-200 border border-zinc-600/50 shadow-sm rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide text-zinc-200 hover:text-white"
          >
            <span>Analyze Screen</span>
          </button>
          <button onClick={exportInterview} title="Save Interview as Markdown" className="flex items-center gap-2 bg-[#2C2C2E] hover:bg-[#3A3A3C] transition-all duration-200 border border-zinc-600/50 shadow-sm rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide text-zinc-200 hover:text-white">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Save</span>
          </button>
          <button onClick={clearData} className="flex items-center gap-2 bg-[#2C2C2E] hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 transition-all duration-200 border border-zinc-600/50 shadow-sm rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide text-zinc-200 group">
            <span>Clear</span>
          </button>
        </div>

        <div className="[-webkit-app-region:no-drag] flex items-center gap-1.5 pr-1">
          <div className="flex items-center gap-2 bg-[#2C2C2E] border border-zinc-600/50 rounded-lg px-2.5 py-1 text-[13px] font-mono tracking-wider font-semibold text-zinc-300">
            {formatTimer(timer)}
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 bg-[#2C2C2E] hover:bg-[#3A3A3C] border border-zinc-600/50 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
          <button onClick={closeApp} className="p-1.5 bg-[#2C2C2E] hover:bg-red-500/20 border border-zinc-600/50 hover:border-red-500/50 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <div className="[-webkit-app-region:no-drag] mt-2 bg-[#1C1C1E] rounded-[16px] border border-white/10 px-4 py-2.5 flex justify-between items-center text-[13px] text-zinc-300 font-medium tracking-wide backdrop-blur-2xl">
        <div className="truncate pr-4 flex-1 text-wrap">{transcript || "Waiting for transcript..."}</div>
        <div className="flex items-center gap-2 opacity-40">
          <button onClick={() => setShowAnswerPanel(!showAnswerPanel)} className="hover:opacity-100 cursor-pointer p-0.5">
            {showAnswerPanel ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            )}
          </button>
          <button onClick={clearData} className="hover:opacity-100 cursor-pointer p-0.5">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      {showSettings && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm [-webkit-app-region:no-drag]" onClick={() => setShowSettings(false)} />
          <div className="[-webkit-app-region:no-drag] fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md bg-[#1C1C1E] rounded-[16px] border border-white/10 p-6 z-50 flex flex-col gap-4 shadow-2xl">
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-zinc-100 font-bold text-base tracking-wide">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-white p-1 rounded-md transition-colors">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-zinc-300 text-[13px] font-semibold tracking-wide">App Opacity: {Math.round(appOpacity * 100)}%</label>
              <input type="range" min="0.1" max="1" step="0.05" value={appOpacity} onChange={(e) => setAppOpacity(parseFloat(e.target.value))} className="accent-blue-500 cursor-pointer" />
            </div>
            <input type="text" value={jobRole} onChange={(e) => setJobRole(e.target.value)} placeholder="Target Job Role" className="bg-[#09090B] border border-zinc-800 rounded-lg px-3 py-2.5 text-[14px] text-zinc-200 outline-none" />
            <textarea value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Resume Context" rows={5} className="bg-[#09090B] border border-zinc-800 rounded-lg px-3 py-2.5 text-[14px] text-zinc-200 outline-none" />
          </div>
        </>
      )}

      {currentItem && showAnswerPanel && (
        <div className="[-webkit-app-region:no-drag] mt-2 bg-[#1C1C1E]/95 backdrop-blur-3xl rounded-[16px] border border-white/10 p-6 flex-1 mb-2 overflow-hidden flex flex-col">
          <div className="flex justify-between items-start mb-5">
            <div className="flex gap-3 text-zinc-500">
              <button onClick={goBack} disabled={currentIndex <= 0} className="hover:text-zinc-300 disabled:opacity-30 bg-zinc-800/30 p-1.5 rounded-md"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
              <button onClick={goForward} disabled={currentIndex >= history.length - 1} className="hover:text-zinc-300 disabled:opacity-30 bg-zinc-800/30 p-1.5 rounded-md"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
              <span className="text-xs font-mono self-center px-2 opacity-50">{currentIndex + 1} / {history.length}</span>
            </div>
            <button onClick={clearCurrentQuestion} className="hover:text-zinc-300 bg-zinc-800/30 p-1.5 rounded-md"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
          <div className="flex-1 overflow-y-auto pr-3 pb-4 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent select-text">
            <div className="mb-6 text-[15.5px] font-medium tracking-wide text-zinc-300 leading-relaxed">
              <span className="font-bold text-zinc-100 mr-1">Question:</span> {currentItem.question}
            </div>
            <div className="text-[15.5px] font-medium tracking-wide text-zinc-300">
              <span className="font-bold text-zinc-100 mr-1">Answer:</span>
              {renderAnswer(currentItem.answer)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
