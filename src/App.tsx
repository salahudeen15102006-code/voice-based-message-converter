/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality } from "@google/genai";
import { AnimatePresence, motion } from "motion/react";
import { 
  Check, 
  Copy, 
  ExternalLink,
  Mic, 
  MicOff, 
  Play, 
  RotateCcw, 
  Settings2, 
  Sparkles, 
  Volume2, 
  VolumeX 
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

// Types for our app
type ConversionMode = "Formal" | "Casual" | "Summary" | "Professional" | "Funny" | "Translate (Spanish)";

interface Message {
  id: string;
  original: string;
  converted: string;
  mode: ConversionMode;
  timestamp: Date;
}

const MODES: ConversionMode[] = ["Professional", "Formal", "Casual", "Summary", "Funny", "Translate (Spanish)"];

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mode, setMode] = useState<ConversionMode>("Professional");
  const [messages, setMessages] = useState<Message[]>([]);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (currentAudioRef.current) currentAudioRef.current.pause();
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Visualizer setup
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const updateLevel = () => {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(average / 128); // Normalize to 0-1
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        processAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
        if (audioContext.state !== 'closed') audioContext.close();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Please allow microphone access to use this app.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      setAudioLevel(0);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      
      const prompt = `Transcribe the following audio and then convert it into a ${mode} version. 
      Return the response in JSON format with two fields: "original" (the raw transcription) and "converted" (the refined version in ${mode} style).
      If the audio is empty or unclear, provide a polite error message in both fields.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64Audio, mimeType: "audio/webm" } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
        }
      });

      const result = JSON.parse(response.text || "{}");
      
      if (result.original && result.converted) {
        const newMessage: Message = {
          id: Math.random().toString(36).substring(7),
          original: result.original,
          converted: result.converted,
          mode: mode,
          timestamp: new Date(),
        };
        setMessages(prev => [newMessage, ...prev]);
      }
    } catch (err) {
      console.error("Error processing audio:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const speakMessage = async (text: string) => {
    if (isSpeaking) {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        setIsSpeaking(false);
      }
      return;
    }

    setIsSpeaking(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Read this message clearly: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioUrl = `data:audio/wav;base64,${base64Audio}`;
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;
        audio.onended = () => setIsSpeaking(false);
        audio.play();
      }
    } catch (err) {
      console.error("Error with TTS:", err);
      setIsSpeaking(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-orange-500/30">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#0A0A0A]/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-black" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">VoxConvert</h1>
          </div>
          <div className="flex items-center gap-4">
            <a 
              href={window.location.href} 
              target="_blank" 
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              New Tab
            </a>
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-white/40 uppercase tracking-widest">
              <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`} />
              {isRecording ? 'Live Recording' : 'Standby'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-32 pb-40">
        {/* Mode Selector */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4 text-white/60">
            <Settings2 className="w-4 h-4" />
            <span className="text-sm font-medium uppercase tracking-wider">Conversion Style</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 border ${
                  mode === m 
                    ? 'bg-white text-black border-white' 
                    : 'bg-transparent text-white/60 border-white/10 hover:border-white/30 hover:text-white'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Messages List */}
        <div className="space-y-8">
          <AnimatePresence mode="popLayout">
            {messages.length === 0 && !isProcessing && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-20 border border-dashed border-white/10 rounded-3xl bg-white/[0.02]"
              >
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Mic className="w-8 h-8 text-white/20" />
                </div>
                <h2 className="text-xl font-medium text-white/80 mb-2">Ready to convert</h2>
                <p className="text-white/40 max-w-xs mx-auto">
                  Hold the button below and speak. Gemini will refine your message into the selected style.
                </p>
              </motion.div>
            )}

            {isProcessing && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-8 rounded-3xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center gap-4"
              >
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ height: [10, 30, 10] }}
                      transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.1 }}
                      className="w-1.5 bg-orange-500 rounded-full"
                    />
                  ))}
                </div>
                <p className="text-sm font-mono text-white/40 uppercase tracking-widest">Gemini is processing...</p>
              </motion.div>
            )}

            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="group relative p-8 rounded-3xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all duration-500"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-widest text-white/60">
                      {msg.mode}
                    </div>
                    <span className="text-[10px] font-mono text-white/20">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <button 
                      onClick={() => copyToClipboard(msg.converted, msg.id)}
                      className="p-2 hover:bg-white/10 rounded-full transition-colors"
                      title="Copy to clipboard"
                    >
                      {copiedId === msg.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-white/40" />}
                    </button>
                    <button 
                      onClick={() => speakMessage(msg.converted)}
                      className={`p-2 hover:bg-white/10 rounded-full transition-colors ${isSpeaking ? 'text-orange-500' : 'text-white/40'}`}
                      title="Listen to message"
                    >
                      {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="text-[10px] font-mono text-white/20 uppercase tracking-widest mb-2">Original Transcript</div>
                    <p className="text-white/60 italic leading-relaxed">{msg.original}</p>
                  </div>
                  <div className="h-px bg-white/5" />
                  <div>
                    <div className="text-[10px] font-mono text-orange-500/60 uppercase tracking-widest mb-2">Converted Message</div>
                    <div className="prose prose-invert max-w-none text-lg leading-relaxed text-white/90">
                      <ReactMarkdown>{msg.converted}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>

      {/* Recording Control */}
      <div className="fixed bottom-0 left-0 right-0 p-8 flex flex-col items-center pointer-events-none">
        <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-full p-2 flex items-center justify-between shadow-2xl pointer-events-auto backdrop-blur-xl">
          <div className="pl-6 flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-white/10'}`} />
            <span className="text-sm font-mono text-white/40 tabular-nums">
              {isRecording ? formatTime(recordingTime) : '0:00'}
            </span>
          </div>

          <div className="relative">
            {/* Visualizer Ring */}
            {isRecording && (
              <motion.div 
                animate={{ scale: [1, 1 + audioLevel * 0.5, 1] }}
                transition={{ duration: 0.1 }}
                className="absolute inset-0 rounded-full bg-orange-500/20 -z-10"
              />
            )}
            
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 active:scale-90 ${
                isRecording 
                  ? 'bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.4)]' 
                  : 'bg-white text-black hover:bg-orange-500 hover:text-white'
              }`}
            >
              {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
          </div>

          <div className="pr-4">
            <button 
              onClick={() => setMessages([])}
              className="p-3 text-white/20 hover:text-white/60 transition-colors"
              title="Clear all"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          </div>
        </div>
        <p className="mt-4 text-[10px] font-mono text-white/20 uppercase tracking-[0.2em]">
          {isRecording ? 'Release to convert' : 'Hold to record'}
        </p>
      </div>
    </div>
  );
}
