// assets/app.js
// All logic lives here: fetch, render, filters, pagination, events, localStorage, theme.

(() => {
  const CFG = window.IFR_CONFIG || {};
  const API_BASE = CFG.API_BASE;
  const FETCH_TOP = CFG.FETCH_TOP ?? 500;
  const PAGE_SIZE = CFG.PAGE_SIZE ?? 50;
  const MAX_VISIBLE_PAGES = CFG.MAX_VISIBLE_PAGES ?? 10;
  const THEME_KEY = CFG.THEME_KEY ?? "ifr_theme_v3";
  const STORE_KEY = CFG.STORE_KEY ?? "ifr_state_v3";

  const el = (id) => document.getElementById(id);

  // ---------- Theme (light default) ----------
  function updateThemeButton(theme){
    const btn = el("themeBtn");
    if(!btn) return;
    btn.textContent = theme === "dark" ? "Dark" : "Light";
    btn.title = theme === "dark" ? "Switch to Light" : "Switch to Dark";
  }
  function initTheme(){
    const saved = localStorage.getItem(THEME_KEY);
    const theme = (saved === "dark" || saved === "light") ? saved : "light";
    document.documentElement.setAttribute("data-theme", theme);
    updateThemeButton(theme);
  }
  function toggleTheme(){
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
    updateThemeButton(next);
  }

  // ---------- Store read/star (device-only) ----------
  function loadStore(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      if(!raw) return { read:{}, star:{} };
      const obj = JSON.parse(raw);
      return {
        read: obj.read && typeof obj.read === "object" ? obj.read : {},
        star: obj.star && typeof obj.star === "object" ? obj.star : {}
      };
    }catch{
      return { read:{}, star:{} };
    }
  }
  const store = loadStore();
  function saveStore(){ localStorage.setItem(STORE_KEY, JSON.stringify(store)); }

  // ---------- App state ----------
  let state = {
    q: "",
    source: "",
    topic: "",
    hideRead: false,
    starOnly: false,
    data: null,
    fetchedAt: null,
    page: 1
  };

  // ---------- Utilities ----------
  function escapeHtml(str){
    return String(str ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
  function hostFromUrl(url){
    try { return new URL(url).hostname.replace(/^www\./,""); }
    catch { return ""; }
  }
  function fmtTime(d){
    try{ return d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }); }
    catch{ return "—"; }
  }
  function fmtDate(iso){
    if(!iso) return "";
    try{
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
    }catch{ return ""; }
  }
  function uniqSorted(arr){
    return Array.from(new Set(arr)).sort((a,b)=> a.localeCompare(b));
  }

  // ---------- Filters + Pagination ----------
  function buildFilters(items){
    const sources = uniqSorted(items.map(it => it.feed?.title).filter(Boolean));
    const topics  = uniqSorted(items.flatMap(it => Array.isArray(it.tags) ? it.tags : []).filter(Boolean));

    const sourceSel = el("sourceSel");
    const topicSel = el("topicSel");

    const prevSource = state.source;
    const prevTopic = state.topic;

    sourceSel.innerHTML = `<option value="">All Sources</option>` +
      sources.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");

    topicSel.innerHTML = `<option value="">All Topics</option>` +
      topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

    if(prevSource) sourceSel.value = prevSource;
    if(prevTopic) topicSel.value = prevTopic;
  }

  function applyFilters(items){
    const q = state.q.trim().toLowerCase();
    const src = state.source;
    const topic = state.topic;

    return items.filter(it => {
      if(src && (it.feed?.title || "") !== src) return false;
      if(topic && !(Array.isArray(it.tags) && it.tags.includes(topic))) return false;

      const id = String(it.id ?? "");
      const isRead = !!store.read[id];
      const isStar = !!store.star[id];

      if(state.hideRead && isRead) return false;
      if(state.starOnly && !isStar) return false;

      if(!q) return true;

      const hay = [
        it.title || "",
        it.feed?.title || "",
        hostFromUrl(it.url || ""),
        Array.isArray(it.tags) ? it.tags.join(" ") : ""
      ].join(" ").toLowerCase();

      return hay.includes(q);
    });
  }

  function clampPage(p, totalPages){
    if(totalPages <= 0) return 1;
    return Math.max(1, Math.min(totalPages, p));
  }

  function getPaged(items){
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    state.page = clampPage(state.page, totalPages);
    const start = (state.page - 1) * PAGE_SIZE;
    return { pageItems: items.slice(start, start + PAGE_SIZE), totalPages };
  }

  function renderPagination(totalPages){
    el("pageMeta").textContent = `Page ${state.page} of ${totalPages}`;
    const box = el("pageBtns");

    const visiblePages = Math.min(totalPages, MAX_VISIBLE_PAGES);
    const parts = [];

    parts.push(`<button class="pageBtn" data-page="prev" ${state.page===1?"disabled":""}>Prev</button>`);
    for(let p=1; p<=visiblePages; p++){
      parts.push(`<button class="pageBtn ${p===state.page?"active":""}" data-page="${p}">${p}</button>`);
    }
    parts.push(`<button class="pageBtn" data-page="next" ${state.page===totalPages?"disabled":""}>Next</button>`);

    box.innerHTML = parts.join("");
    box.querySelectorAll(".pageBtn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const v = btn.getAttribute("data-page");
        if(v === "prev") state.page = Math.max(1, state.page - 1);
        else if(v === "next") state.page = Math.min(totalPages, state.page + 1);
        else state.page = parseInt(v, 10) || 1;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  // ---------- Render ----------
  function render(){
    const content = el("content");
    if(!state.data){
      content.className = "state";
      content.textContent = "Fetching items…";
      return;
    }

    const allItems = Array.isArray(state.data.items) ? state.data.items : [];
    const filtered = applyFilters(allItems);

    const sourcesCount = new Set(allItems.map(it => it.feed?.title).filter(Boolean)).size;
    const lastUpdated = state.fetchedAt ? fmtTime(state.fetchedAt) : "—";

    el("heroSub").textContent =
      `${allItems.length} news articles from ${sourcesCount} sources · Last updated: ${lastUpdated}`;

    el("metaLeft").innerHTML =
      `Showing <strong>${filtered.length}</strong> of <strong>${allItems.length}</strong>`;

    el("metaRightA").textContent = state.source ? `Source: ${state.source}` : "Source: All";
    el("metaRightB").textContent = state.topic ? `Topic: ${state.topic}` : "Topic: All";

    if(filtered.length === 0){
      renderPagination(1);
      content.className = "state";
      content.textContent = "No results match your filters.";
      return;
    }

    const { pageItems, totalPages } = getPaged(filtered);
    renderPagination(totalPages);

    const parts = [];
    parts.push(`<div class="list">`);
    for(const it of pageItems) parts.push(renderItem(it));
    parts.push(`</div>`);

    content.className = "";
    content.innerHTML = parts.join("");
    wireCardButtons();
  }

  function renderItem(it){
    const id = String(it.id ?? "");
    const title = escapeHtml(it.title || "");
    const url = it.url || "#";
    const feedTitle = escapeHtml(it.feed?.title || hostFromUrl(url) || "Source");
    const domain = escapeHtml(hostFromUrl(url));
    const when = fmtDate(it.published_at);

    const tags = Array.isArray(it.tags) ? it.tags.slice(0, 3) : [];
    const tagChips = tags.map(t => `<span class="chip">#${escapeHtml(t)}</span>`).join("");

    const isRead = !!store.read[id];
    const isStar = !!store.star[id];

    return `
      <div class="card ${isRead ? "read" : ""}" data-id="${escapeHtml(id)}">
        <div class="cardTop">
          <h3 class="headline">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>
          </h3>
          <div class="actions">
            <button class="mini ${isStar ? "starred" : ""}" data-action="star">${isStar ? "Starred" : "Star"}</button>
            <button class="mini ${isRead ? "read" : ""}" data-action="read">${isRead ? "Read" : "Mark read"}</button>
          </div>
        </div>

        <div class="sub">
          <span class="chip">📰 ${feedTitle}</span>
          ${domain ? `<span class="pillSmall">${domain}</span>` : ""}
          ${when ? `<span class="pillSmall">${escapeHtml(when)}</span>` : ""}
          ${tagChips}
        </div>
      </div>
    `;
  }

  function wireCardButtons(){
    document.querySelectorAll(".card .mini").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        e.preventDefault(); e.stopPropagation();
        const action = btn.dataset.action;
        const card = btn.closest(".card");
        const id = card?.dataset?.id;
        if(!id) return;

        if(action === "read") store.read[id] = !store.read[id];
        if(action === "star") store.star[id] = !store.star[id];

        saveStore();
        render();
      });
    });

    document.querySelectorAll(".card .headline a").forEach(a=>{
      a.addEventListener("click", ()=>{
        const card = a.closest(".card");
        const id = card?.dataset?.id;
        if(!id) return;
        store.read[id] = true;
        saveStore();
      });
    });
  }

  // ---------- Fetch ----------
  async function fetchCandidates(){
    const url = new URL(API_BASE);
    url.searchParams.set("top", String(FETCH_TOP)); // 500
    const resp = await fetch(url.toString(), { cache: "no-store" });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("API did not return JSON."); }

    if(!resp.ok){
      const msg = data?.error ? `${data.error}` : `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function fetchAndRender(){
    const content = el("content");
    content.className = "state";
    content.textContent = "Fetching items…";

    try{
      const data = await fetchCandidates();
      state.data = data;
      state.fetchedAt = new Date();
      state.page = 1;

      const items = Array.isArray(data.items) ? data.items : [];
      buildFilters(items);
      render();
    }catch(err){
      state.data = null;
      content.className = "state";
      content.textContent = `Failed to load: ${err.message || err}`;
      el("heroSub").textContent = `Error: ${err.message || err}`;
    }
  }

  // ---------- Events ----------
  el("q").addEventListener("input", (e)=> { state.q = e.target.value; state.page = 1; render(); });
  el("sourceSel").addEventListener("change", (e)=> { state.source = e.target.value; state.page = 1; render(); });
  el("topicSel").addEventListener("change", (e)=> { state.topic = e.target.value; state.page = 1; render(); });

  el("hideRead").addEventListener("change", (e)=> { state.hideRead = e.target.checked; state.page = 1; render(); });
  el("starOnly").addEventListener("change", (e)=> { state.starOnly = e.target.checked; state.page = 1; render(); });

  el("refreshBtn").addEventListener("click", fetchAndRender);
  el("themeBtn").addEventListener("click", toggleTheme);

  window.addEventListener("keydown", (e)=>{
    if(e.key === "/" && document.activeElement !== el("q")){
      e.preventDefault(); el("q").focus();
    }
    if(e.key === "Escape"){
      el("q").value = ""; state.q = ""; state.page = 1; render(); el("q").blur();
    }
  });

  // ---------- Boot ----------
  initTheme();
  fetchAndRender();
})();
