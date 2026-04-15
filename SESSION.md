# SESSION — TravelAgent OS

> **Ao iniciar qualquer sessão: leia este arquivo antes de qualquer coisa.**  
> **Ao encerrar qualquer sessão: atualize este arquivo com o que foi feito.**

---

## Última sessão

**Data:** 2026-04-15  
**Status:** Sprint 3 — Fase 1 concluída

### O que foi feito

- **Fase 1 — Schema de Venda implementada:**
  - Migration `migrate_sprint3_fase1.sql` aplicada no MySQL do VPS
  - Novas tabelas: `vendas`, `venda_itens`, `venda_pax`, `pax_itens`, `vendas_seq`
  - Numeração sequencial por loja×dia: `YYYYMMDD-0001` (atômico via INSERT ON DUPLICATE KEY)
  - Tipos INT (não UNSIGNED) para compatibilidade com tabelas existentes
- **Backend (server.js v3.1-fase1):**
  - `GET /api/vendas` — lista com filtros (status, agente, cliente, q) escopada por loja
  - `GET /api/vendas/:id` — detalhe com itens, pax, pax_itens e audit_log
  - `POST /api/vendas` — cria venda com itens e pax aninhados (transação atômica)
  - `PUT /api/vendas/:id` — atualiza cabeçalho (cliente, moeda, observações)
  - `PATCH /api/vendas/:id/status` — muda status, grava data_fechamento ao confirmar/concluir
  - `POST /api/vendas/:id/itens` — adiciona item, recalcula totais
  - `PUT /api/vendas/:id/itens/:itemId` — atualiza item, recalcula totais
  - `DELETE /api/vendas/:id/itens/:itemId` — remove item, recalcula totais
  - `POST /api/vendas/:id/pax` — adiciona passageiro
  - `PUT /api/vendas/:id/pax/:paxId` — atualiza passageiro
  - `DELETE /api/vendas/:id/pax/:paxId` — remove passageiro
  - `POST /api/vendas/:id/pax-item` — vincula pax a item
  - `recalcVendaTotais()` helper: soma `total_custo_brl` e `total_venda_brl` dos itens
- **Frontend (`sale-form.html`):**
  - URL param: `?id=123` (ID numérico do banco, antes era `?n=`)
  - Cliente autocomplete: busca live `/api/clientes?q=...` com dropdown
  - Salvar: `POST /api/vendas` ou `PUT /api/vendas/:id` dependendo se é nova/existente
  - Carregar: `GET /api/vendas/:id` ao abrir com `?id=X`, preenche form
  - Badge de status na topbar (COTAÇÃO / CONFIRMADA / etc.)
  - Moedas populadas do contexto da API (não mais hardcoded)
  - `goPayment()` agora usa `?id=` nos links de pagamento
  - `mudarStatus()` — função disponível para chamada futura de botões de status
- Testes end-to-end passados: criação, numeração seq, detalhe, status change, add/delete item, add pax, recálculo de totais
- Deploy front + back concluído

---

## Fase atual do projeto

**Sprint:** Sprint 3 — Módulo de Vendas Robusto  
**Próxima fase a executar:** **Fase 2 — Pagamentos (3 fluxos)**

### Decisões tomadas para o módulo de vendas

1. **Cotação e venda na mesma tabela** `vendas`, distinguidas por `status`. Pode criar venda direta (pular cotação).
2. **Numeração sequencial por data de abertura** — venda do dia 1 sempre < venda do dia 5. Formato a definir na Fase 1.
3. **Moeda base padrão BRL**, alterável por venda (USD/EUR/etc). Cada item pode ter moeda própria com taxa de câmbio travada.
4. **Pagante = cliente** (mesma tabela, flag `eh_pagante`). Pode ser PF ou PJ, autocomplete na busca.
5. **Multi-loja desde o zero** — todo registro tem `loja_id`, injetado automaticamente pelo middleware do usuário logado.
6. **`loja_id` e `agente_id`** NUNCA são preenchidos manualmente no form — vêm do `req.user` do JWT.
7. **Comissão em 2 níveis:**
   - Fornecedor → Agência: base por `fornecedor+tipo_produto` editável manualmente (override por item)
   - Agência → Agente: % sobre a comissão da venda, varia por `origem_lead` (agencia/agente) e `cargo`
8. **Cancelamento por STATUS** (nunca apagar registro)
9. **Anexos no VPS** (`/var/www/travelos/uploads/`) — implementar na Fase 5
10. **Webhooks para n8n** preparados desde a Fase 1 (eventos SSE já existem)
11. **Auditoria obrigatória** em toda mutação de venda — `auditoria` já pronta, incluindo hora de insert/update/status

### Páginas prontas e conectadas à API

| Página | Status | API conectada |
|--------|--------|---------------|
| `index.html` | ✅ pronto | `POST /api/auth/login` retorna loja+cargo |
| `dashboard.html` | ✅ pronto | `GET /api/dashboard`, `GET /api/reservas` (legado, escopado por loja) |
| `clientes.html` | ⚠️ precisa update UI | `/api/clientes` aceita PF/PJ — form ainda só mostra PF |
| `reservas.html` | ✅ pronto | `GET /api/reservas` (legado) |
| `sale-form.html` | ✅ pronto | `POST/GET/PUT /api/vendas`, autocomplete clientes |
| `sale-*-payment.html` (3x) | ⏳ aguarda Fase 2 | — |
| `financeiro.html` | ❌ não criado | aguarda Fase 6 |

---

## Plano do módulo de vendas (10 fases)

| # | Fase | Status | Entregas |
|---|------|--------|----------|
| 0 | Fundação | ✅ concluída | lojas, moedas, PF/PJ, cargos, contexto |
| 1 | Schema Venda + itens + pax + sale-form | ✅ concluída | vendas, venda_itens, venda_pax, pax_itens + UI conectada |
| 2 | Pagamentos (3 fluxos) | ⏭️ próxima | pagamentos, parcelas, 3 telas conectadas |
| 3 | Comissões 2 níveis | pendente | fornecedor_comissoes + agente_comissoes_config |
| 4 | Cotação → conversão | pendente | validade, envio, métrica conversão |
| 5 | Documentos/anexos | pendente | upload VPS + geração PDF |
| 6 | Financeiro consolidado | pendente | contas a pagar/receber + `financeiro.html` |
| 7 | Workflow + alertas | pendente | aprovações, alertas, cron via n8n |
| 8 | BI gerencial | pendente | rankings, conversão, LTV |
| 9 | Automações n8n | pendente | webhooks plugados |
| 10 | GDS (opcional) | pendente | integrações externas |

---

## Arquivos críticos

| Arquivo | Localização | Função |
|---------|-------------|--------|
| `deploy.py` | `c:/tmp/deploy.py` | Script SFTP deploy frontend |
| `server.js` | `/docker/travelos/api/server.js` no VPS (backup: `.bak-fase0`) | Backend da API |
| `docker-compose.yml` | `/docker/travelos/docker-compose.yml` no VPS | Stack Docker |
| `migrate_sprint3_fase0.sql` | raiz do projeto local | Migration aplicada |
| `migrate_sprint3_fase1.sql` | raiz do projeto local | Migration aplicada |

## Credenciais / Acesso

- VPS: `31.97.250.95` root, senha em `~/.claude/.../memory/cloud.md`
- URL: `https://app.srv1589437.hstgr.cloud`
- Login: `admin@agencia.com / admin123` (role=admin, cargo=diretor, loja_id=1)
