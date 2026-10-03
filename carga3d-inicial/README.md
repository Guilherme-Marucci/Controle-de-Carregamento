# Carga3D

Aplicação para planejar a distribuição de paletes em caminhões de médio porte, com visualização em 3D.

## O que o projeto faz

- Cadastra caminhões, produtos e dimensões dos paletes carregados.
- Distribui os paletes considerando espaço, peso e folgas.
- Separa produtos frágeis e indica a necessidade de amarração com cinta.
- Organiza os mais leves perto da cabine quando há um único destino, ou considera a ordem de entrega quando há vários destinos.
- Permite ajustar posições, salvar cargas e consultar os planejamentos depois.

Tecnologias: React, TypeScript, Vinext/Vite e banco Cloudflare D1, simulado localmente no computador.

## Como executar em outra máquina

### 1. Preparar o computador

Instale o **Node.js 24**, que inclui o npm. É necessário acesso à internet para baixar as dependências na primeira instalação.

Copie a pasta `carga3d-inicial` para o outro computador, incluindo os arquivos ocultos, especialmente `.openai/hosting.json`. Não é necessário copiar `node_modules`, `dist`, `.next`, `.vinext`, `.npm-cache`, `.sites-runtime`, `outputs` ou `.wrangler`.

Esta versão começa sem cadastros e sem cargas de demonstração. Os dados de outras instalações não são incluídos.

### 2. Instalar as dependências

Abra um terminal dentro da pasta `carga3d-inicial` e execute:

```sh
npm ci --include=dev --include=optional
```

No PowerShell do Windows, se aparecer que a execução de scripts foi desabilitada, use `npm.cmd` no lugar de `npm` em todos os comandos:

```powershell
npm.cmd ci --include=dev --include=optional
npm.cmd run dev
```

### 3. Iniciar a aplicação

```sh
npm run dev
```

O comando prepara automaticamente o banco local antes de abrir o servidor. Pode ser repetido: os cadastros existentes são preservados. Não é necessário compilar antes de usar no modo local.

Abra **http://127.0.0.1:5173/** no navegador. Se o terminal mostrar outra porta, use o endereço informado nele.

Clique em **Entrar para salvar**. No modo local, esse botão usa uma conta fictícia de desenvolvimento: não pede uma conta real nem uma chave de API.

Mantenha o terminal aberto enquanto usa a aplicação. Para encerrar, pressione **Ctrl + C**. Nas próximas vezes, basta executar `npm run dev` novamente.

## Como usar

1. Cadastre o caminhão com suas medidas internas e capacidade disponível.
2. Cadastre os produtos e seus paletes. O peso e a altura total devem incluir o palete.
3. Escolha as quantidades, a separação dos frágeis e se todos vão ao mesmo destino.
4. Para destinos diferentes, informe a parada e a ordem de entrega de cada produto.
5. Clique em **Gerar distribuição**, confira o 3D e salve a carga.

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
