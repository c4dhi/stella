import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

// --- STYLES & ANIMATIONS ---
const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&display=swap');

    body {
      background-color: #030305;
      color: white;
      font-family: 'Inter', sans-serif;
      overflow-x: hidden;
    }

    .font-serif {
      font-family: 'Playfair Display', serif;
    }

    @keyframes shimmer {
      0% { transform: translateX(-150%); }
      100% { transform: translateX(150%); }
    }

    @keyframes gradient-shift {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }

    .animate-shimmer { animation: shimmer 2s infinite; }
    .animate-gradient { animation: gradient-shift 8s ease infinite; }

    .gradient-border {
      position: relative;
      background: rgba(15, 15, 26, 0.8);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }

    .gradient-border::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 20px;
      padding: 1px;
      background: linear-gradient(
        135deg,
        rgba(124, 58, 237, 0.8) 0%,
        rgba(6, 182, 212, 0.6) 25%,
        rgba(59, 130, 246, 0.5) 50%,
        rgba(124, 58, 237, 0.8) 75%,
        rgba(6, 182, 212, 0.6) 100%
      );
      background-size: 200% 200%;
      animation: gradient-shift 8s ease infinite;
      -webkit-mask:
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }

    .input-group {
      border-radius: 12px;
      overflow: hidden;
    }

    .input-group:focus-within {
      border-color: rgba(124, 58, 237, 0.5);
      box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.1);
      background: rgba(124, 58, 237, 0.02);
    }

    .input-group input {
      border-radius: 12px;
    }
  `}</style>
);

// --- BACKGROUND ---
const BackgroundEffects = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
    {/* Base Gradient */}
    <div className="absolute inset-0 bg-gradient-to-b from-[#030305] via-[#050508] to-[#0a0a12]" />

    {/* Nebula Clouds */}
    <div
      className="absolute inset-0 opacity-20"
      style={{
        backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(124, 58, 237, 0.2) 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(6, 182, 212, 0.15) 0%, transparent 50%)',
        filter: 'blur(80px)',
      }}
    />

    {/* Grid Overlay */}
    <div
      className="absolute inset-0 opacity-[0.08]"
      style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
        maskImage: 'radial-gradient(circle at center, black 0%, transparent 70%)'
      }}
    />
  </div>
);

// --- MAIN PAGE COMPONENT ---

export default function LoginPage() {
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Auth store
  const {
    login,
    signup,
    isLoading,
    error,
    signupSuccess,
    isAuthenticated,
    clearError
  } = useAuthStore();

  // Form State
  const [formData, setFormData] = useState({ email: '', password: '', name: '' });

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      if (isSignup) {
        await signup(formData.email, formData.password, formData.name);
      } else {
        await login(formData.email, formData.password);
      }
    } catch (err) {
      console.error('Auth error:', err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const toggleMode = () => {
    setIsSignup(!isSignup);
    clearError();
    setFormData({ email: '', password: '', name: '' });
  };

  return (
    <>
      <Styles />
      <div className="min-h-screen w-full flex items-center justify-center relative text-white selection:bg-violet-500/30 selection:text-white p-6">
        <BackgroundEffects />

        {/* Centered Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="w-full max-w-[440px] relative z-10"
        >
          {/* STELLA Branding */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-center mb-8"
          >
            <h1 className="font-serif text-4xl sm:text-5xl font-medium tracking-[0.15em] text-white mb-2">
              STELLA
            </h1>
            <p className="text-white/30 text-xs tracking-wide">
              System for Testing and Engineering LLM-based conversational Agents
            </p>
          </motion.div>

          {/* Login Card with Gradient Border */}
          <div className="gradient-border rounded-[20px] p-8 sm:p-10 relative">
            {/* Glow effect behind card */}
            <div className="absolute -inset-1 bg-gradient-to-r from-violet-600/20 via-cyan-500/20 to-blue-500/20 rounded-[24px] blur-xl opacity-50 -z-10" />

            <div className="relative z-10">
              {/* Header */}
              <div className="mb-8 text-center">
                <motion.div
                  key={isSignup ? 'signup-h' : 'signin-h'}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <h2 className="text-2xl font-light text-white mb-2">
                    {isSignup ? 'Request Access' : 'Welcome Back'}
                  </h2>
                  <p className="text-white/40 text-sm font-light">
                    {isSignup ? 'Submit your request. An admin will review and approve your access.' : 'Sign in to continue to your dashboard.'}
                  </p>
                </motion.div>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5">
                <AnimatePresence mode="popLayout">
                  {isSignup && (
                    <motion.div
                      initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                      animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
                      exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                    >
                      <div className="space-y-2 group">
                        <label className="text-xs font-medium tracking-wider text-white/50 uppercase ml-1 transition-colors group-focus-within:text-violet-400">
                          Name
                        </label>
                        <div className="input-group relative transition-all duration-300 rounded-xl border border-white/10 bg-white/[0.03]">
                          <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleInputChange}
                            required={isSignup}
                            className="w-full bg-transparent border-none px-4 py-3.5 text-sm text-white placeholder-white/20 focus:ring-0 focus:outline-none"
                            placeholder="Richard Hendricks"
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-2 group">
                  <label className="text-xs font-medium tracking-wider text-white/50 uppercase ml-1 transition-colors group-focus-within:text-violet-400">
                    Email
                  </label>
                  <div className="input-group relative transition-all duration-300 rounded-xl border border-white/10 bg-white/[0.03]">
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                      className="w-full bg-transparent border-none px-4 py-3.5 text-sm text-white placeholder-white/20 focus:ring-0 focus:outline-none"
                      placeholder="richard@piedpiper.com"
                    />
                  </div>
                </div>

                <div className="space-y-2 group">
                  <div className="flex justify-between items-center ml-1">
                    <label className="text-xs font-medium tracking-wider text-white/50 uppercase transition-colors group-focus-within:text-violet-400">
                      Password
                    </label>
                    {!isSignup && (
                      <button type="button" className="text-xs text-white/30 hover:text-white transition-colors">
                        Forgot?
                      </button>
                    )}
                  </div>
                  <div className="input-group relative transition-all duration-300 rounded-xl border border-white/10 bg-white/[0.03]">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleInputChange}
                      required
                      className="w-full bg-transparent border-none px-4 py-3.5 text-sm text-white placeholder-white/20 focus:ring-0 focus:outline-none pr-12"
                      placeholder="middleout123"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/30 hover:text-white/80 transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Notifications */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="bg-red-500/10 border border-red-500/20 text-red-200 text-xs p-3 rounded-lg flex items-center gap-3"
                    >
                      <AlertCircle size={14} className="shrink-0" />
                      <span>{error}</span>
                    </motion.div>
                  )}
                  {signupSuccess && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-xs p-3 rounded-lg flex items-center gap-3"
                    >
                      <CheckCircle2 size={14} className="shrink-0" />
                      <span>{signupSuccess}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full relative overflow-hidden group bg-gradient-to-r from-violet-600 to-violet-500 text-white font-medium py-3.5 rounded-xl transition-all duration-300 hover:from-violet-500 hover:to-violet-400 hover:shadow-[0_0_30px_rgba(124,58,237,0.4)] disabled:opacity-70 disabled:hover:shadow-none mt-2"
                >
                  <div className="relative z-10 flex items-center justify-center gap-3">
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span className="text-sm font-medium">{isSignup ? 'Submitting...' : 'Signing in...'}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-medium">{isSignup ? 'Request Access' : 'Sign In'}</span>
                        <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </div>
                  {/* Shimmer Effect */}
                  <div className="absolute inset-0 -translate-x-full group-hover:animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent z-0" />
                </button>
              </form>

              {/* Toggle Sign Up / Sign In */}
              <div className="mt-6 pt-6 border-t border-white/5 text-center">
                <p className="text-white/40 text-sm">
                  {isSignup ? 'Already have access?' : "Need access?"}
                  <button
                    onClick={toggleMode}
                    className="ml-2 text-violet-400 hover:text-violet-300 transition-colors duration-300 font-medium"
                  >
                    {isSignup ? 'Sign In' : 'Request Access'}
                  </button>
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-white/20 text-xs">
              Secure • Private • Encrypted
            </p>
          </div>
        </motion.div>
      </div>
    </>
  );
}
