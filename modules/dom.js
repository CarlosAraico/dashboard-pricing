export function el(id) {
  return document.getElementById(id);
}

export function zebraify(tbodyId) {
  const tbody = el(tbodyId);
  if (tbody) tbody.classList.add("zebra");
}

export function renderEmptyRow(tbody, colspan, message) {
  if (!tbody) return;
  const tr = document.createElement("tr");
  tr.innerHTML = `<td class="py-3 px-3 text-center text-slate-500 dark:text-slate-400" colspan="${colspan}">${message}</td>`;
  tbody.appendChild(tr);
}

export function setAriaSort(headers, key, dir) {
  headers.forEach((th) => {
    const thKey = th.getAttribute("data-sort");
    if (!thKey) return;
    const value =
      thKey === key ? (dir === "asc" ? "ascending" : "descending") : "none";
    th.setAttribute("aria-sort", value);
  });
}
