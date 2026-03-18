const STORAGE_SECRET_KEY = "catholicAtlasAdminSecret";
const STORAGE_PLACE_KEY = "catholicAtlasSelectedPlace";

const adminSecretEl = document.getElementById("admin-secret");
const configMessageEl = document.getElementById("config-message");
const saveSecretBtn = document.getElementById("save-secret");
const loadSelectedBtn = document.getElementById("load-selected");
const searchQueryEl = document.getElementById("search-query");
const searchBtn = document.getElementById("search-btn");
const searchResultsEl = document.getElementById("search-results");
const adminForm = document.getElementById("admin-form");
const formStatusEl = document.getElementById("form-status");
const deleteBtn = document.getElementById("delete-btn");
const newBtn = document.getElementById("new-btn");

function getAdminSecret() {
  return adminSecretEl.value.trim();
}

function setMessage(target, text, isError = false) {
  target.textContent = text;
  target.style.borderLeftColor = isError ? "#8a241d" : "#b98b2f";
  target.style.background = isError ? "#ffe9e5" : "#fff7e5";
}

async function fetchJson(url, options = {}, needsAuth = false) {
  const headers = { ...(options.headers || {}) };
  if (needsAuth) {
    headers["x-admin-key"] = getAdminSecret();
  }

  const response = await fetch(url, { ...options, headers });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || data.error || "Erreur reseau");
  }

  return data;
}

function serializeForm() {
  const formData = new FormData(adminForm);
  return Object.fromEntries(formData.entries());
}

function fillForm(data = {}) {
  const mapping = {
    externalId: data.externalId || "",
    osmType: data.osmType || "",
    osmId: data.osmId || "",
    name: data.name || "",
    category: data.category || "eglise",
    address: data.address || "",
    lat: data.lat || "",
    lon: data.lon || "",
    massTimes: data.practical?.massTimes || data.massTimes || "",
    confessionTimes: data.practical?.confessionTimes || data.confessionTimes || "",
    adorationTimes: data.practical?.adorationTimes || data.adorationTimes || "",
    openingHours: data.practical?.openingHours || data.openingHours || "",
    activities: data.parishActivities || data.activities || "",
    phone: data.contacts?.phone || data.phone || "",
    email: data.contacts?.email || data.email || "",
    website: data.contacts?.website || data.website || "",
    facebook: data.contacts?.facebook || data.facebook || "",
    instagram: data.contacts?.instagram || data.instagram || "",
    imageUrl: data.media?.image || data.imageUrl || "",
    summary: data.summary || "",
    notes: data.practical?.description || data.notes || "",
    adminComment: data.adminComment || "",
    sourceLabel: data.sourceLabel || "Fiche admin"
  };

  Object.entries(mapping).forEach(([key, value]) => {
    const field = adminForm.elements.namedItem(key);
    if (field) {
      field.value = value;
    }
  });
}

function resetForm() {
  adminForm.reset();
  fillForm({ category: "eglise", sourceLabel: "Fiche admin" });
}

function renderSearchResults(results) {
  searchResultsEl.innerHTML = "";
  if (!results.length) {
    searchResultsEl.innerHTML = "<li>Aucune fiche admin.</li>";
    return;
  }

  results.forEach((result) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${result.name}</strong><br><small>${result.category || ""} ${result.address ? "- " + result.address : ""}</small>`;
    li.addEventListener("click", () => loadEntry(result.externalId));
    searchResultsEl.appendChild(li);
  });
}

async function loadConfig() {
  try {
    const config = await fetchJson("/api/admin/config");
    setMessage(configMessageEl, config.message, config.hasDefaultSecret);
  } catch (error) {
    setMessage(configMessageEl, error.message, true);
  }
}

async function searchEntries() {
  try {
    const query = encodeURIComponent(searchQueryEl.value.trim());
    const data = await fetchJson(`/api/admin/places?q=${query}`, {}, true);
    renderSearchResults(data.results || []);
  } catch (error) {
    setMessage(formStatusEl, error.message, true);
  }
}

async function loadEntry(externalId) {
  try {
    const data = await fetchJson(`/api/admin/places/${encodeURIComponent(externalId)}`, {}, true);
    fillForm(data);
    setMessage(formStatusEl, `Fiche chargee: ${data.name}`);
  } catch (error) {
    setMessage(formStatusEl, error.message, true);
  }
}

function loadSelectedPlaceDraft() {
  const raw = localStorage.getItem(STORAGE_PLACE_KEY);
  if (!raw) {
    setMessage(formStatusEl, "Aucun lieu selectionne depuis l'application principale.", true);
    return;
  }

  try {
    const place = JSON.parse(raw);
    fillForm({
      externalId: `${place.osmType || "osm"}:${place.id || place.osmId || "manual"}`,
      osmType: place.osmType || "",
      osmId: place.id || place.osmId || "",
      name: place.name,
      category: place.category,
      address: place.address,
      lat: place.lat,
      lon: place.lon,
      summary: "",
      sourceLabel: "Selection importee depuis la carte"
    });
    setMessage(formStatusEl, `Lieu importe: ${place.name}`);
  } catch (error) {
    setMessage(formStatusEl, error.message, true);
  }
}

saveSecretBtn.addEventListener("click", () => {
  localStorage.setItem(STORAGE_SECRET_KEY, getAdminSecret());
  setMessage(configMessageEl, "Cle admin enregistree dans ce navigateur.");
});

loadSelectedBtn.addEventListener("click", () => {
  loadSelectedPlaceDraft();
});

searchBtn.addEventListener("click", () => {
  searchEntries();
});

adminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = serializeForm();
    const saved = await fetchJson("/api/admin/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, true);
    fillForm(saved);
    setMessage(formStatusEl, `Fiche enregistree: ${saved.name}`);
    searchEntries();
  } catch (error) {
    setMessage(formStatusEl, error.message, true);
  }
});

deleteBtn.addEventListener("click", async () => {
  const externalId = adminForm.elements.namedItem("externalId").value;
  if (!externalId) {
    setMessage(formStatusEl, "Aucune fiche a supprimer.", true);
    return;
  }

  if (!window.confirm("Supprimer cette fiche admin ?")) {
    return;
  }

  try {
    await fetchJson(`/api/admin/places/${encodeURIComponent(externalId)}`, { method: "DELETE" }, true);
    resetForm();
    setMessage(formStatusEl, "Fiche supprimee.");
    searchEntries();
  } catch (error) {
    setMessage(formStatusEl, error.message, true);
  }
});

newBtn.addEventListener("click", () => {
  resetForm();
  setMessage(formStatusEl, "Nouvelle fiche prete.");
});

(function bootstrap() {
  const savedSecret = localStorage.getItem(STORAGE_SECRET_KEY) || "";
  adminSecretEl.value = savedSecret;
  resetForm();
  loadConfig();
  if (savedSecret) {
    searchEntries();
  }
})();
