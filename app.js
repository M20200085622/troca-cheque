(() => {
  const STORAGE_KEY = 'trocaCheque.v2';

  /** @type {{mode:'cima'|'baixo', unit:'mes'|'dia', taxa:number, cheques:{valor:number, vencimento:string}[]}} */
  let state = {
    mode: 'baixo',
    unit: 'mes',
    taxa: 8,
    cheques: []
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
    segButtons: document.querySelectorAll('.seg-btn'),
    modeExplain: document.getElementById('modeExplain'),
    taxa: document.getElementById('taxa'),
    unitButtons: document.querySelectorAll('.mini-btn'),
    recValor: document.getElementById('recValor'),
    recQtd: document.getElementById('recQtd'),
    recDia: document.getElementById('recDia'),
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
  };

  const MODE_EXPLAIN = {
    cima: 'Você troca (adianta) o valor agora e o cheque deve cobrir esse valor corrigido para cima: valor × (1 + taxa) elevado ao prazo até o vencimento.',
    baixo: 'O cheque tem um valor de face e você calcula quanto pagar hoje com desconto: valor × (1 − taxa) elevado ao prazo até o vencimento.'
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

  function todayDayOfMonth() {
    return todayMidnight().getDate();
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

  // Given a day-of-month, finds the nearest occurrence on/after `baseDate`
  // (this month if it hasn't passed yet, otherwise next month).
  function resolveDueDateFromDay(day, baseDate) {
    day = Math.min(31, Math.max(1, Math.floor(day) || 1));
    let candidate = clampedDate(baseDate.getFullYear(), baseDate.getMonth(), day);
    if (candidate < baseDate) {
      candidate = clampedDate(baseDate.getFullYear(), baseDate.getMonth() + 1, day);
    }
    return candidate;
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

  function calcCheque(valor, vencimentoISO, mode, unit, taxaPercent) {
    const v = Number(valor) || 0;
    const { n } = prazoInfo(vencimentoISO, unit);
    const i = (Number(taxaPercent) || 0) / 100;
    if (mode === 'cima') {
      return v * Math.pow(1 + i, n);
    }
    return v * Math.pow(1 - i, n);
  }

  function diasLabel(days) {
    if (days === 0) return 'vence hoje';
    if (days === 1) return 'vence em 1 dia';
    return `vence em ${days} dias`;
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
      const diaEl = node.querySelector('.row-dia');
      const daysEl = node.querySelector('.row-days');
      const resultEl = node.querySelector('.row-result');
      const removeEl = node.querySelector('.row-remove');

      idxEl.textContent = `#${idx + 1}`;
      valorEl.value = cheque.valor === '' || cheque.valor == null ? '' : formatCurrencyStr(cheque.valor);
      diaEl.value = parseISODate(cheque.vencimento).getDate();

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

      diaEl.addEventListener('input', () => {
        const day = Number(diaEl.value) || todayDayOfMonth();
        const due = resolveDueDateFromDay(day, todayMidnight());
        state.cheques[idx].vencimento = isoDateFromDate(due);
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
    state.cheques.push({ valor: '', vencimento: todayISODate() });
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
    const day = Number(els.recDia.value) || todayDayOfMonth();
    if (!valor || !qtd) return;

    const firstDue = resolveDueDateFromDay(day, todayMidnight());
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

  // ---- init ----
  loadState();
  els.recDia.value = todayDayOfMonth();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support best-effort */ });
    });
  }
})();
