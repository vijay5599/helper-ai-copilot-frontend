import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'

const { ipcRenderer } = (window as any).require('electron')

function App() {
  const [transcript, setTranscript] = useState("Waiting for speech...")
  const transcriptRef = useRef("Waiting for speech...")

  const [history, setHistory] = useState<{question: string, answer: string}[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  
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

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const isExpanded = showAnswerPanel && history.length > 0 && !showSettings;
      // Only auto-shrink when the panel is closed, otherwise let the user manually resize
      if (!isExpanded) {
        for (let entry of entries) {
          ipcRenderer.send('resize-window', { height: entry.contentRect.height });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [showAnswerPanel, history.length, showSettings]);

  useEffect(() => {
    const isExpanded = showAnswerPanel && history.length > 0 && !showSettings;
    if (isExpanded) {
      // Expand to a good default height when opened
      ipcRenderer.send('resize-window', { height: 600 });
    }
  }, [showAnswerPanel, history.length, showSettings]);

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
    }
  }, [])

  const startAudioCapture = async (ws: WebSocket) => {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const systemStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })

      if (videoRef.current) {
        videoRef.current.srcObject = systemStream
      }

      const audioContext = new AudioContext()
      const dest = audioContext.createMediaStreamDestination()

      const micSource = audioContext.createMediaStreamSource(micStream)
      micSource.connect(dest)

      if (systemStream.getAudioTracks().length > 0) {
        const systemSource = audioContext.createMediaStreamSource(systemStream)
        systemSource.connect(dest)
      }

      const mixedStream = dest.stream
      const mediaRecorder = new MediaRecorder(mixedStream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
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
    setHistory(prev => {
      const next = [...prev, { question: q, answer: "Generating answer..." }];
      setCurrentIndex(next.length - 1);
      return next;
    });
    setShowAnswerPanel(true)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'trigger_llm',
        resume: localStorage.getItem('resume') || '',
        jobRole: localStorage.getItem('jobRole') || '',
        image: ''
      }))
    }
  }

  const triggerScreenAnalysis = () => {
    setHistory(prev => {
      const next = [...prev, { question: "Analyzing screen...", answer: "Generating answer..." }];
      setCurrentIndex(next.length - 1);
      return next;
    });
    setShowAnswerPanel(true)
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
        image: imageBase64
      }))
    }
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

  const goForward = () => {
    if (currentIndex < history.length - 1) setCurrentIndex(currentIndex + 1)
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
            code: ({ node, inline, ...props }: any) =>
              inline ?
                <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-[13px] font-mono text-zinc-200" {...props} /> :
                <code {...props} />,
            pre: ({ node, ...props }) => <pre className="bg-zinc-800 p-3 rounded-md text-[13px] font-mono text-zinc-200 overflow-x-auto my-3" {...props} />
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    )
  }

  const currentItem = history[currentIndex];

  return (
    <div ref={containerRef} className={`w-full flex flex-col font-sans select-none overflow-hidden relative text-white bg-transparent ${showAnswerPanel && currentItem && !showSettings ? 'h-screen' : 'h-auto'}`} style={{ opacity: appOpacity }}>
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="hidden" />

      <div className="[-webkit-app-region:drag] mt-2 bg-[#1C1C1E] rounded-[16px] border border-white/10 flex items-center justify-between p-2 px-3 backdrop-blur-2xl">
        <div className="flex items-center gap-3 pl-1">
          <div className="flex items-center gap-2 font-bold text-[15px] tracking-wide text-zinc-100">
            <span className="text-xl">🧑‍💻</span>
            <span>HelperAI</span>
          </div>
          <div className="w-[1px] h-5 bg-zinc-700 mx-1"></div>
          <svg className="w-4 h-4 text-zinc-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
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
          <button onClick={clearData} className="flex items-center gap-2 bg-[#2C2C2E] hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 transition-all duration-200 border border-zinc-600/50 shadow-sm rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-wide text-zinc-200 group">
            <span>Clear</span>
          </button>
        </div>

        <div className="[-webkit-app-region:no-drag] flex items-center gap-1.5 pr-1">
          <div className="flex items-center gap-2 bg-[#2C2C2E] border border-zinc-600/50 rounded-lg px-2.5 py-1 text-[13px] font-mono tracking-wider font-semibold text-zinc-300">
            {formatTimer(timer)}
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 bg-[#2C2C2E] hover:bg-[#3A3A3C] border border-zinc-600/50 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-zinc-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
          </button>
          <button onClick={closeApp} className="p-1.5 bg-[#2C2C2E] hover:bg-red-500/20 border border-zinc-600/50 hover:border-red-500/50 rounded-lg transition-colors">
            <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <div className="[-webkit-app-region:no-drag] mt-2 bg-[#1C1C1E] rounded-[16px] border border-white/10 px-4 py-2.5 flex justify-between items-center text-[13px] text-zinc-300 font-medium tracking-wide backdrop-blur-2xl">
        <div className="truncate pr-4 flex-1">{transcript || "Waiting for transcript..."}</div>
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
        <div className="[-webkit-app-region:no-drag] mt-2 bg-[#1C1C1E]/95 backdrop-blur-3xl rounded-[16px] border border-white/10 p-5 z-10 flex flex-col gap-4">
          <h2 className="text-zinc-100 font-bold text-base tracking-wide">Settings</h2>
          <div className="flex flex-col gap-2">
            <label className="text-zinc-300 text-[13px] font-semibold tracking-wide">App Opacity: {Math.round(appOpacity * 100)}%</label>
            <input type="range" min="0.1" max="1" step="0.05" value={appOpacity} onChange={(e) => setAppOpacity(parseFloat(e.target.value))} className="accent-blue-500 cursor-pointer" />
          </div>
          <input type="text" value={jobRole} onChange={(e) => setJobRole(e.target.value)} placeholder="Target Job Role" className="bg-[#09090B] border border-zinc-800 rounded-lg px-3 py-2.5 text-[14px] text-zinc-200 outline-none" />
          <textarea value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Resume Context" rows={5} className="bg-[#09090B] border border-zinc-800 rounded-lg px-3 py-2.5 text-[14px] text-zinc-200 outline-none" />
        </div>
      )}

      {!showSettings && currentItem && showAnswerPanel && (
        <div className="[-webkit-app-region:no-drag] mt-2 bg-[#1C1C1E]/95 backdrop-blur-3xl rounded-[16px] border border-white/10 p-6 flex-1 mb-2 overflow-hidden flex flex-col">
          <div className="flex justify-between items-start mb-5">
            <div className="flex gap-3 text-zinc-500">
              <button onClick={goBack} disabled={currentIndex <= 0} className="hover:text-zinc-300 disabled:opacity-30 bg-zinc-800/30 p-1.5 rounded-md"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
              <button onClick={goForward} disabled={currentIndex >= history.length - 1} className="hover:text-zinc-300 disabled:opacity-30 bg-zinc-800/30 p-1.5 rounded-md"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
              <span className="text-xs font-mono self-center px-2 opacity-50">{currentIndex + 1} / {history.length}</span>
            </div>
            <button onClick={clearCurrentQuestion} className="hover:text-zinc-300 bg-zinc-800/30 p-1.5 rounded-md"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
          <div className="flex-1 overflow-y-auto pr-3 pb-4 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
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
