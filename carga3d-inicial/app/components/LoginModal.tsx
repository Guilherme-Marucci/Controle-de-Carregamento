'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type ChatGPTUser, PRESET_USERS } from '@/lib/auth-session';

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: ChatGPTUser | null;
  onLoginSuccess: (user: ChatGPTUser) => void;
  onLogoutSuccess: () => void;
}

export default function LoginModal({
  open,
  onOpenChange,
  currentUser,
  onLoginSuccess,
  onLogoutSuccess
}: LoginModalProps) {
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');
  const [customName, setCustomName] = useState('');
  const [customEmail, setCustomEmail] = useState('');
  const [customRole, setCustomRole] = useState('Operador Logístico');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handlePresetLogin(userId: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', userId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao autenticar.');
      onLoginSuccess(data.user);
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao realizar login.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCustomLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'custom_login',
          displayName: customName,
          email: customEmail,
          role: customRole
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao criar sessão.');
      onLoginSuccess(data.user);
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao autenticar.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' })
      });
      if (!res.ok) throw new Error('Falha ao desconectar.');
      onLogoutSuccess();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao desconectar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto p-6">
        <DialogTitle className="text-xl font-bold flex items-center gap-2">
          <svg className="w-6 h-6 text-[#dc672d]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          {currentUser ? 'Perfil de Operação' : 'Controle de Acesso & Login Local'}
        </DialogTitle>
        
        <DialogDescription className="text-sm text-slate-500 mt-1">
          {currentUser 
            ? 'Você está autenticado no ambiente local. Os dados de caminhões e cargas são salvos nesta conta.'
            : 'Selecione um perfil operacional rápido ou entre com suas credenciais de operador.'}
        </DialogDescription>

        {error && (
          <div className="bg-red-50 text-red-700 text-sm p-3 rounded-md border border-red-200 mt-3 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-500 font-bold ml-2">×</button>
          </div>
        )}

        {currentUser ? (
          <div className="mt-4 space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-[#dc672d] text-white font-bold text-lg flex items-center justify-center shadow-inner">
                {currentUser.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-slate-900 text-base">{currentUser.displayName}</div>
                <div className="text-xs text-slate-500">{currentUser.email}</div>
                <div className="mt-1 inline-block bg-orange-100 text-orange-800 text-xs px-2 py-0.5 rounded font-medium">
                  {currentUser.role || 'Operador'}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex flex-col gap-2">
              <Button
                variant="outline"
                className="w-full justify-center"
                onClick={() => {
                  // Permitir trocar de perfil
                  setActiveTab('presets');
                }}
              >
                Trocar Perfil / Entrar com Outro Usuário
              </Button>
              <Button
                variant="destructive"
                className="w-full justify-center"
                disabled={loading}
                onClick={handleLogout}
              >
                {loading ? 'Saindo...' : 'Encerrar Sessão (Logout)'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex border-b border-slate-200 mb-4">
              <button
                type="button"
                className={`flex-1 pb-2 text-sm font-semibold text-center border-b-2 transition-colors ${
                  activeTab === 'presets'
                    ? 'border-[#dc672d] text-[#dc672d]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setActiveTab('presets')}
              >
                Acesso Rápido (Perfis)
              </button>
              <button
                type="button"
                className={`flex-1 pb-2 text-sm font-semibold text-center border-b-2 transition-colors ${
                  activeTab === 'custom'
                    ? 'border-[#dc672d] text-[#dc672d]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setActiveTab('custom')}
              >
                Identificação Manual
              </button>
            </div>

            {activeTab === 'presets' ? (
              <div className="space-y-3">
                {PRESET_USERS.map((preset) => (
                  <button
                    key={preset.userId}
                    type="button"
                    disabled={loading}
                    onClick={() => handlePresetLogin(preset.userId)}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-orange-400 hover:bg-orange-50/50 transition-all flex items-start gap-3 group focus:outline-none focus:ring-2 focus:ring-[#dc672d]"
                  >
                    <div className="w-10 h-10 rounded-full bg-slate-100 group-hover:bg-orange-200 text-slate-700 group-hover:text-orange-900 font-bold flex items-center justify-center shrink-0 text-sm">
                      {preset.displayName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 text-sm group-hover:text-orange-900">
                          {preset.displayName}
                        </span>
                        <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                          {preset.role}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{preset.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <form onSubmit={handleCustomLogin} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Nome Completo</label>
                  <Input
                    required
                    placeholder="Ex: João da Silva"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">E-mail Operacional</label>
                  <Input
                    required
                    type="email"
                    placeholder="Ex: joao.silva@transportadora.com.br"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Cargo / Função</label>
                  <select
                    className="w-full h-10 px-3 border border-slate-300 rounded-md bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#dc672d]"
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value)}
                  >
                    <option value="Gestor de Frota">Gestor de Frota</option>
                    <option value="Operador Logístico">Operador Logístico</option>
                    <option value="Conferente de Carga">Conferente de Carga</option>
                    <option value="Motorista / Agregado">Motorista / Agregado</option>
                    <option value="Engenheiro de Logística">Engenheiro de Logística</option>
                  </select>
                </div>
                <div className="pt-2">
                  <Button
                    type="submit"
                    className="w-full bg-[#dc672d] hover:bg-[#c95922] text-white font-semibold"
                    disabled={loading}
                  >
                    {loading ? 'Entrando...' : 'Entrar no Sistema Local'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
