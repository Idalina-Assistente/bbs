# BBS + Gemini Live

Uma BBS (bulletin board system) com visual retro em ecrã ANSI azul, feita em Node.js, pronta para o Render.
Além de navegar e escrever mensagens no browser, podes **falar com o Sysop por voz** (Gemini Live): ele lista áreas, lê mensagens, pesquisa e publica por ti, e as mensagens aparecem em tempo real para todos.

## Funcionalidades
- Áreas de mensagens, leitura, respostas, pesquisa e atualização em tempo real (WebSocket)
- Registo/login (palavras-passe com scrypt, sessões assinadas com HMAC)
- O primeiro utilizador registado (ou o `SYSOP_HANDLE`) é Sysop e pode apagar mensagens
- Voz via Gemini Live: o browser fala com o teu servidor, que fala com o Gemini, por isso **a chave nunca vai para o browser**
- Ferramentas do Sysop de voz: `list_boards`, `read_board`, `read_message`, `post_message`, `search_messages`
- Limites anti-abuso: voz só para utilizadores com login, máx. 10 min por sessão, máx. 3 sessões simultâneas, rate limit nos endpoints

## Correr localmente
```bash
npm install
cp .env.example .env      # preenche GEMINI_API_KEY e SESSION_SECRET
node --env-file=.env server.js
```
Abre http://localhost:3000. O microfone funciona em `localhost` e em HTTPS.

## Publicar no GitHub
```bash
git init && git add . && git commit -m "BBS inicial"
git branch -M main
git remote add origin https://github.com/O_TEU_USER/bbs-gemini.git
git push -u origin main
```

## Deploy no Render
1. Em https://render.com: **New → Blueprint**, escolhe o repositório (lê o `render.yaml`). Em alternativa: **New → Web Service**, Build `npm install`, Start `npm start`.
2. Define a variável **`GEMINI_API_KEY`** (chave em https://aistudio.google.com/apikey). `SESSION_SECRET` é gerada automaticamente.
3. Depois do deploy, abre o URL `https://<nome>.onrender.com`, regista-te (serás Sysop) e carrega em **V** para ligar a voz.

### Variáveis de ambiente
| Variável | Por omissão | Descrição |
|---|---|---|
| `GEMINI_API_KEY` | (obrigatória para voz) | Chave da API Gemini |
| `SESSION_SECRET` | aleatória a cada arranque | Assina as sessões |
| `BBS_NAME` | Porto Seguro BBS | Nome da BBS |
| `SYSOP_HANDLE` | sysop | Nome que recebe sempre o papel de Sysop |
| `GEMINI_MODEL` | gemini-3.1-flash-live-preview | Modelo Live (os nomes mudam; vê a documentação do Live API) |
| `GEMINI_VOICE` | Puck | Voz (ex.: Puck, Kore, Charon, Aoede) |
| `LIVE_MAX_MINUTES` / `LIVE_MAX_SESSIONS` | 10 / 3 | Limites de voz |
| `DATA_DIR` | ./data | Onde guardar `bbs.json` |

## Limitações a saber
- **Plano free do Render**: o disco é efémero (as mensagens perdem-se em cada deploy/reinício) e o serviço adormece após inatividade. Para persistir, usa um plano pago com disco (bloco comentado no `render.yaml`) ou troca `store.js` por Postgres.
- Usa **auscultadores**: sem eles, o microfone apanha a voz do Sysop e gera eco.
- Se a voz falhar com erro de modelo, muda `GEMINI_MODEL` para o modelo Live em vigor.

## Estrutura
```
server.js   Express + WebSockets (/events, /live), auth, API REST
live.js     Proxy para o Gemini Live + ferramentas do Sysop
store.js    Persistência em ficheiro JSON
public/     Interface (index.html, sem build)
render.yaml Blueprint do Render
```
