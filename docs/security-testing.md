# Testes de segurança com Trail of Bits Skills e Strix

Este roteiro usa duas ferramentas diferentes: as skills da Trail of Bits guiam
a revisão de código; o Strix executa uma avaliação autônoma em sandbox Docker.
Uma execução sem achados não demonstra ausência de vulnerabilidades. A política
de divulgação e o escopo estão em [SECURITY.md](../SECURITY.md).

## 1. Estado inicial e verificações locais

Na raiz do repositório, confira `git status --short`. Preserve alterações e
pastas antigas. Instale as dependências fixadas com `npm ci` em `client/` e
`server/`. Execute:

```powershell
git config core.hooksPath .githooks
node scripts/check-secrets.cjs
npm --prefix server test
npm --prefix client test
npm --prefix client run lint
npm --prefix client run build
```

O Gitleaks oficial deve estar no PATH ou em `.tools/gitleaks/gitleaks.exe`.
Não desative as verificações para permitir um relatório ou exemplo. Guarde
relatórios completos em `security-reports/`, que já é ignorado pelo Git.

## 2. Trail of Bits Skills: revisão orientada

Fonte: [trailofbits/skills](https://github.com/trailofbits/skills).
Na preparação de 16/11/2026 foi consultado o commit
`149d7b21f4067765b82e67029730b42d228ef4b4`. As skills são instruções de
trabalho para um agente; baixar o repositório não executa uma auditoria e não
instala automaticamente todos os plugins no Codex.

```powershell
# Somente se a pasta ainda não existir:
git clone --depth 1 https://github.com/trailofbits/skills.git .tools/security/trailofbits-skills
git -C .tools/security/trailofbits-skills rev-parse HEAD
```

Comece por `plugins/sharp-edges/skills/sharp-edges/SKILL.md` e suas referências
de configuração, autenticação e JavaScript. Leia o código chamado por cada
controle antes de concluir se uma entrada é validada. Nesta primeira rodada,
o foco é `server/runtime-config.js`, `server/database.js`, `server/accounts.js`
e o construtor de `server/app.js`: valores vazios, origem, cookies, opções
de produção, verificação de TLS e tratamento de erros.

Para uma revisão posterior mais ampla, selecione `audit-context-building`,
`static-analysis` ou `property-based-testing` conforme o objetivo. Leia a
`SKILL.md` escolhida antes de usar; ferramentas como Semgrep e CodeQL têm
pré-requisitos próprios. Não trate esta revisão focada como execução dessas
outras ferramentas. A instalação permanente de plugins é opcional; as
instruções atuais de instalação estão no README do upstream.

## 3. Strix: instalação local reproduzível

Fonte: [usestrix/strix](https://github.com/usestrix/strix).
Na preparação de 16/11/2026 foi utilizado o commit
`1152d53579d5b3af37ada8c798f197ab093b99c6`. Confira o comando abaixo e
registre a revisão efetivamente usada em cada execução.

```powershell
# Somente se a pasta ainda não existir:
git clone --depth 1 https://github.com/usestrix/strix.git .tools/security/strix
git -C .tools/security/strix rev-parse HEAD
uv sync --frozen --no-dev --project .tools/security/strix
$env:STRIX_TELEMETRY = '0'
& .\.tools\security\strix\.venv\Scripts\python.exe -c 'from strix.interface.main import main; main()' --version
```

Use Python 3.12+ e o lockfile do upstream; o ambiente Python fica dentro de
`.tools/security/strix/.venv`. O comando Python acima também evita problemas do
launcher executável do uv no Windows. Não execute instaladores remotos por pipe
sem revisão. Nesta preparação, o CLI instalado é o Strix 1.7.1.

### Docker no Windows

O Strix open source requer o Docker Engine funcionando com contêineres Linux.
O Docker Desktop instalado não basta. Se aparecer **Virtualization support not
detected**, confira **Gerenciador de Tarefas → Desempenho → CPU**. Quando a
virtualização estiver desabilitada, ative **Intel VT-x/VMX** ou **AMD-V/SVM**
na BIOS/UEFI, salve e reinicie. O nome varia por fabricante. Depois confira:

```powershell
wsl --status
wsl --version
docker version
docker info --format '{{.OSType}}'
```

É necessário que a seção **Server** responda e que o tipo seja `linux`. Se a
BIOS já indicar virtualização habilitada e o erro continuar, verifique os
recursos **Subsistema do Windows para Linux** e **Plataforma de Máquina
Virtual**, além do hypervisor, seguindo a
[documentação oficial do Docker](https://docs.docker.com/desktop/setup/install/windows-install/).
Não altere opções de BIOS sem relação com virtualização. A primeira varredura
também baixa a imagem sandbox do Strix e pode consumir bastante disco e rede.

### Modelo local, conforme a preferência do projeto nesta rodada

Não há modelo configurado automaticamente. Use um servidor local compatível,
como Ollama ou LM Studio, com um modelo capaz de seguir instruções longas e
chamar ferramentas. Instalar apenas o aplicativo não baixa nem inicia um modelo.
Confirme os modelos carregados e teste chamadas de ferramenta antes do pentest.
Tamanho de contexto, RAM e VRAM podem limitar bastante a avaliação; registre
essas limitações, sem trocar silenciosamente para um provedor remoto.

Exemplo para um endpoint **OpenAI compatível local** em `127.0.0.1:1234/v1`:

```powershell
# Use o ID exato mostrado pelo seu servidor local, sem prefixo de provedor.
$localModelId = Read-Host 'ID do modelo local carregado'
$env:STRIX_LLM = "openai/$localModelId"
$env:LLM_API_BASE = 'http://127.0.0.1:1234/v1'
$env:LLM_API_KEY = 'local-only' # Marcador sem segredo para endpoint local sem autenticação.
$env:STRIX_API_TYPE = 'chat_completions'
$env:STRIX_REASONING_EFFORT = 'none'
$env:STRIX_DEDUPE_MODEL = $env:STRIX_LLM
$env:DEDUPE_LLM_API_BASE = $env:LLM_API_BASE
$env:DEDUPE_LLM_API_KEY = $env:LLM_API_KEY
$env:STRIX_LLM_INPUT_COST_PER_MTOK = '0'
$env:STRIX_LLM_OUTPUT_COST_PER_MTOK = '0'
$env:STRIX_TELEMETRY = '0'
```

O endpoint e o ID precisam corresponder à configuração real do servidor de IA;
Ollama tem porta e roteamento próprios. Não exponha o servidor de IA na rede
pública para resolver conectividade. Com o CLI rodando no Windows, o endpoint
acima também roda no Windows; se mover o CLI para WSL/contêiner, `127.0.0.1`
passa a se referir àquele ambiente e a conectividade deve ser reavaliada.
Modelos locais não geram cobrança de API, mas consomem recursos do PC. Docker
isola ferramentas; usar uma API remota enviaria contexto ao provedor de IA.

## 4. Preparar e revisar o alvo descartável

```powershell
node scripts/prepare-security-target.cjs
```

O script exige Gitleaks aprovado, seleciona fontes atuais por uma lista restrita
de caminhos e gera uma pasta nova em `.tools/security/targets/`. Ele não copia
`.git`, `.env`, dados, logs, configurações privadas, dependências, builds ou
pastas duplicadas. Links simbólicos são recusados. `SECURITY-TARGET.json` registra
o commit de origem e o SHA-256 de cada arquivo, incluindo alterações locais ainda
sem commit. Revise a lista e o conteúdo: nenhum detector garante que todo segredo
possível será reconhecido. A seleção cobre o cliente, a API e este laboratório;
scripts de implantação/migração ficam fora desta primeira rodada.

Nunca use `strix -t .` na raiz original nem forneça a URL do chat real. O Strix
pode modificar arquivos no alvo. Use apenas a cópia descartável e as instruções
em [strix-instructions.md](security/strix-instructions.md).

Para experimentar a API manualmente, sem Docker ou modelo de IA:

```powershell
npm --prefix server run security:lab
```

A API escuta em `http://127.0.0.1:4311`, usa SQLite em memória e grava somente
credenciais fictícias num arquivo ignorado em `security-reports/lab-*/`.
Não imprime senhas, não carrega `.env`, não se conecta ao Supabase e simula
LiveKit. Encerre com Ctrl+C; o banco é descartado. O arquivo fictício permanece
para inspeção e deve ser mantido fora do Git. Portas em uso causam falha, sem
encerrar outro serviço. `PG_SECURITY_LAB_PORT` permite escolher outra porta.

## 5. Executar após Docker e modelo local estarem prontos

No PowerShell, a partir da raiz original e com as variáveis locais acima:

```powershell
$securityRoot = (Get-Location).Path
$strixPython = Join-Path $securityRoot '.tools/security/strix/.venv/Scripts/python.exe'
$securityTarget = Read-Host 'Caminho completo do alvo descartável revisado'
$strixInstructions = Join-Path $securityRoot 'docs/security/strix-instructions.md'
$runDirectory = Join-Path $securityRoot ('security-reports/strix-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $runDirectory | Out-Null
$localConfig = Join-Path $runDirectory 'cli-config.json'
[IO.File]::WriteAllText($localConfig, '{}')
Push-Location $runDirectory
try {
  & $strixPython -c 'from strix.interface.main import main; main()' -n `
    --target $securityTarget --scope-mode full --scan-mode quick `
    --max-turns 40 --max-budget 1 --config $localConfig `
    --instruction-file $strixInstructions
  $scanExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
Write-Output "Código de saída do Strix: $scanExitCode"
```

Use sempre `-n` na execução por agente. O limite de turnos é **por agente**;
o orçamento de US$ 1 é um teto de custo estimado, não de tempo, e não limita uma
inferência local configurada com custo zero. Interrompa uma execução sem progresso
e registre a cobertura incompleta. O modo `quick` é uma primeira rodada.

Os resultados ficam em `security-reports/strix-*/strix_runs/<execução>/`:
`penetration_test_report.md`, `vulnerabilities.json`, `findings.sarif` e
`run.json`. Código de saída `1` significa erro; `2`, achados; `0` significa
ausência de achados validados na parte analisada. Confira também status, turnos,
custo e limitações no relatório: o código `0` sozinho não prova conclusão.

## 6. Validar, corrigir e repetir

Reproduza cada achado com contas fictícias; registre arquivo/linha,
pré-condições, passos, resultado e impacto. Separe hipóteses de falhas
confirmadas. Faça correções pequenas e acrescente regressões relevantes.
Execute novamente os testes e o caso de exploração na cópia atualizada.

Esta primeira rodada não valida PostgreSQL/RLS reais, Supabase Auth real,
TLS/proxy/firewall de implantação ou transporte LiveKit entre dispositivos.
Os testes existentes de Auth usam um provedor simulado. Para ampliar a cobertura,
prepare serviços dedicados e dados sintéticos; não reutilize o banco da comunidade.
Não publique relatórios completos automaticamente nem coloque chaves de IA no CI.
