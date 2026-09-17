(() => {
  const STORAGE_KEY = 'trocaCheque.v2';

  /** @type {{mode:'cima'|'baixo', unit:'mes'|'dia', taxa:number, cheques:{valor:number, vencimento:string}[], financiamento: {target:'pv'|'n'|'i'|'pmt', pv:number|'', n:number|'', i:number|'', pmt:number|''}, financCheque: {pv:number|'', qtd:number|'', taxa:number|'', unit:'mes'|'dia', vencimento:string}}} */
  let state = {
    mode: 'baixo',
    unit: 'mes',
    taxa: 8,
    cheques: [],
    financiamento: { target: 'pmt', pv: '', n: '', i: '', pmt: '' },
    financCheque: { pv: '', qtd: '', taxa: '', unit: 'mes', vencimento: '' }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = { ...state, ...parsed };
      }
    } catch (e) { /* ignore corrupted storage */ }
    // migration safety net: any cheque missing a due date defaults to today
    state.cheques = (state.cheques || []).map(c => ({
      valor: c.valor,
      vencimento: c.vencimento || todayISODate()
    }));
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable, ignore */ }
  }

  const els = {
    appTitle: document.getElementById('appTitle'),
    appSubtitle: document.getElementById('appSubtitle'),
    navButtons: document.querySelectorAll('.app-nav-btn'),
    segButtons: document.querySelectorAll('.seg-btn'),
    modeExplain: document.getElementById('modeExplain'),
    taxa: document.getElementById('taxa'),
    unitButtons: document.querySelectorAll('[data-unit]'),
    recValor: document.getElementById('recValor'),
    recQtd: document.getElementById('recQtd'),
    recVencimento: document.getElementById('recVencimento'),
    btnGerar: document.getElementById('btnGerar'),
    btnAdd: document.getElementById('btnAdd'),
    chequeList: document.getElementById('chequeList'),
    emptyHint: document.getElementById('emptyHint'),
    totalBase: document.getElementById('totalBase'),
    totalJuros: document.getElementById('totalJuros'),
    totalFinal: document.getElementById('totalFinal'),
    totalLabel: document.getElementById('totalLabel'),
    btnClear: document.getElementById('btnClear'),
    rowTemplate: document.getElementById('rowTemplate'),
    finTargetButtons: document.querySelectorAll('.fin-target-btn'),
    finPv: document.getElementById('finPv'),
    finN: document.getElementById('finN'),
    finI: document.getElementById('finI'),
    finPmt: document.getElementById('finPmt'),
    finTotalPago: document.getElementById('finTotalPago'),
    finTotalJuros: document.getElementById('finTotalJuros'),
    finError: document.getElementById('finError'),
    finClear: document.getElementById('finClear'),
    fcPv: document.getElementById('fcPv'),
    fcQtd: document.getElementById('fcQtd'),
    fcTaxa: document.getElementById('fcTaxa'),
    fcUnitButtons: document.querySelectorAll('[data-fcunit]'),
    fcVencimento: document.getElementById('fcVencimento'),
    fcParcela: document.getElementById('fcParcela'),
    fcTotalPago: document.getElementById('fcTotalPago'),
    fcTotalJuros: document.getElementById('fcTotalJuros'),
    fcError: document.getElementById('fcError'),
    fcGerar: document.getElementById('fcGerar'),
    fcClear: document.getElementById('fcClear'),
  };

  const MODE_EXPLAIN = {
    cima: 'Você troca (adianta) o valor agora; o cheque precisa ter o valor de face que, descontado, cobre exatamente esse valor: valor ÷ [1 − (taxa × prazo)].',
    baixo: 'O cheque tem um valor de face e você calcula quanto pagar hoje com desconto, em juros simples: valor × [1 − (taxa × prazo)].'
  };

  // ---- date helpers ----

  function todayMidnight() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function todayISODate() {
    return isoDateFromDate(todayMidnight());
  }

  // Default due date shown to the user: same day-of-month as today, but next month
  // (a cheque due "today" isn't realistic, so the sensible default is one month out).
  function defaultVencimentoISODate() {
    return isoDateFromDate(addMonths(todayMidnight(), 1));
  }

  function isoDateFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseISODate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // Builds a date for (year, month, day), clamping day to the last valid day of that month
  // (handles month overflow/underflow from arithmetic and short months like Feb).
  function clampedDate(year, month, day) {
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(day, daysInMonth));
  }

  function addMonths(date, months) {
    return clampedDate(date.getFullYear(), date.getMonth() + months, date.getDate());
  }

  function daysBetween(fromDate, toDate) {
    return Math.round((toDate - fromDate) / 86400000);
  }

  // ---- money helpers ----

  function fmtMoney(n) {
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // Formats a plain number as a BR currency string without the "R$" prefix, e.g. 1234.5 -> "1.234,50"
  function formatCurrencyStr(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Applies a live "type digits, they fill in as cents" currency mask to a text input.
  // Returns the numeric value and rewrites the input's display value on every keystroke.
  function applyCurrencyMask(inputEl) {
    const digits = inputEl.value.replace(/\D/g, '');
    if (!digits) {
      inputEl.value = '';
      return 0;
    }
    const value = parseInt(digits, 10) / 100;
    inputEl.value = formatCurrencyStr(value);
    return value;
  }

  // ---- interest calculation ----

  // Converts the exact days until the due date into the exponent used by the formula:
  // in "por dia" mode each day is one period; in "por mês" mode days are divided by a
  // 30-day commercial month, so leftover ("quebrado") days become a fractional month.
  function prazoInfo(vencimentoISO, unit) {
    const days = daysBetween(todayMidnight(), parseISODate(vencimentoISO));
    const n = unit === 'mes' ? days / 30 : days;
    return { days, n };
  }

  // Juros simples (linear), o padrão do mercado para desconto de cheque:
  // o desconto total é taxa x prazo, sem compor período a período.
  // Juros compostos: o montante (valor + juros) cresce mês a mês sobre o saldo já
  // corrigido do mês anterior, igual a uma dívida capitalizando: montante = valor x (1+taxa)^prazo.
  // "Pra cima" cobra esse montante. "Pra baixo" desconta do cheque os juros acumulados
  // desse mesmo montante: juros = montante - valor  =>  a pagar = valor - juros = 2*valor - montante.
  function roundCents(n) {
    return Math.round(n * 100) / 100;
  }

  // Juros simples: fator = 1 - (taxa x prazo). "Pra baixo" desconta o cheque multiplicando
  // por esse fator; "pra cima" é o inverso exato, dividindo por ele (o valor de face
  // necessário pra que, descontado, volte a valer o que foi trocado hoje).
  function calcCheque(valor, vencimentoISO, mode, unit, taxaPercent) {
    const v = Number(valor) || 0;
    const { n } = prazoInfo(vencimentoISO, unit);
    const i = (Number(taxaPercent) || 0) / 100;
    const fator = 1 - i * n;
    if (mode === 'cima') {
      return roundCents(v / Math.max(0.0001, fator));
    }
    return roundCents(Math.max(0, v * fator));
  }

  function diasLabel(days) {
    if (days === 0) return 'vence hoje';
    if (days === 1) return 'vence em 1 dia';
    return `vence em ${days} dias`;
  }

  // ---- financiamento (Tabela Price: parcelas fixas, juros compostos) ----
  // pmt = pv x i / (1-(1+i)^-n)   <=>   pv = pmt x (1-(1+i)^-n) / i

  function finPMT(pv, n, i) {
    if (i === 0) return pv / n;
    return (pv * i) / (1 - Math.pow(1 + i, -n));
  }

  function finPV(pmt, n, i) {
    if (i === 0) return pmt * n;
    return (pmt * (1 - Math.pow(1 + i, -n))) / i;
  }

  function finN(pv, pmt, i) {
    if (i === 0) return pv / pmt;
    const ratio = 1 - (pv * i) / pmt;
    if (ratio <= 0) return null; // prestação não cobre nem os juros do 1º período
    return -Math.log(ratio) / Math.log(1 + i);
  }

  // Não existe fórmula fechada para a taxa; resolve por bisseção (a prestação
  // cresce de forma monótona com a taxa, então dá pra fechar o intervalo).
  function finI(pv, n, pmt) {
    if (pmt * n <= pv) return null; // nem a 0% de juros a prestação cobriria o principal
    const f = (i) => finPMT(pv, n, i) - pmt;
    let lo = 0;
    let hi = 1;
    let guard = 0;
    while (f(hi) < 0 && guard < 60) {
      hi *= 2;
      guard++;
    }
    if (f(hi) < 0) return null;
    for (let k = 0; k < 100; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // ---- financiamento de cheque (parcelas iguais em juros simples) ----
  // Resolve a parcela P tal que a soma dos descontos simples de cada vencimento real
  // bate exatamente o valor financiado: pv = P x sum(1 - i x prazo_t), pra t=1..qtd.
  // Usa as mesmas datas (mesmo dia do mês, +1 mês por parcela) e o mesmo prazo em dias
  // corridos que "Trocar pra baixo" usa, então descontar os cheques gerados aqui bate certo.
  function financCequeSchedule(qtd, startISO) {
    const start = parseISODate(startISO);
    const dates = [];
    for (let t = 0; t < qtd; t++) {
      const due = t === 0 ? start : addMonths(start, t);
      dates.push(isoDateFromDate(due));
    }
    return dates;
  }

  function financChequeCalc(pv, qtd, taxaPercent, unit, startISO) {
    const i = (Number(taxaPercent) || 0) / 100;
    const dates = financCequeSchedule(qtd, startISO);
    let sumFator = 0;
    dates.forEach(d => {
      const { n } = prazoInfo(d, unit);
      sumFator += (1 - i * n);
    });
    if (sumFator <= 0) return { parcela: null, dates };
    return { parcela: roundCents(pv / sumFator), dates };
  }

  // ---- render ----

  function render() {
    // mode buttons
    els.segButtons.forEach(btn => {
      const active = btn.dataset.mode === state.mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    els.modeExplain.textContent = MODE_EXPLAIN[state.mode];
    els.totalLabel.textContent = state.mode === 'cima' ? 'Valor final total (a cobrar)' : 'Valor final total (a pagar)';

    // unit buttons
    els.unitButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.unit === state.unit);
    });

    // taxa input (avoid clobbering focus/caret while typing)
    if (document.activeElement !== els.taxa) {
      els.taxa.value = state.taxa === '' || state.taxa === null ? '' : state.taxa;
    }

    renderRows();
    renderTotals();
  }

  function renderRows() {
    els.chequeList.innerHTML = '';
    els.emptyHint.style.display = state.cheques.length === 0 ? 'block' : 'none';

    state.cheques.forEach((cheque, idx) => {
      const node = els.rowTemplate.content.cloneNode(true);
      const row = node.querySelector('.cheque-row');
      const idxEl = node.querySelector('.row-index');
      const valorEl = node.querySelector('.row-valor');
      const vencimentoEl = node.querySelector('.row-vencimento');
      const daysEl = node.querySelector('.row-days');
      const resultEl = node.querySelector('.row-result');
      const removeEl = node.querySelector('.row-remove');

      idxEl.textContent = `#${idx + 1}`;
      valorEl.value = cheque.valor === '' || cheque.valor == null ? '' : formatCurrencyStr(cheque.valor);
      vencimentoEl.min = todayISODate();
      vencimentoEl.value = cheque.vencimento;

      const updateRowOutput = () => {
        const { days } = prazoInfo(cheque.vencimento, state.unit);
        daysEl.textContent = diasLabel(days);
        const r = calcCheque(state.cheques[idx].valor, state.cheques[idx].vencimento, state.mode, state.unit, state.taxa);
        resultEl.textContent = fmtMoney(r);
      };
      updateRowOutput();

      valorEl.addEventListener('input', () => {
        state.cheques[idx].valor = applyCurrencyMask(valorEl);
        saveState();
        updateRowOutput();
        renderTotals();
      });

      vencimentoEl.addEventListener('input', () => {
        state.cheques[idx].vencimento = vencimentoEl.value || todayISODate();
        saveState();
        updateRowOutput();
        renderTotals();
      });

      removeEl.addEventListener('click', () => {
        state.cheques.splice(idx, 1);
        saveState();
        render();
      });

      els.chequeList.appendChild(row);
    });
  }

  function renderTotals() {
    let base = 0;
    let final = 0;
    state.cheques.forEach(c => {
      const v = Number(c.valor) || 0;
      base += v;
      final += calcCheque(c.valor, c.vencimento, state.mode, state.unit, state.taxa);
    });
    const juros = final - base;
    els.totalBase.textContent = fmtMoney(base);
    els.totalJuros.textContent = (state.mode === 'baixo' ? '- ' : '+ ') + fmtMoney(Math.abs(juros));
    els.totalFinal.textContent = fmtMoney(final);
  }

  function renderFinanciamento() {
    const fin = state.financiamento;
    const fieldEls = { pv: els.finPv, n: els.finN, i: els.finI, pmt: els.finPmt };

    els.finTargetButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.target === fin.target);
    });

    Object.entries(fieldEls).forEach(([key, el]) => {
      const isTarget = fin.target === key;
      el.readOnly = isTarget;
      el.classList.toggle('fin-computed', isTarget);
      if (document.activeElement === el) return;
      const v = fin[key];
      if (key === 'pv' || key === 'pmt') {
        el.value = v === '' || v == null ? '' : formatCurrencyStr(v);
      } else {
        el.value = v === '' || v == null ? '' : v;
      }
    });

    computeFinanciamento();
  }

  function computeFinanciamento() {
    const fin = state.financiamento;
    const pv = fin.pv === '' || fin.pv == null ? null : Number(fin.pv);
    const n = fin.n === '' || fin.n == null ? null : Number(fin.n);
    const i = fin.i === '' || fin.i == null ? null : Number(fin.i) / 100;
    const pmt = fin.pmt === '' || fin.pmt == null ? null : Number(fin.pmt);

    let ok = false;

    if (fin.target === 'pmt' && pv > 0 && n > 0 && i != null && i >= 0) {
      fin.pmt = roundCents(finPMT(pv, n, i));
      els.finPmt.value = formatCurrencyStr(fin.pmt);
      ok = true;
    } else if (fin.target === 'pv' && n > 0 && i != null && i >= 0 && pmt > 0) {
      fin.pv = roundCents(finPV(pmt, n, i));
      els.finPv.value = formatCurrencyStr(fin.pv);
      ok = true;
    } else if (fin.target === 'n' && pv > 0 && i != null && i >= 0 && pmt > 0) {
      const raw = finN(pv, pmt, i);
      if (raw != null && isFinite(raw) && raw > 0) {
        fin.n = Math.round(raw * 100) / 100;
        els.finN.value = fin.n;
        ok = true;
      }
    } else if (fin.target === 'i' && pv > 0 && n > 0 && pmt > 0) {
      const raw = finI(pv, n, pmt);
      if (raw != null && isFinite(raw) && raw >= 0) {
        fin.i = Math.round(raw * 100 * 100) / 100;
        els.finI.value = fin.i;
        ok = true;
      }
    }

    const attempted = pv != null || n != null || i != null || pmt != null;
    els.finError.style.display = !ok && attempted ? 'block' : 'none';

    if (ok) {
      const totalPago = roundCents((Number(fin.pmt) || 0) * (Number(fin.n) || 0));
      const totalJuros = roundCents(totalPago - (Number(fin.pv) || 0));
      els.finTotalPago.textContent = fmtMoney(totalPago);
      els.finTotalJuros.textContent = fmtMoney(totalJuros);
    } else {
      els.finTotalPago.textContent = fmtMoney(0);
      els.finTotalJuros.textContent = fmtMoney(0);
    }

    saveState();
  }

  function renderFinancCheque() {
    const fc = state.financCheque;

    els.fcUnitButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.fcunit === fc.unit);
    });

    if (document.activeElement !== els.fcPv) {
      els.fcPv.value = fc.pv === '' || fc.pv == null ? '' : formatCurrencyStr(fc.pv);
    }
    if (document.activeElement !== els.fcQtd) {
      els.fcQtd.value = fc.qtd === '' || fc.qtd == null ? '' : fc.qtd;
    }
    if (document.activeElement !== els.fcTaxa) {
      els.fcTaxa.value = fc.taxa === '' || fc.taxa == null ? '' : fc.taxa;
    }
    if (document.activeElement !== els.fcVencimento) {
      els.fcVencimento.value = fc.vencimento || defaultVencimentoISODate();
    }
    els.fcVencimento.min = todayISODate();

    computeFinancCheque();
  }

  function computeFinancCheque() {
    const fc = state.financCheque;
    const pv = fc.pv === '' || fc.pv == null ? null : Number(fc.pv);
    const qtd = fc.qtd === '' || fc.qtd == null ? null : Math.floor(Number(fc.qtd));
    const taxa = fc.taxa === '' || fc.taxa == null ? null : Number(fc.taxa);
    const startISO = fc.vencimento || defaultVencimentoISODate();

    let ok = false;
    let parcela = null;

    if (pv > 0 && qtd > 0 && taxa != null && taxa >= 0) {
      const result = financChequeCalc(pv, qtd, taxa, fc.unit, startISO);
      if (result.parcela != null && isFinite(result.parcela) && result.parcela > 0) {
        parcela = result.parcela;
        ok = true;
      }
    }

    const attempted = pv != null || qtd != null || taxa != null;
    els.fcError.style.display = !ok && attempted ? 'block' : 'none';
    els.fcGerar.disabled = !ok;

    if (ok) {
      const totalPago = roundCents(parcela * qtd);
      const totalJuros = roundCents(totalPago - pv);
      els.fcParcela.textContent = fmtMoney(parcela);
      els.fcTotalPago.textContent = fmtMoney(totalPago);
      els.fcTotalJuros.textContent = fmtMoney(totalJuros);
    } else {
      els.fcParcela.textContent = fmtMoney(0);
      els.fcTotalPago.textContent = fmtMoney(0);
      els.fcTotalJuros.textContent = fmtMoney(0);
    }

    saveState();
  }

  // ---- events ----

  els.segButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      saveState();
      render();
    });
  });

  els.unitButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.unit = btn.dataset.unit;
      saveState();
      render();
    });
  });

  els.taxa.addEventListener('input', () => {
    state.taxa = els.taxa.value === '' ? '' : Number(els.taxa.value);
    saveState();
    renderRows();
    renderTotals();
  });

  els.btnAdd.addEventListener('click', () => {
    state.cheques.push({ valor: '', vencimento: defaultVencimentoISODate() });
    saveState();
    render();
  });

  els.recValor.addEventListener('input', () => {
    applyCurrencyMask(els.recValor);
  });

  els.btnGerar.addEventListener('click', () => {
    const digits = els.recValor.value.replace(/\D/g, '');
    const valor = digits ? parseInt(digits, 10) / 100 : 0;
    const qtd = Math.max(1, Math.floor(Number(els.recQtd.value) || 0));
    const firstDue = parseISODate(els.recVencimento.value || todayISODate());
    if (!valor || !qtd) return;

    for (let i = 0; i < qtd; i++) {
      const due = i === 0 ? firstDue : addMonths(firstDue, i);
      state.cheques.push({ valor, vencimento: isoDateFromDate(due) });
    }
    saveState();
    render();
  });

  els.btnClear.addEventListener('click', () => {
    if (!confirm('Limpar todos os cheques e reiniciar os valores?')) return;
    state.cheques = [];
    saveState();
    render();
  });

  const VIEW_TITLES = {
    cheque: { title: 'Troca de Cheque', subtitle: 'Calculadora de juros' },
    financiamento: { title: 'Financiamento', subtitle: 'Simulador de parcelas (Tabela Price)' },
    financcheque: { title: 'Financ. Cheque', subtitle: 'Parcelas em juros simples pra descontar depois' },
  };

  function switchView(view) {
    els.navButtons.forEach(b => {
      const active = b.dataset.view === view;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.view[data-view]').forEach(section => {
      section.hidden = section.dataset.view !== view;
    });
    const titles = VIEW_TITLES[view] || VIEW_TITLES.cheque;
    els.appTitle.textContent = titles.title;
    els.appSubtitle.textContent = titles.subtitle;
  }

  els.navButtons.forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  els.finTargetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.financiamento.target = btn.dataset.target;
      renderFinanciamento();
    });
  });

  els.finPv.addEventListener('input', () => {
    if (state.financiamento.target === 'pv') return;
    state.financiamento.pv = applyCurrencyMask(els.finPv);
    computeFinanciamento();
  });

  els.finN.addEventListener('input', () => {
    if (state.financiamento.target === 'n') return;
    state.financiamento.n = els.finN.value === '' ? '' : Number(els.finN.value);
    computeFinanciamento();
  });

  els.finI.addEventListener('input', () => {
    if (state.financiamento.target === 'i') return;
    state.financiamento.i = els.finI.value === '' ? '' : Number(els.finI.value);
    computeFinanciamento();
  });

  els.finPmt.addEventListener('input', () => {
    if (state.financiamento.target === 'pmt') return;
    state.financiamento.pmt = applyCurrencyMask(els.finPmt);
    computeFinanciamento();
  });

  els.finClear.addEventListener('click', () => {
    if (!confirm('Limpar os campos do financiamento?')) return;
    state.financiamento = { target: 'pmt', pv: '', n: '', i: '', pmt: '' };
    saveState();
    renderFinanciamento();
  });

  els.fcPv.addEventListener('input', () => {
    state.financCheque.pv = applyCurrencyMask(els.fcPv);
    computeFinancCheque();
  });

  els.fcQtd.addEventListener('input', () => {
    state.financCheque.qtd = els.fcQtd.value === '' ? '' : Number(els.fcQtd.value);
    computeFinancCheque();
  });

  els.fcTaxa.addEventListener('input', () => {
    state.financCheque.taxa = els.fcTaxa.value === '' ? '' : Number(els.fcTaxa.value);
    computeFinancCheque();
  });

  els.fcUnitButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      state.financCheque.unit = btn.dataset.fcunit;
      saveState();
      renderFinancCheque();
    });
  });

  els.fcVencimento.addEventListener('input', () => {
    state.financCheque.vencimento = els.fcVencimento.value || defaultVencimentoISODate();
    computeFinancCheque();
  });

  els.fcGerar.addEventListener('click', () => {
    const fc = state.financCheque;
    const pv = Number(fc.pv) || 0;
    const qtd = Math.floor(Number(fc.qtd)) || 0;
    const startISO = fc.vencimento || defaultVencimentoISODate();
    const result = financChequeCalc(pv, qtd, fc.taxa, fc.unit, startISO);
    if (!result.parcela) return;

    if (state.cheques.length > 0 && !confirm('Isso substitui a lista de cheques atual da aba Troca. Continuar?')) return;

    state.cheques = result.dates.map(vencimento => ({ valor: result.parcela, vencimento }));
    state.taxa = fc.taxa;
    state.unit = fc.unit;
    state.mode = 'baixo';
    saveState();
    render();
    switchView('cheque');
  });

  els.fcClear.addEventListener('click', () => {
    if (!confirm('Limpar os campos do financiamento de cheque?')) return;
    state.financCheque = { pv: '', qtd: '', taxa: '', unit: 'mes', vencimento: '' };
    saveState();
    renderFinancCheque();
  });

  // ---- init ----
  loadState();
  els.recVencimento.value = defaultVencimentoISODate();
  els.recVencimento.min = todayISODate();
  render();
  renderFinanciamento();
  if (!state.financCheque.vencimento) state.financCheque.vencimento = defaultVencimentoISODate();
  renderFinancCheque();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support best-effort */ });
    });
  }
})();
