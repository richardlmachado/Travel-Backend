
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { toast } from 'sonner';

interface TravelStore {
  session: any | null;
  user: any | null;
  profile: any | null;
  isInitialized: boolean;
  theme: 'light' | 'dark';
  
  initializeAuth: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => void;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const useStore = create<TravelStore>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      profile: null,
      isInitialized: false,
      theme: 'light',

      initializeAuth: async () => {
        set({ isInitialized: true });
      },

      signIn: async (email, password) => {
        // Mock sign in
        const mockUser = { id: '1', email, name: 'Usuário Admin' };
        set({ 
          session: { user: mockUser }, 
          user: mockUser, 
          profile: { id: '1', name: 'Usuário Admin', role: 'admin' } 
        });
        toast.success('Login realizado com sucesso!');
      },

      signOut: async () => {
        set({ session: null, user: null, profile: null });
        toast.info('Sessão encerrada.');
      },

      setTheme: (theme) => set({ theme }),

      notify: (message, type = 'info') => {
        if (type === 'success') toast.success(message);
        else if (type === 'error') toast.error(message);
        else toast(message);
      }
    }),
    {
      name: 'travel-flow-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        session: state.session,
        user: state.user,
        profile: state.profile,
        theme: state.theme
      })
    }
  )
);
