import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { getAiClient, MODELS, generateContentWithRetry } from './services/ai';
import { Facebook, Send, Video, FileText, Loader2, CheckCircle, AlertCircle, Play, HelpCircle, X, Copy, Check, Settings, Key, Upload, Calendar, ChevronRight, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI } from "@google/genai";

// Types
interface User {
  id: string;
  name: string;
  picture?: {
    data: {
      url: string;
    }
  };
}

interface ScheduleItem {
  id: string;
  week: string | number;
  day: string;
  theme: string;
  contentIdea: string;
  channels: string[];
  status: 'pending' | 'generated';
}

interface MarketingDraft {
  id: string;
  plan: string;
  videoPrompt: string;
  caption: string;
  videoUrl?: string;
  status: 'draft' | 'generating_video' | 'ready' | 'posted';
  createdAt: number;
  scheduleItemId?: string;
}

interface AppSettings {
  geminiKey: string;
  fbAppId: string;
  fbAppSecret: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [marketingPlan, setMarketingPlan] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [drafts, setDrafts] = useState<MarketingDraft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  
  // File Upload & Schedule State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({});

  // Settings State
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('autosocial_settings');
    return saved ? JSON.parse(saved) : {
      geminiKey: '',
      fbAppId: '',
      fbAppSecret: ''
    };
  });

  // Save settings
  useEffect(() => {
    localStorage.setItem('autosocial_settings', JSON.stringify(settings));
  }, [settings]);

  // Handle Facebook Login
  const handleLogin = async () => {
    try {
      // Construct URL with dynamic credentials if provided
      const params = new URLSearchParams();
      if (settings.fbAppId) params.append('client_id', settings.fbAppId);
      if (settings.fbAppSecret) params.append('client_secret', settings.fbAppSecret);

      const response = await fetch(`/api/auth/facebook/url?${params.toString()}`);
      const { url } = await response.json();
      
      // Check if client_id is missing in the generated URL (simple check)
      if (url.includes('client_id=&')) {
        setError("Facebook Client ID is missing. Please check the Settings.");
        setShowSettings(true);
        return;
      }

      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      window.open(
        url,
        'facebook_oauth',
        `width=${width},height=${height},top=${top},left=${left}`
      );
    } catch (err) {
      console.error("Failed to get auth URL", err);
      setError("Failed to initiate Facebook login.");
    }
  };

  // Listen for login success
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setUser(event.data.user);
        console.log("Logged in with token:", event.data.accessToken);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const copyRedirectUrl = () => {
    const url = `${window.location.origin}/api/auth/facebook/callback`;
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  // Handle File Upload & Schedule Extraction
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setError(null);
    setSchedule([]);

    try {
      // Use custom key if provided, otherwise use default instance
      const apiKey = settings.geminiKey || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please add it in Settings (gear icon).");
      }

      const aiClient = getAiClient(apiKey);

      // Wrap file reading in a promise to await it
      const base64Content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix (e.g., "data:application/pdf;base64,")
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
        
      const prompt = `
        Analyze this marketing plan document. 
        Extract the schedule into a structured JSON array.
        For each item, identify:
        - week (e.g., "Week 1", "Week 2")
        - day (e.g., "Monday", "Tuesday")
        - theme (short summary)
        - contentIdea (detailed description of what to post)
        - channels (array of strings, e.g., ["Facebook", "Instagram"])

        Return ONLY the JSON array. No markdown formatting.
      `;

      console.log("Sending file to Gemini...", file.type);

      const result = await aiClient.models.generateContent({
        model: MODELS.TEXT,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: file.type, data: base64Content } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = result.text;
      if (!responseText) throw new Error("No response from AI");
      
      console.log("Gemini response received");
      const data = JSON.parse(responseText);
      
      // Add IDs to items
      const scheduleItems: ScheduleItem[] = data.map((item: any, index: number) => ({
        ...item,
        id: `sched-${Date.now()}-${index}`,
        status: 'pending'
      }));

      setSchedule(scheduleItems);
      
      // Auto-expand first week
      if (scheduleItems.length > 0) {
        setExpandedWeeks({ [scheduleItems[0].week]: true });
      }

    } catch (err: any) {
      console.error("File upload error:", err);
      setError(`Failed to extract schedule: ${err.message}`);
      if (err.message.includes('API key')) {
        setShowSettings(true);
      }
    } finally {
      setIsExtracting(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Generate Draft from Schedule Item
  const handleGenerateFromSchedule = async (item: ScheduleItem) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const apiKey = settings.geminiKey || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please add it in Settings (gear icon).");
      }

      const aiClient = getAiClient(apiKey);

      const prompt = `
        You are a social media marketing expert. 
        Create a specific post based on this scheduled item:
        
        Theme: ${item.theme}
        Content Idea: ${item.contentIdea}
        Channel: Facebook
        
        Generate:
        1. A detailed prompting string for an AI video generator (Veo) to create a high-quality video for this post.
        2. A catchy social media caption for Facebook.
        
        Output format (JSON):
        {
          "videoPrompt": "...",
          "caption": "..."
        }
      `;

      const result = await aiClient.models.generateContent({
        model: MODELS.TEXT,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = result.text;
      if (!responseText) throw new Error("No response from AI");
      
      const data = JSON.parse(responseText);
      
      const newDraft: MarketingDraft = {
        id: Date.now().toString(),
        plan: `${item.week} - ${item.day}: ${item.theme}`,
        videoPrompt: data.videoPrompt,
        caption: data.caption,
        status: 'draft',
        createdAt: Date.now(),
        scheduleItemId: item.id
      };

      setDrafts(prev => [newDraft, ...prev]);
      setActiveDraftId(newDraft.id);
      
      // Update schedule item status
      setSchedule(prev => prev.map(i => i.id === item.id ? { ...i, status: 'generated' } : i));

    } catch (err: any) {
      console.error(err);
      setError(`Failed to generate draft: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Analyze Plan (Text Input) & Generate Draft
  const handleAnalyzePlan = async () => {
    if (!marketingPlan.trim()) return;
    
    setIsAnalyzing(true);
    setError(null);

    try {
      // Use custom key if provided, otherwise use default instance
      const apiKey = settings.geminiKey || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please add it in Settings (gear icon).");
      }

      const aiClient = getAiClient(apiKey);

      // 1. Generate Video Prompt & Caption
      const prompt = `
        You are a social media marketing expert. 
        Analyze the following marketing plan and generate:
        1. A detailed prompting string for an AI video generator (Veo) to create a high-quality video for this campaign.
        2. A catchy social media caption for Facebook.
        
        Marketing Plan:
        "${marketingPlan}"
        
        Output format (JSON):
        {
          "videoPrompt": "...",
          "caption": "..."
        }
      `;

      const result = await aiClient.models.generateContent({
        model: MODELS.TEXT,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = result.text;
      if (!responseText) throw new Error("No response from AI");
      
      const data = JSON.parse(responseText);
      
      const newDraft: MarketingDraft = {
        id: Date.now().toString(),
        plan: marketingPlan,
        videoPrompt: data.videoPrompt,
        caption: data.caption,
        status: 'draft',
        createdAt: Date.now(),
      };

      setDrafts(prev => [newDraft, ...prev]);
      setActiveDraftId(newDraft.id);
      setMarketingPlan(''); // Clear input

    } catch (err: any) {
      console.error(err);
      setError(`Failed to analyze marketing plan: ${err.message}`);
      if (err.message.includes('API key')) {
        setShowSettings(true);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Generate Video for Draft
  const handleGenerateVideo = async (draftId: string) => {
    const draft = drafts.find(d => d.id === draftId);
    if (!draft) return;

    // Update status
    setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status: 'generating_video' } : d));

    try {
        // Use custom key if provided, otherwise use default instance
        const aiClient = getAiClient(settings.geminiKey);
        let apiKey = settings.geminiKey || process.env.GEMINI_API_KEY;

        // Check for API Key first (client-side check for Veo)
        if (!apiKey) {
             throw new Error("Gemini API Key is missing. Please check Settings.");
        }

        // Check if user has selected a paid key for Veo (required)
        // @ts-ignore - window.aistudio is injected by the environment
        if (window.aistudio && window.aistudio.hasSelectedApiKey && !settings.geminiKey) {
            // @ts-ignore
            const hasKey = await window.aistudio.hasSelectedApiKey();
            if (!hasKey) {
                 // @ts-ignore
                 await window.aistudio.openSelectKey();
            }
        }

      let operation = await aiClient.models.generateVideos({
        model: MODELS.VIDEO,
        prompt: draft.videoPrompt,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      // Poll for completion
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5s
        operation = await aiClient.operations.getVideosOperation({ operation });
      }

      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      
      if (!videoUri) throw new Error("No video URI returned");

      // Fetch the actual video blob to display
      const videoResponse = await fetch(videoUri, {
        headers: {
          'x-goog-api-key': apiKey!,
        }
      });
      
      const videoBlob = await videoResponse.blob();
      const videoObjectUrl = URL.createObjectURL(videoBlob);

      setDrafts(prev => prev.map(d => d.id === draftId ? { 
        ...d, 
        videoUrl: videoObjectUrl, 
        status: 'ready' 
      } : d));

    } catch (err: any) {
      console.error("Video generation failed", err);
      setError(`Video generation failed: ${err.message}`);
      setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status: 'draft' } : d));
      if (err.message.includes('API key')) {
        setShowSettings(true);
      }
    }
  };

  const handlePostToFacebook = (draftId: string) => {
    if (!user) {
        setError("You must be logged in to Facebook to post.");
        return;
    }

    setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status: 'posted' } : d));
    alert("Successfully posted to Facebook! (Simulation)");
  };

  // Group schedule by week
  const scheduleByWeek = schedule.reduce((acc, item) => {
    const week = item.week.toString();
    if (!acc[week]) acc[week] = [];
    acc[week].push(item);
    return acc;
  }, {} as Record<string, ScheduleItem[]>);

  const toggleWeek = (week: string) => {
    setExpandedWeeks(prev => ({ ...prev, [week]: !prev[week] }));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
              A
            </div>
            <h1 className="text-xl font-semibold tracking-tight">AutoSocial Bot</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 transition-colors text-sm font-medium"
            >
              <Settings className="w-4 h-4" />
              Settings & Setup
            </button>

            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-slate-700">{user.name}</span>
                {user.picture?.data?.url ? (
                  <img src={user.picture.data.url} alt={user.name} className="w-8 h-8 rounded-full border border-slate-200" />
                ) : (
                  <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-slate-500">
                    {user.name.charAt(0)}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleLogin}
                className="flex items-center gap-2 bg-[#1877F2] hover:bg-[#166fe5] text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm"
              >
                <Facebook className="w-4 h-4" />
                Login with Facebook
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Input & Schedule */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Input Section */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                Marketing Plan
              </h2>
              
              <div className="space-y-4">
                {/* File Upload */}
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 rounded-xl p-6 text-center cursor-pointer transition-all group"
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept=".pdf,.txt,.csv,.md,image/*"
                    onChange={handleFileUpload}
                  />
                  <div className="w-10 h-10 bg-slate-100 group-hover:bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3 transition-colors">
                    {isExtracting ? (
                      <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                    ) : (
                      <Upload className="w-5 h-5 text-slate-500 group-hover:text-indigo-600" />
                    )}
                  </div>
                  <p className="text-sm font-medium text-slate-900">Upload Plan File</p>
                  <p className="text-xs text-slate-500 mt-1">PDF, Text, CSV, or Image</p>
                </div>

                <div className="relative flex items-center justify-center">
                  <hr className="w-full border-slate-200" />
                  <span className="absolute bg-white px-3 text-xs text-slate-400 uppercase tracking-wider">Or type it</span>
                </div>

                <textarea
                  value={marketingPlan}
                  onChange={(e) => setMarketingPlan(e.target.value)}
                  placeholder="Ex: We are launching a new summer collection..."
                  className="w-full h-32 p-4 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none resize-none text-sm leading-relaxed"
                />
                
                <div className="flex justify-end">
                  <button
                    onClick={handleAnalyzePlan}
                    disabled={!marketingPlan.trim() || isAnalyzing}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg font-medium transition-all text-sm"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Generate Quick Draft
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Schedule Section */}
            {schedule.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                    Extracted Schedule
                  </h2>
                  <span className="text-xs font-medium bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">
                    {schedule.length} Items
                  </span>
                </div>
                
                <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                  {Object.entries(scheduleByWeek).map(([week, items]) => (
                    <div key={week} className="bg-white">
                      <button 
                        onClick={() => toggleWeek(week)}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left"
                      >
                        <span className="font-medium text-slate-900">{week}</span>
                        {expandedWeeks[week] ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                      </button>
                      
                      <AnimatePresence>
                        {expandedWeeks[week] && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 space-y-3">
                              {items.map((item) => (
                                <div 
                                  key={item.id} 
                                  className={`p-3 rounded-lg border ${
                                    item.status === 'generated' 
                                      ? 'bg-green-50 border-green-200' 
                                      : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-sm'
                                  } transition-all`}
                                >
                                  <div className="flex justify-between items-start gap-3">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{item.day}</span>
                                        {item.status === 'generated' && <CheckCircle className="w-3 h-3 text-green-600" />}
                                      </div>
                                      <h4 className="text-sm font-medium text-slate-900 mb-1">{item.theme}</h4>
                                      <p className="text-xs text-slate-500 line-clamp-2">{item.contentIdea}</p>
                                    </div>
                                    <button
                                      onClick={() => handleGenerateFromSchedule(item)}
                                      disabled={isAnalyzing}
                                      className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg transition-colors"
                                      title="Generate Content"
                                    >
                                      <Play className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex items-start gap-2">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}
          </div>

          {/* Right Column: Drafts & Content */}
          <div className="lg:col-span-7 space-y-6">
            <h2 className="text-lg font-semibold">Campaign Drafts</h2>
            
            {drafts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Video className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-slate-900 font-medium mb-1">No drafts yet</h3>
                <p className="text-slate-500 text-sm">Upload a plan or enter text to generate content.</p>
              </div>
            ) : (
              <div className="space-y-6">
                <AnimatePresence>
                  {drafts.map((draft) => (
                    <motion.div
                      key={draft.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
                    >
                      <div className="p-6 border-b border-slate-100">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              draft.status === 'posted' ? 'bg-green-100 text-green-800' :
                              draft.status === 'ready' ? 'bg-blue-100 text-blue-800' :
                              draft.status === 'generating_video' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-slate-100 text-slate-800'
                            }`}>
                              {draft.status === 'posted' ? 'Posted' :
                               draft.status === 'ready' ? 'Ready to Post' :
                               draft.status === 'generating_video' ? 'Generating Video...' :
                               'Draft'}
                            </span>
                            <p className="mt-2 text-sm text-slate-500 line-clamp-2">{draft.plan}</p>
                          </div>
                          <div className="text-xs text-slate-400">
                            {new Date(draft.createdAt).toLocaleDateString()}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                          {/* Video Section */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Video Content</h4>
                            {draft.videoUrl ? (
                              <div className="aspect-video bg-black rounded-lg overflow-hidden relative group">
                                <video 
                                  src={draft.videoUrl} 
                                  controls 
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : (
                              <div className="aspect-video bg-slate-50 rounded-lg border border-slate-200 flex flex-col items-center justify-center p-6 text-center">
                                {draft.status === 'generating_video' ? (
                                  <>
                                    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-3" />
                                    <p className="text-sm text-slate-600 font-medium">Creating video...</p>
                                    <p className="text-xs text-slate-400 mt-1">This may take a minute</p>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-xs text-slate-500 mb-3 line-clamp-3 italic">
                                      "{draft.videoPrompt}"
                                    </p>
                                    <button
                                      onClick={() => handleGenerateVideo(draft.id)}
                                      className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
                                    >
                                      <Play className="w-4 h-4" />
                                      Generate Video
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Caption Section */}
                          <div className="space-y-3 flex flex-col">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Facebook Caption</h4>
                            <div className="flex-1 bg-slate-50 rounded-lg border border-slate-200 p-4 text-sm text-slate-700 whitespace-pre-wrap">
                              {draft.caption}
                            </div>
                            
                            <div className="pt-2">
                              <button
                                onClick={() => handlePostToFacebook(draft.id)}
                                disabled={draft.status !== 'ready' || !user}
                                className="w-full flex items-center justify-center gap-2 bg-[#1877F2] hover:bg-[#166fe5] disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl font-medium transition-colors"
                              >
                                {draft.status === 'posted' ? (
                                  <>
                                    <CheckCircle className="w-5 h-5" />
                                    Posted
                                  </>
                                ) : (
                                  <>
                                    <Facebook className="w-5 h-5" />
                                    {user ? 'Post to Facebook' : 'Login to Post'}
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Settings & Setup Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Settings className="w-6 h-6 text-slate-700" />
                  App Settings & Setup
                </h2>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              
              <div className="p-6 space-y-8">
                
                {/* Section 1: Gemini API Key */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-slate-900 font-medium">
                    <Key className="w-5 h-5 text-indigo-600" />
                    <h3>Gemini API Key</h3>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                    <p className="text-sm text-slate-600">
                      Required for analyzing plans and generating videos. 
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline ml-1">
                        Get your key here ↗
                      </a>
                    </p>
                    <input
                      type="password"
                      placeholder="Enter Gemini API Key (AIza...)"
                      value={settings.geminiKey}
                      onChange={(e) => setSettings(prev => ({ ...prev, geminiKey: e.target.value }))}
                      className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono text-sm"
                    />
                  </div>
                </section>

                <hr className="border-slate-100" />

                {/* Section 2: Facebook Setup */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-slate-900 font-medium">
                    <Facebook className="w-5 h-5 text-[#1877F2]" />
                    <h3>Facebook App Credentials</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-700 uppercase">App ID</label>
                        <input
                          type="text"
                          placeholder="Facebook App ID"
                          value={settings.fbAppId}
                          onChange={(e) => setSettings(prev => ({ ...prev, fbAppId: e.target.value }))}
                          className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#1877F2] focus:border-[#1877F2] outline-none font-mono text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-700 uppercase">App Secret</label>
                        <input
                          type="password"
                          placeholder="Facebook App Secret"
                          value={settings.fbAppSecret}
                          onChange={(e) => setSettings(prev => ({ ...prev, fbAppSecret: e.target.value }))}
                          className="w-full p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#1877F2] focus:border-[#1877F2] outline-none font-mono text-sm"
                        />
                      </div>
                    </div>

                    {/* Detailed Guide Accordion */}
                    <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                      <div className="p-4 bg-slate-100 border-b border-slate-200 font-medium text-sm text-slate-700">
                        How to get these credentials:
                      </div>
                      <div className="p-4 space-y-6 text-slate-600 text-sm">
                        
                        <div className="flex gap-3">
                          <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold shrink-0 text-xs">1</div>
                          <div>
                            <p className="font-medium text-slate-900">Create App</p>
                            <p className="mt-1">Go to <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Facebook Developers</a>, click "Create App", select "Consumer", and name it.</p>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold shrink-0 text-xs">2</div>
                          <div>
                            <p className="font-medium text-slate-900">Add Facebook Login Product</p>
                            <p className="mt-1">
                              If <strong>Facebook Login</strong> is not in the left sidebar:
                              <br />
                              1. Click <strong>Dashboard</strong> in the left sidebar.
                              <br />
                              2. Scroll down to "Add a product".
                              <br />
                              3. Find "Facebook Login" and click <strong>Set up</strong>.
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold shrink-0 text-xs">3</div>
                          <div className="w-full">
                            <p className="font-medium text-slate-900">Configure Redirect URI</p>
                            <p className="mt-1 mb-2">
                              1. In the left sidebar, expand <strong>Facebook Login</strong>.
                              <br />
                              2. Click <strong>Settings</strong> (under Facebook Login, NOT the main App Settings).
                              <br />
                              3. Find "Valid OAuth Redirect URIs" and paste:
                            </p>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 bg-white p-2 rounded border border-slate-200 text-xs font-mono break-all">
                                {window.location.origin}/api/auth/facebook/callback
                              </code>
                              <button 
                                onClick={copyRedirectUrl}
                                className="p-2 hover:bg-slate-200 rounded transition-colors"
                                title="Copy"
                              >
                                {copiedUrl ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3 text-slate-600" />}
                              </button>
                            </div>
                            <div className="mt-3">
                              <a 
                                href={`https://developers.facebook.com/apps/${settings.fbAppId || ''}/fb-login/settings/`}
                                target="_blank"
                                rel="noreferrer"
                                className={`inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-md hover:bg-indigo-100 transition-colors ${!settings.fbAppId && 'opacity-50 pointer-events-none'}`}
                              >
                                Open Settings Page Directly ↗
                              </a>
                            </div>
                            <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                              <strong>Important:</strong> You must also add <strong>{window.location.hostname}</strong> to the "App Domains" field in <strong>App Settings {'>'} Basic</strong>.
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold shrink-0 text-xs">4</div>
                          <div>
                            <p className="font-medium text-slate-900">Get Credentials</p>
                            <p className="mt-1">Go to <strong>Settings {'>'} Basic</strong>. Copy App ID and App Secret into the fields above.</p>
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                </section>

              </div>
              
              <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 text-slate-600 hover:text-slate-900 font-medium text-sm"
                >
                  Close
                </button>
                <button
                  onClick={() => setShowSettings(false)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-medium transition-colors text-sm"
                >
                  Save & Continue
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
