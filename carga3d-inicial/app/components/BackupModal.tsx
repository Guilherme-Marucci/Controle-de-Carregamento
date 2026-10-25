'use client';
import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { type Workspace } from '@/lib/domain';
import { workspaceSchema } from '@/lib/validation';

interface BackupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceData: Workspace;
  onRestoreWorkspace: (restored: Workspace) => Promise<void>;
}

export default function BackupModal({
  open,
  onOpenChange,
  workspaceData,
  onRestoreWorkspace
}: BackupModalProps) {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    try {
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(workspaceData, null, 2)
      )}`;
      const downloadAnchor = document.createElement('a');
      const filename = `carga3d_backup_${new Date().toISOString().slice(0, 10)}.json`;
      downloadAnchor.setAttribute('href', jsonString);
      downloadAnchor.setAttribute('download', filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setSuccess('Backup exportado com sucesso!');
    } catch {
      setError('Erro ao gerar arquivo de exportação.');
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      const validated = workspaceSchema.safeParse(parsed);
      if (!validated.success) {
        throw new Error(
          'Arquivo inválido ou corrompido: ' + (validated.error.issues[0]?.message || 'formato incorreto')
        );
      }

      await onRestoreWorkspace(validated.data);
      setSuccess('Dados restaurados e sincronizados com sucesso!');
      setTimeout(() => {
        onOpenChange(false);
      }, 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao importar arquivo JSON.');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-xl font-bold flex items-center gap-2">
          <svg className="w-6 h-6 text-[#dc672d]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Backup & Migração de Dados
        </DialogTitle>

        <DialogDescription className="text-xs text-slate-500 mt-1">
          Exporte ou importe todos os cadastros de caminhões, produtos e cargas salvas em formato seguro JSON.
        </DialogDescription>

        {error && (
          <div className="bg-red-50 text-red-700 text-xs p-3 rounded border border-red-200 mt-3">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 text-emerald-800 text-xs p-3 rounded border border-emerald-200 mt-3 font-semibold">
            {success}
          </div>
        )}

        <div className="mt-5 space-y-4">
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <h4 className="text-xs font-bold text-slate-800 uppercase mb-1">Exportar Backup</h4>
            <p className="text-xs text-slate-500 mb-3">
              Gera um arquivo com {workspaceData.trucks.length} caminhões, {workspaceData.products.length} produtos e {workspaceData.loads.length} cargas salvas.
            </p>
            <Button
              onClick={handleExport}
              className="w-full bg-[#dc672d] hover:bg-[#c95922] text-white text-xs font-semibold"
            >
              Baixar Arquivo de Backup (.json)
            </Button>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <h4 className="text-xs font-bold text-slate-800 uppercase mb-1">Restaurar / Importar</h4>
            <p className="text-xs text-slate-500 mb-3">
              Selecione um arquivo de backup `.json` para restaurar e salvar no banco local.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full text-xs font-semibold text-slate-700"
            >
              {loading ? 'Validando e Importando...' : 'Selecionar Arquivo .json para Restaurar'}
            </Button>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-xs">
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
