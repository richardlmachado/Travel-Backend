/* ═══════════════════════════════════════════════════════════════
   TravelAgent OS — PDF Docs (Sprint 8)
   Gera Proposta Comercial, Voucher de Viagem e Recibo de Pagamento
   via jsPDF + AutoTable (client-side).
   ═══════════════════════════════════════════════════════════════ */
window.PdfDocs = {
  _lojaCache: null,

  async getLoja() {
    if (this._lojaCache) return this._lojaCache;
    const user = (window.Auth && Auth.getUser) ? Auth.getUser() : null;
    if (!user || !user.loja_id) return null;
    try {
      const res  = await Auth.apiFetch('/api/lojas/' + user.loja_id);
      const body = await res.json();
      if (body.ok) this._lojaCache = body.data;
      return this._lojaCache;
    } catch { return null; }
  },

  fmtMoney(v) {
    return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(+v || 0);
  },
  fmtDate(s) {
    if (!s) return '—';
    const str = String(s);
    const d = str.length > 10 ? new Date(str) : new Date(str + 'T00:00:00');
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  },
  fmtDateTime(s) {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
  },

  _header(doc, loja, title, subtitle) {
    const W = doc.internal.pageSize.getWidth();
    doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(30,30,30);
    doc.text(loja?.nome || 'TravelAgent OS', 14, 16);

    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(90,90,90);
    const line2 = [loja?.razao_social, loja?.cnpj ? 'CNPJ: ' + loja.cnpj : null].filter(Boolean).join(' · ');
    if (line2) doc.text(line2, 14, 22);
    const line3 = [loja?.endereco, loja?.telefone, loja?.email].filter(Boolean).join(' · ');
    if (line3) {
      const wrapped = doc.splitTextToSize(line3, W - 100);
      doc.text(wrapped, 14, 26);
    }

    doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(37,99,235);
    doc.text(title, W - 14, 16, { align:'right' });
    if (subtitle) {
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(90,90,90);
      doc.text(subtitle, W - 14, 22, { align:'right' });
    }

    doc.setDrawColor(220,220,220); doc.setLineWidth(0.3);
    doc.line(14, 32, W - 14, 32);
    return 38;
  },

  _footer(doc, extra) {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(220,220,220); doc.setLineWidth(0.3);
    doc.line(14, H - 14, W - 14, H - 14);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(130,130,130);
    doc.text('Gerado em ' + new Date().toLocaleString('pt-BR'), 14, H - 9);
    if (extra) doc.text(extra, W - 14, H - 9, { align:'right' });
  },

  _parseDados(d) {
    if (!d) return {};
    if (typeof d === 'object') return d;
    try { return JSON.parse(d); } catch { return {}; }
  },
  _tipoLabel(t) {
    const L = {
      AIRFARE:'Passagem Aérea', HOSTING:'Hospedagem', INSURANCE:'Seguro Viagem',
      PACKAGE:'Pacote Turístico', CAR:'Aluguel de Veículo', BUS:'Rodoviário', TRAIN:'Trem',
      CRUISE:'Cruzeiro', TOUR:'Passeio', TICKET:'Ingresso',
      EDUCATIONAL:'Educacional', OTHER:'Outros'
    };
    return L[t] || t || '—';
  },
  _periodo(it, d) {
    const ini = it.data_inicio || d.dataInicio || d.checkin;
    const fim = it.data_fim    || d.dataFim    || d.checkout;
    if (ini && fim) return this.fmtDate(ini) + ' → ' + this.fmtDate(fim);
    if (ini) return this.fmtDate(ini);
    return '—';
  },
  _descItem(it, d) {
    if (it.tipo_produto === 'AIRFARE') {
      const trechos = Array.isArray(d.trechos) ? d.trechos : [];
      if (trechos.length) {
        const rota = trechos.map(t => (t.origem || '?') + '→' + (t.destino || '?')).join(' | ');
        return [d.ciaAerea, rota].filter(Boolean).join(' · ');
      }
      return d.ciaAerea || '—';
    }
    if (it.tipo_produto === 'HOSTING') {
      return [d.nomeHotel, d.tipoQuarto, d.regime].filter(Boolean).join(' · ') || '—';
    }
    if (it.tipo_produto === 'CRUISE') {
      return [d.nomeNavio, d.descricao].filter(Boolean).join(' · ') || '—';
    }
    return d.descricao || this._tipoLabel(it.tipo_produto);
  },
  _detalhesVoucher(it, d) {
    const rows = [];
    const add = (k, v) => { if (v !== null && v !== undefined && v !== '' && v !== '—') rows.push([k, String(v)]); };
    if (it.tipo_produto === 'AIRFARE') {
      add('Cia Aérea', d.ciaAerea);
      add('Localizador', d.localizador);
      add('Classe', d.classe);
    } else if (it.tipo_produto === 'HOSTING') {
      add('Hotel', d.nomeHotel);
      add('Tipo de Quarto', d.tipoQuarto);
      add('Regime', d.regime);
      add('Check-in', this.fmtDate(d.checkin));
      add('Check-out', this.fmtDate(d.checkout));
    } else if (it.tipo_produto === 'CRUISE') {
      add('Navio', d.nomeNavio);
      add('Descrição', d.descricao);
    } else {
      add('Descrição', d.descricao);
    }
    return rows;
  },

  /* ── Proposta Comercial ──────────────────────────────────── */
  async gerarProposta(venda) {
    if (!window.jspdf) { Notify.error('jsPDF não carregado'); return; }
    const loja = await this.getLoja();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W = doc.internal.pageSize.getWidth();

    const validade = this.fmtDate(venda.cotacao_validade);
    let y = this._header(doc, loja, 'PROPOSTA COMERCIAL', 'Nº ' + (venda.codigo || '—'));

    // Cliente
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
    doc.text('Cliente', 14, y); y += 5;
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60,60,60);
    const cliDoc = venda.cpf || venda.cnpj;
    const linhas = [
      'Nome: ' + (venda.cliente_nome || '—'),
      cliDoc ? 'Documento: ' + cliDoc : null,
      venda.cliente_email ? 'Email: ' + venda.cliente_email : null,
      venda.cliente_telefone ? 'Telefone: ' + venda.cliente_telefone : null,
    ].filter(Boolean);
    linhas.forEach(l => { doc.text(l, 14, y); y += 4; });
    y += 3;

    // Consultor
    if (venda.agente_nome) {
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
      doc.text('Consultor', 14, y); y += 5;
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60,60,60);
      doc.text(venda.agente_nome + (venda.agente_email ? ' · ' + venda.agente_email : ''), 14, y);
      y += 7;
    }

    // Datas
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
    doc.text('Datas', 14, y); y += 5;
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60,60,60);
    doc.text('Abertura: ' + this.fmtDate(venda.data_abertura), 14, y);
    doc.text('Validade da proposta: ' + validade, 90, y);
    y += 8;

    // Itens
    const itens = venda.itens || [];
    const body = itens.map(it => {
      const d = this._parseDados(it.dados);
      return [
        this._tipoLabel(it.tipo_produto),
        it.fornecedor_nome || '—',
        this._descItem(it, d),
        this._periodo(it, d),
        this.fmtMoney(it.total_venda_brl || it.total_venda || 0),
      ];
    });
    const totalVenda = itens.reduce((s, it) => s + (+it.total_venda_brl || +it.total_venda || 0), 0);

    doc.autoTable({
      startY: y,
      head: [['Tipo','Fornecedor','Descrição','Período','Valor']],
      body: body.length ? body : [['—','—','Sem itens cadastrados','—','R$ 0,00']],
      foot: [[{ content: 'Total', colSpan: 4, styles: { halign:'right' } }, this.fmtMoney(totalVenda)]],
      styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [37,99,235], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240,240,240], textColor: [30,30,30], fontStyle: 'bold' },
      columnStyles: { 4: { halign:'right', cellWidth: 30 }, 3: { cellWidth: 32 }, 0: { cellWidth: 28 } },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;

    // Passageiros
    if ((venda.pax || []).length) {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
      doc.text('Passageiros', 14, y);
      doc.autoTable({
        startY: y + 2,
        head: [['Nome','CPF','Nascimento','Passaporte']],
        body: venda.pax.map(p => [p.nome || '—', p.cpf || '—', this.fmtDate(p.data_nascimento), p.passaporte || '—']),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [60,60,60], textColor: 255, fontStyle: 'bold' },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // Condições
    const textoCond = [venda.condicoes_gerais, venda.regras, venda.observacoes].filter(Boolean).join('\n\n');
    if (textoCond) {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
      doc.text('Condições Gerais', 14, y); y += 5;
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(80,80,80);
      const wrapped = doc.splitTextToSize(textoCond, W - 28);
      doc.text(wrapped, 14, y);
      y += wrapped.length * 4 + 4;
    }

    // Validade destacada no rodapé
    if (validade !== '—') {
      doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(120,120,120);
      doc.text('Proposta válida até ' + validade + '. Valores sujeitos a confirmação no momento da emissão.',
        14, doc.internal.pageSize.getHeight() - 20);
    }

    this._footer(doc, 'Proposta ' + (venda.codigo || ''));
    doc.save('proposta-' + (venda.codigo || 'venda') + '.pdf');
  },

  /* ── Voucher de Viagem (por item) ───────────────────────── */
  async gerarVoucher(venda, item) {
    if (!window.jspdf) { Notify.error('jsPDF não carregado'); return; }
    const loja = await this.getLoja();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W = doc.internal.pageSize.getWidth();
    const d = this._parseDados(item.dados);
    const tipo = this._tipoLabel(item.tipo_produto);

    let y = this._header(doc, loja, 'VOUCHER DE VIAGEM', tipo + ' · ' + (venda.codigo || ''));

    // Card localizador
    doc.setFillColor(245,247,255); doc.setDrawColor(37,99,235);
    doc.roundedRect(14, y, W - 28, 22, 2, 2, 'FD');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(37,99,235);
    doc.text('LOCALIZADOR', 18, y + 6);
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(30,30,30);
    doc.text(String(d.localizador || (venda.codigo + '-' + item.id)), 18, y + 16);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(90,90,90);
    doc.text('Emissão: ' + this.fmtDate(d.dataEmissao || venda.data_abertura), W - 18, y + 10, { align:'right' });
    doc.text('Tipo: ' + tipo, W - 18, y + 16, { align:'right' });
    y += 28;

    // Fornecedor
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
    doc.text('Fornecedor', 14, y); y += 5;
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60,60,60);
    doc.text(item.fornecedor_nome || '—', 14, y); y += 7;

    // Cliente
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
    doc.text('Cliente', 14, y); y += 5;
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60,60,60);
    doc.text(venda.cliente_nome || '—', 14, y);
    if (venda.cliente_telefone) doc.text('Tel: ' + venda.cliente_telefone, 120, y);
    y += 7;

    // Período
    const dataIni = item.data_inicio || d.dataInicio || d.checkin;
    const dataFim = item.data_fim    || d.dataFim    || d.checkout;
    if (dataIni || dataFim) {
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
      doc.text('Período', 14, y); y += 5;
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60,60,60);
      doc.text('Início: ' + this.fmtDate(dataIni), 14, y);
      doc.text('Fim: '    + this.fmtDate(dataFim), 90, y); y += 7;
    }

    // Detalhes
    const det = this._detalhesVoucher(item, d);
    if (det.length) {
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
      doc.text('Detalhes', 14, y);
      doc.autoTable({
        startY: y + 2,
        body: det,
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 1.5 },
        columnStyles: { 0: { fontStyle:'bold', cellWidth: 45, textColor:[60,60,60] }, 1: { textColor:[30,30,30] } },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 5;
    }

    // Trechos
    if (Array.isArray(d.trechos) && d.trechos.length) {
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
      doc.text('Itinerário', 14, y);
      doc.autoTable({
        startY: y + 2,
        head: [['Origem','Destino','Data','Voo','Classe','Observação']],
        body: d.trechos.map(t => [
          t.origem || '—', t.destino || '—', this.fmtDate(t.data),
          t.voo || '—', t.classe || '—', t.obs || '—'
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [37,99,235], textColor: 255, fontStyle: 'bold' },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // Passageiros vinculados ao item
    const paxIds = (venda.pax_itens || []).filter(pi => pi.item_id === item.id).map(pi => pi.pax_id);
    let paxList = (venda.pax || []).filter(p => paxIds.includes(p.id));
    if (!paxList.length && (venda.pax || []).length && !paxIds.length) {
      paxList = venda.pax;
    }
    if (paxList.length) {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
      doc.text('Passageiros', 14, y);
      doc.autoTable({
        startY: y + 2,
        head: [['Nome','CPF','Nascimento','Passaporte']],
        body: paxList.map(p => [p.nome || '—', p.cpf || '—', this.fmtDate(p.data_nascimento), p.passaporte || '—']),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [60,60,60], textColor: 255, fontStyle: 'bold' },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    if (item.observacoes) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(30,30,30);
      doc.text('Observações', 14, y); y += 5;
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(80,80,80);
      const wrapped = doc.splitTextToSize(String(item.observacoes), W - 28);
      doc.text(wrapped, 14, y);
    }

    const contato = [loja?.telefone, loja?.email].filter(Boolean).join(' · ');
    if (contato) {
      doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(120,120,120);
      doc.text('Em caso de dúvidas: ' + contato, 14, doc.internal.pageSize.getHeight() - 20);
    }

    this._footer(doc, 'Voucher ' + (d.localizador || venda.codigo || ''));
    doc.save('voucher-' + (venda.codigo || 'venda') + '-' + item.id + '.pdf');
  },

  /* ── Recibo de Pagamento ────────────────────────────────── */
  async gerarRecibo(parcela, pagamento, venda) {
    if (!window.jspdf) { Notify.error('jsPDF não carregado'); return; }
    if (!parcela.pago) { Notify.error('Só é possível gerar recibo de parcelas pagas.'); return; }
    const loja = await this.getLoja();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W = doc.internal.pageSize.getWidth();

    const vendaCodigo = venda?.codigo || pagamento?.venda_codigo || '';
    const numero = 'RC-' + (vendaCodigo || 'P' + pagamento.id) + '-' + pagamento.id + '-' + (parcela.numero || parcela.id);
    let y = this._header(doc, loja, 'RECIBO DE PAGAMENTO', 'Nº ' + numero);

    const valor = (+parcela.valor || 0) + (+parcela.multa_encargo || 0);

    // Card valor destaque
    doc.setFillColor(245,247,255); doc.setDrawColor(37,99,235);
    doc.roundedRect(14, y, W - 28, 24, 2, 2, 'FD');
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(90,90,90);
    doc.text('Valor pago', 18, y + 7);
    doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(30,30,30);
    doc.text(this.fmtMoney(valor), 18, y + 18);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(90,90,90);
    doc.text('Data do pagamento', W - 18, y + 7, { align:'right' });
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(30,30,30);
    doc.text(this.fmtDate(parcela.data_pagamento), W - 18, y + 16, { align:'right' });
    y += 30;

    // Recebemos de
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(90,90,90);
    doc.text('Recebemos de', 14, y); y += 5;
    doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(30,30,30);
    doc.text(venda?.cliente_nome || pagamento?.cliente_nome || '—', 14, y); y += 5;
    const cliDoc = venda?.cpf || venda?.cnpj;
    if (cliDoc) {
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(80,80,80);
      doc.text('Documento: ' + cliDoc, 14, y); y += 5;
    }
    y += 3;

    // Referente a
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(90,90,90);
    doc.text('Referente a', 14, y); y += 5;
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(30,30,30);
    const ref = [
      'Venda ' + (vendaCodigo || '—'),
      'Parcela ' + (parcela.numero || '—') + (pagamento.num_parcelas ? '/' + pagamento.num_parcelas : ''),
      parcela.conta ? 'Conta: ' + parcela.conta : null,
      pagamento.forma_pagamento ? 'Forma: ' + pagamento.forma_pagamento : null,
    ].filter(Boolean).join(' · ');
    doc.text(ref, 14, y); y += 10;

    // Tabela de detalhes
    const linhas = [
      ['Valor da parcela', this.fmtMoney(parcela.valor || 0)],
    ];
    if (+parcela.multa_encargo > 0) linhas.push(['Multa / Encargos', this.fmtMoney(parcela.multa_encargo)]);

    doc.autoTable({
      startY: y,
      head: [['Descrição','Valor']],
      body: linhas,
      foot: [['Total pago', this.fmtMoney(valor)]],
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: [37,99,235], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240,240,240], textColor: [30,30,30], fontStyle: 'bold' },
      columnStyles: { 1: { halign:'right', cellWidth: 50 } },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 24;

    // Texto de declaração
    doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.setTextColor(80,80,80);
    const txt = 'Declaramos ter recebido a importância acima, referente à venda e parcela indicadas, dando a mais ampla e geral quitação.';
    const wrapped = doc.splitTextToSize(txt, W - 28);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 4 + 16;

    // Assinatura
    doc.setDrawColor(180,180,180); doc.setLineWidth(0.3);
    doc.line(14, y, 100, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(100,100,100);
    doc.text(loja?.nome || 'Agência', 14, y + 5);
    if (loja?.cnpj) doc.text('CNPJ: ' + loja.cnpj, 14, y + 10);

    this._footer(doc, 'Recibo ' + numero);
    doc.save('recibo-' + numero + '.pdf');
  },
};
