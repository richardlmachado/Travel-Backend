
'use client';

import React, { useState, useEffect } from 'react';
import { 
  Briefcase, 
  Menu, 
  Moon,
  Sun,
  Loader2,
  LogOut,
  Bell,
  User as UserIcon
} from 'lucide-react';
import Login from '../components/Login';
import { useStore } from '../store';

const IS_DEV_ENVIRONMENT = true; 

export default function TravelOSApp() {
  const { 
    session, profile, initializeAuth, isInitialized, signIn, signOut,
    theme, setTheme, notify
  } = useStore();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      initializeAuth();
    }
  }, [initializeAuth]);

  useEffect(() => {
    if (isInitialized && !session && IS_DEV_ENVIRONMENT) {
      signIn('admin@dev.com', 'dev_access_123');
    }
  }, [isInitialized, session, signIn]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const root = window.document.documentElement;
      if (theme === 'dark') root.classList.add('dark');
      else root.classList.remove('dark');
    }
  }, [theme]);

  if (!isInitialized) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 transition-colors font-sans antialiased">
        <Loader2 className="animate-spin text-indigo-600 mb-4" size={40} />
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Sincronizando Sistema...</p>
      </div>
    );
  }
  
  if (!session && !IS_DEV_ENVIRONMENT) return <Login />;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50/50 dark:bg-slate-950 font-sans antialiased text-slate-600 transition-colors duration-300">
      
      <aside className={`fixed inset-y-0 left-0 z-[100] w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-transform duration-300 transform lg:relative lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="p-6">
            <div className="flex items-center space-x-3 text-indigo-600">
              <div className="bg-indigo-600 text-white p-2 rounded-xl"><Briefcase size={20} /></div>
              <h1 className="text-lg font-black tracking-tighter text-slate-800 dark:text-slate-100 uppercase">TravelOS</h1>
            </div>
          </div>
          <nav className="flex-1 px-4 space-y-1 overflow-y-auto no-scrollbar">
            <div className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Menu Principal</div>
            <button className="flex items-center space-x-3 w-full px-4 py-3 rounded-xl bg-indigo-600 text-white shadow-sm">
              <UserIcon size={18} className="shrink-0" />
              <span className="font-medium text-sm tracking-tight truncate">Início</span>
            </button>
          </nav>
          <div className="p-4 border-t border-slate-100 dark:border-slate-800">
            <button onClick={() => signOut()} className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase text-rose-500 hover:bg-rose-50 rounded-lg transition-all"><LogOut size={14} /> Sair</button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 shrink-0 relative z-[150]">
          <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-400"><Menu size={20} /></button>
          
          <div className="flex-1"></div>

          <div className="flex items-center space-x-4">
            <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors">
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <div className="hidden sm:block text-right">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate max-w-[120px]">{profile?.name || 'Usuário'}</p>
              <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider">{profile?.role || 'Admin'}</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-8 no-scrollbar flex flex-col items-center justify-center text-center space-y-6">
          <div className="max-w-md space-y-4">
            <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Bem-vindo ao TravelOS</h2>
            <p className="text-slate-500 dark:text-slate-400 font-medium">O sistema foi simplificado conforme sua solicitação. O design, a página de login e o sistema de notificações foram mantidos.</p>
          </div>
          
          <button 
            onClick={() => notify('Esta é uma notificação de teste!', 'success')}
            className="flex items-center gap-2 px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all hover:scale-105 active:scale-95"
          >
            <Bell size={18} />
            Testar Notificação
          </button>
        </div>
      </main>
      
      {isSidebarOpen && <div className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm lg:hidden" onClick={() => setIsSidebarOpen(false)}></div>}
    </div>
  );
}
