# SESSION — TravelAgent OS

> **Ao iniciar qualquer sessão: leia este arquivo antes de qualquer coisa.**  
> **Ao encerrar qualquer sessão: atualize este arquivo com ID da sessão, data, status e o que foi feito.**  
> **O transcript completo da última sessão está no caminho indicado em "Transcript" — consulte para detalhes de código/decisões.**

---

## Última sessão

**ID:** `(ver arquivo .jsonl mais recente em C:\Users\richa\.claude\projects\c--Users-richa-OneDrive-Documentos-Site-agencia\)`  
**Data:** 2026-04-15  
**Status:** Sprint 3 — Fase 2 concluída

### O que foi feito

- **Fase 2 — Pagamentos (3 fluxos) implementada:**
  - Migration `migrate_sprint3_fase2.sql` aplicada no MySQL do VPS
  - Novas tabelas: `pagamentos`, `pagamento_parcelas`
  - Backend v3.2.0-fase2: 3 novos endpoints
    - `GET /api/vendas/:id/pagamentos` — lista com filtro por tipo
    - `POST /api/vendas/:id/pagamentos/sync` — salva/substitui pagamentos de um tipo (idempotente)
    - `PATCH /api/vendas/:id/pagamentos/:pagId/parcelas/:parcId` — atualiza parcela individual (marcar pago, datas)
  - Status do pagamento calculado automaticamente (`pendente` → `parcial` → `pago`) com base nas parcelas
- **Frontend — 3 telas reescritas e conectadas à API:**
  - `sale-finalize.html` (Cliente ↔ Agência):
    - Títulos com parcelas individuais (vencimento, multa, conta, status pago)
    - Autocomplete de pagante via `/api/clientes`
    - Summário dinâmico (total venda, custo, títulos, parcelas pagas, restante)
    - Carrega venda + pagamentos existentes no load
    - Salvar via `POST /api/vendas/:id/pagamentos/sync tipo=cliente_agencia`
  - `sale-supplier-customer-payment.html` (Cliente ↔ Fornecedor):
    - Produtos carregados da venda real (`venda_itens`)
    - Pagamentos por produto com autocomplete de pagante
    - Parcelas auto-geradas a partir do 1º vencimento + n_parcelas
    - Salvar via `POST /api/vendas/:id/pagamentos/sync tipo=cliente_fornecedor`
  - `sale-supplier-agency-payment.html` (Fornecedor ↔ Agência):
    - Produtos com custo real
    - Campo de status por entrada (Pendente/Pago)
    - Salvar via `POST /api/vendas/:id/pagamentos/sync tipo=fornecedor_agencia`
  - **Todas as 3 páginas** usam `?id=` (não mais `?n=`), carregam dados reais da API, param nos links de navegação entre fluxos
- Deploy front + back concluído — API v3.2.0-fase2 online
- Commit + push para GitHub

---

## Fase atual do projeto

**Sprint:** Sprint 3 — Módulo de Vendas Robusto  
**Próxima fase a executar:** **Fase 3 — Comissões 2 níveis**

### Decisões tomadas para o módulo de vendas

1. **Cotação e venda na mesma tabela** `vendas`, distinguidas por `status`. Pode criar venda direta (pular cotação).
2. **Numeração sequencial por data de abertura** — venda do dia 1 sempre < venda do dia 5. Formato `YYYYMMDD-0001`.
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
12. **Pagamentos** — sincronização idempotente por tipo: `sync` substitui todos os pagamentos do tipo informado para a venda

### Páginas prontas e conectadas à API

| Página | Status | API conectada |
|--------|--------|---------------|
| `index.html` | ✅ pronto | `POST /api/auth/login` retorna loja+cargo |
| `dashboard.html` | ✅ pronto | `GET /api/dashboard`, `GET /api/reservas` (legado, escopado por loja) |
| `clientes.html` | ⚠️ precisa update UI | `/api/clientes` aceita PF/PJ — form ainda só mostra PF |
| `reservas.html` | ✅ pronto | `GET /api/reservas` (legado) |
| `sale-form.html` | ✅ pronto | `POST/GET/PUT /api/vendas`, autocomplete clientes |
| `sale-finalize.html` | ✅ pronto | `GET+POST /api/vendas/:id/pagamentos` (tipo=cliente_agencia) |
| `sale-supplier-customer-payment.html` | ✅ pronto | `GET+POST /api/vendas/:id/pagamentos` (tipo=cliente_fornecedor) |
| `sale-supplier-agency-payment.html` | ✅ pronto | `GET+POST /api/vendas/:id/pagamentos` (tipo=fornecedor_agencia) |
| `financeiro.html` | ❌ não criado | aguarda Fase 6 |

---

## Plano do módulo de vendas (10 fases)

| # | Fase | Status | Entregas |
|---|------|--------|----------|
| 0 | Fundação | ✅ concluída | lojas, moedas, PF/PJ, cargos, contexto |
| 1 | Schema Venda + itens + pax + sale-form | ✅ concluída | vendas, venda_itens, venda_pax, pax_itens + UI conectada |
| 2 | Pagamentos (3 fluxos) | ✅ concluída | pagamentos, parcelas, 3 telas conectadas |
| 3 | Comissões 2 níveis | ⏭️ próxima | fornecedor_comissoes + agente_comissoes_config |
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
| `server.js` | `/docker/travelos/api/server.js` no VPS | Backend da API v3.2.0-fase2 |
| `docker-compose.yml` | `/docker/travelos/docker-compose.yml` no VPS | Stack Docker |
| `migrate_sprint3_fase0.sql` | raiz do projeto local | Migration aplicada |
| `migrate_sprint3_fase1.sql` | raiz do projeto local | Migration aplicada |
| `migrate_sprint3_fase2.sql` | raiz do projeto local | Migration aplicada |

## Credenciais / Acesso

- VPS: `31.97.250.95` root, senha em `~/.claude/.../memory/cloud.md`
- URL: `https://app.srv1589437.hstgr.cloud`
- Login: `admin@agencia.com / admin123` (role=admin, cargo=diretor, loja_id=1)
