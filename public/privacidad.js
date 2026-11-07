document.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", async () => {
  const t = document.getElementById(b.dataset.copy), lbl = b.textContent;
  try { await navigator.clipboard.writeText(t.textContent.trim()); b.textContent = "Copiado"; }
  catch (err) { const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = "Texto seleccionado: cópialo con Ctrl+C"; }
  setTimeout(() => { b.textContent = lbl; }, 2500);
}));
