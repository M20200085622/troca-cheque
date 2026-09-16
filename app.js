(() => {
  const STORAGE_KEY = 'trocaCheque.v1';

  /** @type {{mode:'cima'|'baixo', unit:'mes'|'dia', taxa:number, cheques:{valor:number, prazo:number}[]}} */
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
    cima: 'Você troca (adianta) o valor agora e o cheque deve cobrir esse valor corrigido para cima: valor × (1 + taxa) elevado ao prazo.',
    baixo: 'O cheque tem um valor de face e você calcula quanto pagar hoje com desconto: valor × (1 − taxa) elevado ao prazo.'
  };

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

  function unitLabel(unit) {
    return unit === 'mes' ? 'meses' : 'dias';
  }

  function calcCheque(valor, prazo, mode, taxaPercent) {
    const v = Number(valor) || 0;
    const n = Number(prazo) || 0;
    const i = (Number(taxaPercent) || 0) / 100;
    if (mode === 'cima') {
      return v * Math.pow(1 + i, n);
    }
    return v * Math.pow(1 - i, n);
  }

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
      const prazoEl = node.querySelector('.row-prazo');
      const unitEl = node.querySelector('.row-unit');
      const resultEl = node.querySelector('.row-result');
      const removeEl = node.querySelector('.row-remove');

      idxEl.textContent = `#${idx + 1}`;
      valorEl.value = cheque.valor === '' || cheque.valor == null ? '' : formatCurrencyStr(cheque.valor);
      prazoEl.value = cheque.prazo === '' || cheque.prazo == null ? '' : cheque.prazo;
      unitEl.textContent = unitLabel(state.unit);

      const result = calcCheque(cheque.valor, cheque.prazo, state.mode, state.taxa);
      resultEl.textContent = fmtMoney(result);

      valorEl.addEventListener('input', () => {
        state.cheques[idx].valor = applyCurrencyMask(valorEl);
        saveState();
        const r = calcCheque(state.cheques[idx].valor, state.cheques[idx].prazo, state.mode, state.taxa);
        resultEl.textContent = fmtMoney(r);
        renderTotals();
      });

      prazoEl.addEventListener('input', () => {
        state.cheques[idx].prazo = prazoEl.value === '' ? '' : Number(prazoEl.value);
        saveState();
        const r = calcCheque(state.cheques[idx].valor, state.cheques[idx].prazo, state.mode, state.taxa);
        resultEl.textContent = fmtMoney(r);
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
      final += calcCheque(c.valor, c.prazo, state.mode, state.taxa);
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
    state.cheques.push({ valor: '', prazo: '' });
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
    if (!valor || !qtd) return;
    for (let i = 1; i <= qtd; i++) {
      state.cheques.push({ valor, prazo: i });
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
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support best-effort */ });
    });
  }
})();
