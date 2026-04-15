# TravelAgent OS — CLAUDE.md

**Idioma: SEMPRE responda em Português do Brasil (pt-BR).**  
**Ao iniciar sessão: leia SESSION.md imediatamente para saber onde o projeto parou.**  
**Ao encerrar sessão: atualize SESSION.md com o ID da sessão atual, data, status e resumo do que foi feito.**  
**ID da sessão atual está nos arquivos `.jsonl` em `C:\Users\richa\.claude\projects\c--Users-richa-OneDrive-Documentos-Site-agencia\` — pegar o mais recente via `ls -lt`.**

## Stack

Frontend: HTML5 + Bootstrap 5.3.3 + Bootstrap Icons 1.11 + Inter + Vanilla JS ES6+. Sem React, Vue, TypeScript, jQuery, Tailwind. Apenas CDN — sem npm/build.  
Backend: Node.js/Express + MySQL 8.0, JWT (8h), SSE em `/api/eventos`. Código em `/docker/travelos/api/server.js` no VPS.  
Infra: VPS Ubuntu 24.04, Docker Compose (nginx + API + MySQL + Traefik HTTPS). URL: `https://app.srv1589437.hstgr.cloud`

## Deploy — executar sempre ao final de toda alteração

Front + back em paralelo. Front copia estáticos para `/var/www/travelos/` (bind-mount do nginx Docker). Back faz rebuild do container da API.

```bash
# Frontend
py -3 c:/tmp/deploy.py

# Backend (só quando server.js mudar)
py -3 -c "import paramiko; ssh=paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy()); ssh.connect('31.97.250.95',username='root',password='#R219407##159159re',timeout=15); _,o,_=ssh.exec_command('cd /docker/travelos && docker compose up -d --build travelos-api 2>&1'); print(o.read().decode()); ssh.close()"
```

`deploy.py` ignora: `.git`, `.claude`, `CLAUDE.md`, `SPEC.md`, `node_modules`, `.next`, `package*.json`, `migrate_sprint2.sql`.

## API

Base: `/api` (Traefik roteia para container travelos-api:3000). Auth: `Authorization: Bearer <token>`.  
Login: `POST /api/auth/login {email, senha}` → `{ok, token, user}`. Credenciais padrão: `admin@agencia.com / admin123`.  
Endpoints: `GET /api/dashboard` · `GET|POST|PUT|PATCH /api/reservas` · `GET|POST|PUT|DELETE /api/clientes` · `GET|POST|PUT|DELETE /api/fornecedores` · `GET|POST /api/financeiro` · `GET /api/comissoes` · `GET /api/eventos` (SSE).  
Filtros em reservas: `?status=pendente|confirmada|cancelada&q=texto&page=1&limit=20`.

## Convenções não óbvias

- `Auth.apiFetch(path, opts)` em `assets/js/auth.js`: wrapper de fetch que injeta JWT e redireciona para login em 401. Usar em todos os calls à API.
- `App.init()` obrigatório no topo de toda página interna — faz guard, tema, sidebar e logout.
- Objetos globais JS: `PascalCase`. IDs HTML: `camelCase`. Classes CSS: `kebab-case`.
- Status API → visual: `pendente`=aberta, `confirmada`=fechada, `status_pgto em_aberto|inadimplente`=pendência cliente.
- Tokens de cor e espaçamento sempre via variáveis CSS de `assets/css/style.css` — nunca inline.

## GitHub — executar sempre que houver alteração importante

Após qualquer alteração relevante (nova feature, correção, migration, atualização de SESSION.md), fazer commit e push para o repositório:

```bash
cd "c:/Users/richa/OneDrive/Documentos/Site agencia"
git add -A
git commit -m "descrição do que foi feito"
git push origin main
```

Repositório: `https://github.com/richardlmachado/Travel-Backend`

## Restrições críticas

- Nunca usar React, Vue, Angular, TypeScript, jQuery ou `var`
- Nunca usar `!important` no CSS nem estilos inline no HTML
- Nunca mockar dados — usar `Auth.apiFetch` contra a API real
- Nunca alterar `migrate_sprint2.sql` sem aplicar no container: `docker exec travelos-travelos-db-1 mysql -u travelos -pTravelOS@2025! travelos < arquivo.sql`
- Nunca encerrar uma sessão de alterações sem rodar o deploy acima
- Nunca encerrar uma sessão sem fazer push para o GitHub
