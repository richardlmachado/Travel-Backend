 # TravelAgent OS — Especificação do Sistema

> Documento vivo. Última atualização: 2026-04-15
> Stack: HTML5 · CSS3 · Bootstrap 5 · Vanilla JS · Node.js · MySQL

---

## 1. Visão Geral & Proposta de Valor

### O que é

TravelAgent OS é um backoffice completo para agências de turismo — do cadastro do cliente ao controle de embarque. Centraliza em uma única plataforma o que hoje é fragmentado entre sistemas legados (PaxPro), planilhas e WhatsApp.

### Problema que resolve

| Dor Atual | Solução no TravelOS |
|---|---|
| Check-in controlado em planilha, fácil de esquecer | Lembrete automático 48h antes do embarque |
| Comissionamento calculado manualmente, sujeito a erro | Regra de comissão por agente aplicada automaticamente a cada reserva |
| Não saber o lucro real de uma venda | Custo (fornecedor) e preço de venda separados, markup visível |
| Histórico do cliente espalhado em canais diferentes | Perfil único com todas as reservas e interações |
| Sistema atual confuso e incompleto para o fluxo da agência | Interface construída especificamente para o processo de uma agência de turismo |

### Proposta de Valor

> **Para agências de turismo que operam com agentes, fornecedores e múltiplos produtos, o TravelAgent OS é o único sistema que combina gestão de reservas, controle financeiro real e comissionamento automático — sem complexidade desnecessária.**

### Visão de Produto

O sistema é validado internamente na agência fundadora e depois comercializado como SaaS multi-tenant para outras agências de turismo, com planos escaláveis por porte de operação.

---

## 2. Perfis de Usuário & Permissões

### Perfis

| Perfil | Descrição | Acesso |
|---|---|---|
| **Administrador** | Dono ou gestor da agência | Total — vê tudo, configura regras, aprova comissões |
| **Agente de Viagens** | Vendedor/operador | Cria e edita suas reservas, vê suas comissões, acessa clientes |
| **Financeiro** | Responsável pelo faturamento | Acesso ao módulo financeiro completo, relatórios, sem editar reservas |

### Regras de Acesso por Módulo

| Módulo | Admin | Agente | Financeiro |
|---|---|---|---|
| Dashboard | Total | Próprio (suas reservas/lembretes) | Total |
| Reservas | Total (todas) | Próprias + criar novas | Leitura |
| Financeiro | Total | Não acessa | Total |
| Comissionamento | Total | Vê seus próprios | Total |
| CRM Clientes | Total | Total | Leitura |
| Fornecedores | Total | Leitura | Leitura |
| Configurações | Total | Não acessa | Não acessa |

### Notas
- Agente vê o comissionamento acumulado do próprio mês para acompanhar sua progressão de faixa
- Administrador define as regras de comissionamento (faixas, percentuais, origem do lead)
- Financeiro não cria nem edita reservas — só visualiza e opera o módulo financeiro

---

## 3. Módulos

### 3.1 Dashboard (+ Lembretes de Check-in)

#### Visão Geral
Tela inicial após o login. Exibe o estado operacional da agência em tempo real — sem precisar entrar em nenhum módulo para saber o que está acontecendo.

#### KPIs Principais
- Total de reservas (mês atual)
- Reservas confirmadas / pendentes / canceladas
- Receita confirmada do mês (soma das reservas confirmadas)
- Total de clientes ativos
- Comissões a pagar no mês (visível apenas para Admin/Financeiro)

#### Lembretes de Check-in
- Lista de embarques nas próximas 48 horas
- Cada item exibe: nome do cliente, destino, data/hora de embarque, agente responsável, status do lembrete (enviado / pendente)
- **Disparo automático:** 48 horas antes do horário de embarque cadastrado na reserva
- **Canal:** a definir (WhatsApp via API ou e-mail — configurável por agência)
- O administrador pode disparar o lembrete manualmente a qualquer momento
- Registro de log: data/hora do envio, canal utilizado, status de entrega

#### Últimas Reservas
- Tabela com as 8–10 reservas mais recentes
- Colunas: Código, Cliente, Destino, Embarque, Valor, Status
- Link direto para a reserva completa

#### Atualização em Tempo Real
- Dashboard atualiza automaticamente via SSE (Server-Sent Events) sem precisar recarregar a página
- Indicador visual quando dados são atualizados

### 3.2 Gestão de Reservas

#### Visão Geral
Módulo central do sistema. Cada reserva representa uma venda de produto turístico — desde pacote completo até aluguel de carro avulso.

#### Tipos de Produto Suportados
- Pacote turístico (aéreo + hotel + transfers)
- Aéreo avulso
- Hotel avulso
- Cruzeiro
- Seguro viagem
- Locação de veículo
- Transfer / receptivo
- Outros produtos turísticos (campo livre)

#### Campos da Reserva

| Campo | Tipo | Obrigatório |
|---|---|---|
| Código | Auto-gerado (ex: RES00012345) | — |
| Tipo de produto | Seleção | Sim |
| Cliente | Vínculo com CRM | Sim |
| Fornecedor | Vínculo com cadastro | Sim |
| Agente responsável | Vínculo com usuário | Sim |
| Origem do lead | Agência / Próprio do agente | Sim |
| Destino | Texto | Sim |
| Data de embarque | Data + hora | Sim |
| Data de retorno | Data | Não |
| Custo (valor pago ao fornecedor) | Monetário | Sim |
| Markup (R$ ou %) | Monetário ou percentual | Sim |
| Valor total ao cliente | Calculado automaticamente | — |
| Forma de pagamento | Seleção (cartão/pix/boleto/parcelado) | Não |
| Status | Pendente / Confirmada / Cancelada / Concluída | Sim |
| Observações | Texto livre | Não |
| Arquivos anexos | PDF, imagens | Não |

#### Cálculo Automático
- `Valor total ao cliente = Custo + Markup`
- `Lucro bruto = Valor total − Custo`
- `Comissão do agente = calculada conforme regra do perfil + origem do lead` (ver seção 3.3)

#### Filtros & Busca
- Por status, tipo de produto, agente, fornecedor, período de embarque, período de criação
- Busca por nome do cliente ou código da reserva
- Paginação com 20 reservas por página

#### Ações por Reserva
- Criar, editar, cancelar
- Alterar status individualmente
- Visualizar histórico de alterações (log de auditoria)
- Disparar lembrete de check-in manualmente
- Imprimir / exportar PDF da reserva

#### Listagem
- Tabela com colunas configuráveis
- Indicador visual de embarques próximos (< 48h em amarelo, vencidos em vermelho)

### 3.3 Financeiro (Markup · Faturamento · Comissionamento)

#### Visão Geral
Controle financeiro real da agência — separando custo de fornecedor, preço de venda ao cliente, lucro bruto e comissões devidas. O módulo não emite nota fiscal nesta fase (controle interno apenas).

---

#### 3.3.1 Markup & Custo

Cada reserva registra:
- **Custo:** valor pago à operadora/consolidadora
- **Markup:** acréscimo aplicado (em R$ ou %)
- **Preço de venda:** exibido ao cliente
- **Lucro bruto:** preço de venda − custo

O sistema nunca exibe o custo ao cliente — apenas ao Admin e Financeiro.

---

#### 3.3.2 Faturamento (Controle Interno)

Registro do fluxo de pagamento do cliente por reserva:

| Campo | Descrição |
|---|---|
| Valor total | Preço de venda da reserva |
| Valor recebido | Soma dos pagamentos confirmados |
| Saldo devedor | Total − Recebido |
| Forma de pagamento | Cartão / Pix / Boleto / Parcelado |
| Vencimento | Data de vencimento do saldo |
| Status financeiro | Pago / Parcial / Em aberto / Inadimplente |

Listagem geral com filtro por status financeiro, período e agente.
Destaque visual para reservas com saldo em aberto próximo ao vencimento.

> **Nota:** Emissão de nota fiscal (NFS-e) é funcionalidade prevista para fase posterior.

---

#### 3.3.3 Comissionamento por Agente

##### Regra de Comissão

O sistema calcula automaticamente a comissão de cada agente com base em duas variáveis:

**Variável 1 — Origem do lead:**

| Origem | Percentual |
|---|---|
| Lead da agência (captado pela agência) | Tabela progressiva (abaixo) |
| Lead próprio do agente (trouxe o cliente) | **50% fixo sobre o valor da venda** |

**Variável 2 — Tabela progressiva (para leads da agência):**

| Comissionamento acumulado no mês | Percentual da venda |
|---|---|
| R$ 0 até R$ 10.000 | 20% |
| R$ 10.001 até R$ 12.000 | 21% |
| R$ 12.001 até R$ 14.000 | 22% |
| R$ 14.001 até R$ 16.000 | 23% |
| ... (+1% a cada R$ 2.000) | ... |
| A partir de R$ 30.000 | **30% (teto máximo)** |

O percentual sobe conforme o agente acumula comissão no mês. O teto é 30%.

> **Regra de bracket:** o percentual aplicado a uma venda é determinado pelo valor acumulado **no início da venda** (antes de somá-la). Toda a venda recebe o mesmo percentual — não há divisão proporcional entre faixas.
>
> **Exemplo:** agente tem R$ 9.000 acumulados (faixa 20%). Vende R$ 5.000 → comissão = R$ 1.000 (20%). Após a venda, acumulado vai para R$ 10.000. A próxima venda já entra na faixa de 21%.

> **Cancelamento cross-mês:** se uma reserva confirmada em mês anterior for cancelada no mês atual, a comissão entra como "estornada" e é deduzida do acumulado do **mês atual** do agente. Se o acumulado atual for zero, o saldo fica negativo e é compensado nas próximas comissões do mês.

##### Apuração Mensal
- Comissão calculada sobre o valor total da reserva no momento da confirmação
- Apuração mensal: Admin fecha o período e gera extrato por agente
- Agente visualiza seu próprio extrato (comissões confirmadas + pendentes)
- Admin visualiza extrato consolidado de todos os agentes

##### Campos do Extrato de Comissão
- Reserva (código + destino)
- Data da confirmação
- Valor da venda
- Origem do lead
- % aplicado
- Valor da comissão
- Status (pendente / aprovado / pago)

---

#### 3.3.4 Relatórios Financeiros

- Receita bruta por período
- Lucro bruto por período (receita − custo)
- Comissões pagas por agente/período
- Inadimplência (reservas com saldo em aberto)
- Exportação em PDF e Excel

### 3.4 CRM — Clientes & Fornecedores

#### 3.4.1 Clientes

Cadastro centralizado de todos os clientes da agência.

| Campo | Tipo |
|---|---|
| Nome completo | Texto |
| CPF / Passaporte | Texto |
| Data de nascimento | Data |
| E-mail | Email |
| Telefone / WhatsApp | Telefone |
| Endereço | Texto |
| Observações | Texto livre |

**Perfil do cliente inclui:**
- Dados cadastrais
- Histórico completo de reservas (todas as viagens)
- Total gasto na agência (lifetime value)
- Agente responsável pelo relacionamento
- Documentos anexados (passaporte, RG, etc.)

**Busca:** por nome, CPF, e-mail ou telefone.

---

#### 3.4.2 Fornecedores

Cadastro de operadoras, consolidadoras, hotéis, aéreas e demais parceiros.

| Campo | Tipo |
|---|---|
| Razão social / Nome | Texto |
| CNPJ | Texto |
| Tipo | Operadora / Consolidadora / Hotel / Aérea / Outro |
| Contato comercial | Nome + telefone + e-mail |
| Condições de pagamento | Texto |
| Comissionamento padrão da agência com o fornecedor | % ou R$ |
| Observações | Texto livre |

**Perfil do fornecedor inclui:**
- Dados cadastrais
- Histórico de reservas vinculadas
- Volume total transacionado
- Documentos / contratos anexados

**Busca:** por nome, CNPJ ou tipo.

---

## 4. Regras de Negócio Críticas

1. **Custo nunca visível ao agente** — apenas Admin e Financeiro veem o custo do fornecedor. O agente vê apenas o valor de venda e sua comissão.

2. **Origem do lead define a regra de comissão** — campo obrigatório na criação da reserva. Se "lead próprio do agente", aplica 50% fixo. Se "lead da agência", aplica tabela progressiva mensal.

3. **Tabela progressiva reseta todo mês** — o acumulado de comissionamento para cálculo da faixa é mensal. No dia 1 de cada mês, todos os agentes voltam para a faixa de 20%.

4. **Comissão calculada na confirmação** — a comissão só é gerada quando a reserva muda para status "Confirmada". Reservas pendentes não geram comissão ainda.

5. **Lembrete de check-in é automático** — qualquer reserva com data de embarque cadastrada dispara lembrete 48h antes sem intervenção manual. O sistema só não dispara se o lembrete já foi enviado ou se a reserva foi cancelada.

6. **Markup obrigatório** — toda reserva precisa ter custo e markup registrados. O sistema não permite salvar uma reserva com custo zerado (exceto produtos com custo variável, que devem ser marcados como tal).

7. **Agente só vê suas próprias reservas** — na listagem padrão. Admin vê todas. Financeiro vê todas em modo leitura.

8. **Log de auditoria imutável** — toda alteração em reserva (status, valor, agente) é registrada com usuário, data/hora e valor anterior. Não é possível deletar registros financeiros — apenas cancelar.

9. **Cancelamento não apaga comissão** — se uma reserva confirmada (que já gerou comissão) for cancelada, a comissão gerada entra em status "estornada" e é deduzida do acumulado do agente.

---

## 5. Visão de Produto (Multi-tenant & Monetização)

### Fase 1 — Validação (atual)
- Sistema operado internamente na agência fundadora
- 2 usuários na operação
- Infraestrutura: VPS única, banco de dados compartilhado
- Objetivo: validar fluxos, regras de negócio e usabilidade no mundo real

### Fase 2 — Produto SaaS
Após validação interna, o sistema será comercializado para outras agências de turismo.

**Arquitetura Multi-tenant:**
- Cada agência terá seus dados completamente isolados (schema separado ou tenant_id em todas as tabelas)
- Login próprio por agência (subdomínio ou domínio customizado)
- Configurações independentes: regras de comissão, perfis, integrações

**Modelo de Monetização (proposta inicial):**

| Plano | Público | Preço estimado |
|---|---|---|
| Starter | Agências solo / MEI (até 2 usuários) | A definir |
| Pro | Agências com equipe (até 10 usuários) | A definir |
| Enterprise | Redes e franquias (usuários ilimitados) | A definir |

**Diferencial competitivo para venda:**
- Sistema feito por quem opera agência de turismo (não por dev sem contexto do setor)
- Comissionamento automático — elimina conflito entre dono e agentes
- Markup protegido — cliente nunca vê o custo
- Lembrete de check-in automático — elimina o maior erro operacional da área

---

## 6. Stack Técnica & Infraestrutura

### Frontend
- HTML5 + CSS3 + Bootstrap 5.3
- JavaScript Vanilla ES6+ (sem frameworks)
- Design system próprio: variáveis CSS, dark mode, componentes reutilizáveis
- Fontes: Inter (Google Fonts) | Ícones: Bootstrap Icons

### Backend
- Node.js + Express (API REST)
- Autenticação: JWT (8h de validade)
- Tempo real: Server-Sent Events (SSE)
- Senhas: bcrypt (salt rounds 10)

### Banco de Dados
- MySQL 8.0
- Tabelas principais: `usuarios`, `clientes`, `fornecedores`, `reservas`, `financeiro`, `comissoes`, `lembretes`

### Infraestrutura (Fase 1)
- VPS: Hostinger Ubuntu 24.04 — 8GB RAM / 100GB SSD
- IP: 31.97.250.95
- Domínio: app.srv1589437.hstgr.cloud
- Containers: Docker (Nginx + Node.js API + MySQL)
- Reverse proxy: Traefik (SSL automático via Let's Encrypt)
- Já em produção: n8n (automações futuras — ex: WhatsApp via n8n)

### Segurança
- HTTPS obrigatório (Traefik + Let's Encrypt)
- JWT em todas as rotas protegidas
- Custo do fornecedor protegido por role (Admin/Financeiro only)
- Log de auditoria imutável em banco
- Dados sensíveis nunca expostos ao frontend de agentes

### Integrações Futuras
- WhatsApp Business API (lembretes de check-in)
- NFS-e (emissão de nota fiscal)
- Plataformas de reserva (GDS, operadoras via API)

---

## 7. Roadmap de Desenvolvimento

### Sprint 1 — Fundação (concluído)
- [x] Design system (CSS, componentes, dark mode)
- [x] Página de login com autenticação JWT real
- [x] Dashboard com KPIs (conectado à API)
- [x] API REST (Node.js + MySQL) em produção no VPS
- [x] Infraestrutura Docker + Traefik + SSL

### Sprint 2 — Core Operacional (próximo)
- [ ] Gestão de Reservas — listagem, filtros, criação, edição
- [ ] Modal de reserva com todos os campos (tipo, cliente, fornecedor, custo, markup)
- [ ] Cálculo automático de valor total e lucro bruto
- [ ] Cadastro de Clientes — CRUD completo com perfil e histórico
- [ ] Cadastro de Fornecedores — CRUD completo

### Sprint 3 — Financeiro & Comissionamento
- [ ] Módulo Financeiro — lançamentos, saldo por reserva, status de pagamento
- [ ] Engine de comissionamento — regra progressiva + lead próprio
- [ ] Extrato de comissão por agente (mensal)
- [ ] Extrato consolidado para admin
- [ ] Relatórios: receita, lucro, comissões, inadimplência

### Sprint 4 — Lembretes & Automação
- [ ] Engine de lembretes — agendamento 48h antes do embarque
- [ ] Disparo via e-mail (SendGrid ou similar)
- [ ] Integração WhatsApp (n8n + WhatsApp Business API)
- [ ] Dashboard de lembretes com status de envio
- [ ] Log de auditoria nas reservas

### Sprint 5 — Produto & Multi-tenant
- [ ] Arquitetura multi-tenant (isolamento por tenant_id)
- [ ] Onboarding de nova agência (criação de conta, configuração inicial)
- [ ] Painel de administração global (superadmin)
- [ ] Sistema de planos e limitações por plano
- [ ] Customização de regras de comissão por agência
