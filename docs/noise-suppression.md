# Redução de ruído nas chamadas

## Escolha para o Progresso Gang

O cliente é um app web React/Vite com LiveKit. A melhor integração entre as três opções propostas é **RNNoise executado no navegador**, por WebAssembly e AudioWorklet. A escolha considera distribuição, controle dentro do chat, plataformas e manutenção; não representa um benchmark de qualidade sonora entre três algoritmos diferentes.

| Opção | O que oferece | Adequação ao app |
| --- | --- | --- |
| [RNNoise](https://github.com/xiph/rnnoise) | Biblioteca de redução de ruído, BSD de três cláusulas. | Pode processar o microfone dentro do navegador, sem instalação pelo usuário. Escolhida. |
| [NoiseTorch-ng](https://github.com/noisetorch/NoiseTorch) | Aplicativo GPLv3 para Linux com PulseAudio/PipeWire; usa RNNoise e cria um microfone virtual. | Útil para filtrar áudio no sistema Linux, mas exige instalação externa e não atende diretamente Windows e celulares. |
| [Noise Suppression for Voice](https://github.com/werman/noise-suppression-for-voice) | Plugin GPLv3 baseado em RNNoise, disponível em formatos como VST; no Windows pode ser hospedado pelo Equalizer APO. | Exige um host e configuração fora do navegador. Não fornece uma integração web pronta. |

As três opções compartilham RNNoise como base. Os aplicativos externos acrescentam controles, incluindo detecção de voz; esses ajustes e os modelos usados podem mudar o resultado. Não é possível afirmar que uma delas terá melhor som em todo microfone sem uma comparação nas mesmas condições. O app combina a redução contínua com atenuação suave guiada pela probabilidade de fala do RNNoise.

## Como funcionava

O botão anterior gravava `pg-noise-suppression` no armazenamento do navegador e solicitava `noiseSuppression` nas restrições do microfone. O resultado dependia do navegador. O app mantinha cancelamento de eco e controle automático de ganho e consultava `getSettings()` para saber se o navegador tinha aplicado a solicitação.

Os efeitos de voz já utilizavam `LocalAudioTrack.setProcessor()`. Como o LiveKit aceita um processador por faixa, colocar um segundo processador independente substituiria os efeitos existentes.

## Como funciona agora

1. A captura solicita `noiseSuppression: false`, mantendo cancelamento de eco e ganho automático. Isso evita combinar dois supressores.
2. A preferência anterior é preservada, incluindo o padrão ligado quando não existe uma escolha salva. Ela vale para este navegador, como antes.
3. Com redução ligada, o app carrega seu próprio WASM e AudioWorklet e processa somente o microfone local. O filtro não utiliza um serviço externo nem envia áudio para análise.
4. O processador único organiza o caminho **microfone → RNNoise → atenuação quando não há fala → efeito de voz → LiveKit**. Voz natural dispensa a etapa de efeito.
5. RNNoise trabalha em mono a 48 kHz. Se o contexto do LiveKit usar outra taxa, o app cria um contexto de 48 kHz; o Web Audio converte a captura. Ao encerrar, apenas os recursos criados pelo processador são descartados.
6. Desligar a redução com voz natural remove o processador. Com outro efeito selecionado, mantém apenas esse efeito. Alterar a opção não liga um microfone silenciado.
7. O botão continua apenas com ícone. Nome, estado e erros ficam no tooltip e na descrição para leitor de tela. O usuário pode desligar e ligar novamente para tentar outra vez.

O suporte exige contexto seguro, Web Audio, AudioWorklet e WebAssembly. A compatibilidade real com navegadores e aparelhos deve ser confirmada nos dispositivos usados pela gang. Sem suporte, a chamada continua disponível e o botão informa a indisponibilidade. O app não ativa silenciosamente outro supressor.

## Dependências e distribuição

- Adaptador: [`@sapphi-red/web-noise-suppressor` 0.4.1](https://github.com/sapphi-red/web-noise-suppressor), MIT, fixado no lockfile.
- O adaptador inclui a compilação [`@shiguredo/rnnoise-wasm` 2022.2.0](https://github.com/shiguredo/rnnoise-wasm/tree/2022.2.0), Apache-2.0, e o RNNoise sob BSD.
- O Vite emite os arquivos junto com o cliente. O navegador seleciona uma das versões WASM, com ou sem SIMD. Nenhum CDN é necessário.
- O WASM tem aproximadamente 153–157 KB; o worklet próprio com detecção de fala tem cerca de 3 KB, antes de compressão. A taxa de download e o uso de CPU dependem do dispositivo; ainda precisam ser medidos no uso real.
- Os avisos distribuídos estão em `client/public/noise-suppression-licenses.txt`, copiados pelo Vite para o build. As licenças permissivas exigem a preservação desses avisos.

## Ajuste para teclado, mouse e impactos

O adaptador anterior descartava a probabilidade de fala calculada pelo RNNoise. O worklet próprio usa a API nativa do mesmo WASM e do mesmo modelo para aproveitar esse resultado, mantendo uma única execução da rede por quadro de 10 ms. Não há outra dependência nem uma segunda passagem pelo supressor.

Os parâmetros estão centralizados em `SPEECH_FILTER`, em `client/src/rnnoise-core.ts`:

| Parâmetro | Valor inicial | Efeito |
| --- | --- | --- |
| Probabilidade para abrir | 0,75 | Exige mais confiança para liberar a voz a partir do silêncio. |
| Probabilidade para manter aberto | 0,50 | Histerese para tolerar variação da confiança durante a fala. |
| Espera antes de fechar | 240 ms | Dá margem aos finais de palavras. |
| Áudio antecipado em buffer | 20 ms | Permite abrir quando o início da palavra ainda está no buffer. Acrescenta cerca de 20 ms ao processamento anterior. |
| Atenuação sem fala | 18 dB | Reduz o áudio residual; não o zera abruptamente. |
| Rampa de abertura/fechamento | 2 ms / 100 ms | Suaviza mudanças de volume. |

O objetivo principal é diminuir cliques e impactos nos períodos classificados como sem fala. Durante a fala e a espera de fechamento, a redução continua a cargo do RNNoise; cliques simultâneos podem passar. Voz muito baixa, sussurros ou fala mal reconhecida pelo modelo também podem ser atenuados. Essas margens reduzem o risco de cortes, mas precisam de escuta com os microfones reais.

O host WASM suporta especificamente a interface do binário fixado em 2022.2.0. Ao atualizar a dependência, conferir importações/exportações e executar os testes dos binários regular e SIMD. A inicialização só informa filtro ativo depois de o worklet confirmar que carregou; destruição e falhas liberam o estado nativo.

## Verificação local

Na pasta `client`, execute `npm run build`, `npm run lint` e `npm test`. Os testes de unidade verificam a preferência existente, a composição com efeitos, troca de entrada, taxa de 44,1 kHz, limpeza de recursos e falhas.

Para teste no navegador, inicie `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort` e abra `http://127.0.0.1:5174/tests/media-browser.html`. Essa fixture usa som sintético e respostas de API simuladas; não pede o microfone e não conecta ao servidor de chamadas. Ela não faz parte do build de produção.

O botão **Verificar 10 combinações** verifica saída finita e não silenciosa, troca de entrada e desativação para os cinco tipos de voz em 48 kHz e 44,1 kHz. Os controles da fixture exercitam o provider React real em StrictMode. A URL com `?fail=1` simula falha HTTP no primeiro download do modelo; desligue o bloqueio e alterne o filtro para testar a recuperação.

O botão **Comparar cliques simulados** gera impulsos curtos com decaimento e compara o RNNoise anterior com a atenuação de fala, alinhando o buffer de 20 ms. Essa medição usa um sinal determinístico sem voz e não prevê a redução em todos os teclados ou durante uma conversa. Os testes de unidade também verificam início e fim de fala simulados, histerese, continuidade entre blocos e o WASM real nas versões regular e SIMD.

No build de produção testado no Edge headless, esse sinal de cliques sem voz ficou 18,0 dB abaixo do RNNoise anterior. As dez combinações de voz/taxa de áudio mantiveram saída válida, troca de entrada e desligamento. A clareza da fala real e a sensação de atraso continuam pendentes de avaliação pelos participantes.

Verificação executada no Edge headless em 16/11/2026: dez combinações aprovadas; preferência persistida; ativação com microfone mudo sem desmutar; efeito Bebê junto com RNNoise; falha de download e recuperação; controle por Enter e Espaço; nenhuma requisição WASM com a opção desligada; captura preservada sem suporte ao filtro; controles sem transbordamento horizontal em 390 e 320 px. As restrições de captura são simuladas porque uma faixa gerada por Web Audio não aceita as mesmas restrições de um microfone físico.

Esses testes não medem inteligibilidade, CPU, bateria, latência de uma chamada ou qualidade percebida. Também não substituem uma chamada entre aparelhos reais.

## Roteiro para decidir a adoção após escutar

1. Abra uma chamada com outra pessoa, ambos de fone. Use voz natural, o mesmo microfone, distância e volume em cada comparação.
2. Fale a mesma frase por cerca de 20 segundos com a redução desligada e depois ligada. Inclua palavras baixas e finais de frases. Peça ao ouvinte para observar se alguma sílaba desaparece ou a voz fica abafada.
3. Repita com ventilador, digitação e cliques; compare tanto os intervalos de silêncio quanto o ruído enquanto você fala. Reduzir um ruído não garante eliminá-lo.
4. Teste ligar/desligar com o microfone mudo, voltar a falar, trocar o dispositivo e sair/entrar no canal. Confirme que nenhuma mudança liga o microfone sozinha.
5. Repita com os efeitos de voz, no celular e no computador menos potente usado pelo grupo. Observe travamentos, aquecimento, bateria e CPU com a opção ligada e desligada durante alguns minutos.
6. Confirme que áudio compartilhado, música e sons da chamada continuam sem passar pelo filtro do microfone.

Aprovar quando a voz continuar compreensível, o ruído diminuir de forma útil, não houver cortes ou atraso incômodo e o custo no aparelho mais fraco for aceitável. Se o resultado não compensar para alguém, essa pessoa pode manter a opção desligada. Guarde resultados e ajustes neste documento, sem registrar áudio ou conteúdo de conversas sem autorização dos participantes.
