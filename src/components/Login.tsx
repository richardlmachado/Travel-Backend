
import React, { useState } from 'react';
import { 
  Briefcase, 
  Mail, 
  Lock, 
  ChevronRight, 
  Loader2, 
  ArrowRight,
  Globe,
  ShieldCheck,
  Compass
} from 'lucide-react';
import { useStore } from '../store';
import { toast } from 'sonner';

const Login: React.FC = () => {
  const { signIn } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Preencha todos os campos');
      return;
    }

    setIsLoading(true);
    try {
      await signIn(email, password);
      toast.success('Seja bem-vindo de volta!');
    } catch (error) {
      // Error handled in store
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {/* Coluna Esquerda: Branding & Visual */}
      <div className="hidden lg:flex lg:w-3/5 relative bg-indigo-950">
        <img 
          src="https://images.unsplash.com/photo-1436491865332-7a61a109c0f2?auto=format&fit=crop&w=1200&q=80" 
          alt="Travel Background" 
          className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-overlay"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-indigo-900/60 to-transparent"></div>
        
        <div className="relative z-10 flex flex-col justify-between p-20 w-full">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20">
                <Briefcase className="text-white" size={32} />
             </div>
             <h1 className="text-3xl font-black text-white tracking-tighter">
               TravelAgent<span className="text-indigo-400">OS</span>
             </h1>
          </div>

          <div className="max-w-xl">
            <h2 className="text-6xl font-black text-white leading-[1.1] mb-8 tracking-tight">
              A Nova Era do <br/><span className="text-indigo-400 italic">Backoffice Turístico</span>.
            </h2>
            <p className="text-xl text-indigo-100 font-medium leading-relaxed opacity-80">
              Gerencie reservas, CRM, financeiro e jurídico em uma única torre de controle de alta performance.
            </p>
          </div>

          <div className="flex gap-12">
             <div className="space-y-2">
                <p className="text-4xl font-black text-white">100%</p>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Auditável</p>
             </div>
             <div className="space-y-2">
                <p className="text-4xl font-black text-white">Cloud</p>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Escalável</p>
             </div>
             <div className="space-y-2">
                <p className="text-4xl font-black text-white">NextGen</p>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Segurança</p>
             </div>
          </div>
        </div>
      </div>

      {/* Coluna Direita: Formulário */}
      <div className="w-full lg:w-2/5 flex flex-col items-center justify-center p-8 md:p-20 relative">
        <div className="absolute top-12 right-12 flex items-center gap-2">
           <Globe size={16} className="text-slate-400" />
           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Português (BR)</span>
        </div>

        <div className="w-full max-w-sm space-y-12">
          <div className="text-center lg:text-left space-y-4">
             <div className="lg:hidden flex justify-center mb-8">
                <div className="p-3 bg-indigo-600 rounded-2xl shadow-xl">
                   <Briefcase className="text-white" size={28} />
                </div>
             </div>
             <h3 className="text-4xl font-black text-slate-800 tracking-tight">Login Seguro</h3>
             <p className="text-slate-500 font-medium">Entre para gerenciar sua agência de elite.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">E-mail Corporativo</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-600 transition-colors" size={20} />
                <input 
                  type="email" 
                  autoFocus
                  className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl py-4 pl-12 pr-4 text-sm font-bold outline-none focus:bg-white focus:border-indigo-600 transition-all shadow-sm"
                  placeholder="seu@agencia.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Sua Senha</label>
                <button type="button" className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline">Esqueci a Senha</button>
              </div>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-600 transition-colors" size={20} />
                <input 
                  type="password" 
                  className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl py-4 pl-12 pr-4 text-sm font-bold outline-none focus:bg-white focus:border-indigo-600 transition-all shadow-sm"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={isLoading}
              className="w-full py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black text-sm uppercase tracking-widest shadow-2xl shadow-indigo-100 hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3 group"
            >
              {isLoading ? (
                <Loader2 size={24} className="animate-spin" />
              ) : (
                <>
                  Entrar no Backoffice
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-slate-100"></div>
              <span className="text-[10px] font-black text-slate-400 uppercase">Ou continue com</span>
              <div className="flex-1 h-px bg-slate-100"></div>
            </div>

            <button className="w-full py-4 bg-white border border-slate-200 rounded-2xl flex items-center justify-center gap-3 hover:bg-slate-50 transition-all group">
              <img src="https://www.google.com/favicon.ico" className="w-5 h-5 grayscale group-hover:grayscale-0 transition-all" alt="Google" />
              <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">Login com Google</span>
            </button>
          </div>

          <div className="pt-12 flex items-center justify-center gap-6">
             <div className="flex items-center gap-2 text-slate-400">
                <ShieldCheck size={14} />
                <span className="text-[9px] font-bold uppercase">SSL Encrypted</span>
             </div>
             <div className="flex items-center gap-2 text-slate-400">
                <Compass size={14} />
                <span className="text-[9px] font-bold uppercase">v3.0 Stable</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
