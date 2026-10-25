# Carga3D - Sistema de Gestão de Carregamento & Visualização 3D

Aplicação completa para planejar a distribuição física de paletes em caminhões de médio porte, simulação de balança por eixo, romaneio oficial de expedição, indicadores de frota e visualização interativa em 3D.

## Novas Funcionalidades e Seções Adicionadas

- **Autenticação & Controle de Acesso Local:** Sistema de login com perfis rápidos (Gestor de Frota, Operador de Carga, Conferente de Expedição) e identificação manual customizada via cookie de sessão seguro (`c3d_session`).
- **Romaneio de Carga & Expedição:** Ordem sequencial física de carregamento (primeiro ao fundo) e descarregamento (porta traseira), impressão A4 oficial e exportação em planilha CSV.
- **Balança & Distribuição por Eixo:** Cálculo estático em tempo real do Centro de Gravidade (CG) longitudinal e lateral, alertando sobrecargas na cabine, no truco traseiro ou desequilíbrio lateral.
- **Painel de Indicadores (Dashboard):** KPIs logísticos de ocupação volumétrica, peso médio, histórico de cargas e catálogo ativo.
- **Biblioteca de Predefinições Brasileiras:** Adição em 1 clique de caminhões normatizados ABNT/CONTRAN (VUC 3/4, Toco, Truck 6x2 e Carreta) e paletes padronizados PBR e Euro.
- **Backup & Restauração JSON:** Exportação e importação de todo o banco de dados local com validação rigorosa via schemas Zod.
- **Suíte de Testes Automatizados:** Testes unitários de motor de cálculo e testes de segurança defensiva executados via `npm test`.

## Como Executar no Servidor Local

### 1. Preparar o Ambiente
Instale o **Node.js 22 ou 24** (com npm).

```powershell
# No PowerShell do Windows (dentro da pasta carga3d-inicial):
npm.cmd run db:init
npm.cmd run dev
```

Abra **http://127.0.0.1:5173/** no seu navegador.

### 2. Autenticação e Uso
1. Clique em **Entrar no Sistema Local** no canto superior direito.
2. Selecione um perfil rápido (ex: *Carlos Gestor*) ou digite seu nome e cargo.
3. Clique em **Predefinições BR** para carregar veículos e paletes com 1 clique, ou clique em **Iniciar Demonstração 3D**.
4. Navegue pelas abas:
   - **Planejar carga:** Simulação 3D de encaixe, rotação e folgas.
   - **Romaneio & Expedição:** Sequência de carregamento e impressão A4.
   - **Balança & Eixos:** Distribuição nos eixos dianteiro/traseiro e lateral.
   - **Indicadores:** KPIs consolidados de aproveitamento de carga.
   - **Cargas salvas:** Histórico salvo no banco de dados local.

### 3. Execução dos Testes Automatizados
```powershell
npm.cmd test
```


Os dados ficam em `.wrangler/state` na própria máquina. Fechar o navegador não apaga os registros; excluir essa pasta apaga o banco local. Computadores diferentes não compartilham os dados automaticamente.

## Problemas comuns

- **Entrou, mas os cadastros não carregam:** execute `npm run db:init` (ou `npm.cmd run db:init` no PowerShell) e atualize a página.
- **Login não abre:** use `npm run dev` e o endereço `http://127.0.0.1:5173/` na própria máquina. A conta de desenvolvimento funciona apenas no servidor local de desenvolvimento; `npm start` não oferece esse login.
- **Porta ocupada:** encerre a outra execução ou use `npm run dev -- --port 5174`.
- **PowerShell bloqueou `npm.ps1`:** use `npm.cmd` no lugar de `npm`, sem alterar a política do Windows.
- **Falha no lançador npm ao iniciar ou compilar:** com as dependências instaladas, use `node scripts/run-framework.mjs dev` ou `node scripts/run-framework.mjs build`.

Para verificar a compilação do projeto, execute `npm run build`.

## Limites desta versão

O sistema organiza paletes já montados, sem empilhamento, e aceita até 250 unidades por planejamento. Usa regras de cálculo; ainda não há uma IA treinada.

A indicação de cinta é ilustrativa. O sistema não calcula a resistência da amarração, a carga por eixo nem garante proteção contra esmagamento. A separação inicial de 10 cm é configurável e precisa ser confirmada conforme a operação.

As instruções acima são para uso local em cada computador. Disponibilizar o aplicativo pela internet ou como sistema compartilhado exige configurar hospedagem, banco e autenticação reais.

## Para quem vai desenvolver

- `app/`: interface, visualização 3D e API.
- `lib/domain.ts`: cálculo de distribuição e validação das regras.
- `db/` e `drizzle/`: estrutura e migrações do banco.

## Primeiro commit

A pasta está sem histórico Git e sem vínculo com a hospedagem anterior. Para iniciar seu repositório, execute dentro dela:

```sh
git init
git add .
git commit -m "Versão inicial do Carga3D"
```

Esta cópia não inclui testes automatizados, banco local, dependências instaladas, caches ou arquivos de compilação. O motor de distribuição e suas validações fazem parte da aplicação e foram mantidos.
