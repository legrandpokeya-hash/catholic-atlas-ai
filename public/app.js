const statusEl = document.getElementById("status");
const listEl = document.getElementById("places-list");
const searchForm = document.getElementById("search-form");
const placeInput = document.getElementById("place-input");
const radiusInput = document.getElementById("radius-input");
const locateBtn = document.getElementById("locate-me");
const askAiBtn = document.getElementById("ask-ai");
const aiPromptEl = document.getElementById("ai-prompt");
const aiOutputEl = document.getElementById("ai-output");
const placeCard = document.getElementById("selected-place-card");
const placeCardBadge = document.getElementById("place-card-badge");
const placeCardName = document.getElementById("place-card-name");
const placeCardAddr = document.getElementById("place-card-addr");
const generatePlaceGuideBtn = document.getElementById("generate-place-guide");
const openAdminPlaceBtn = document.getElementById("open-admin-place");
const placeDetailsEl = document.getElementById("place-details");
const detailsMediaWrapEl = document.getElementById("details-media-wrap");
const detailsImageEl = document.getElementById("details-image");
const detailsPracticalEl = document.getElementById("details-practical");
const detailsContactsEl = document.getElementById("details-contacts");
const detailsSummaryEl = document.getElementById("details-summary");
const detailsNoteEl = document.getElementById("details-note");

let currentPlaces = [];
let currentLocationText = "";
let selectedPlace = null;
let activeListItem = null;

const map = L.map("map").setView([48.8566, 2.3522], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let markersLayer = L.layerGroup().addTo(map);
let searchCircle = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.borderLeftColor = isError ? "#9f2f2f" : "#b98b2f";
  statusEl.style.background = isError ? "#ffeaea" : "#fff7e5";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || data.error || "Erreur reseau");
  }
  return data;
}

function selectPlace(place) {
  selectedPlace = place;

  if (activeListItem) activeListItem.classList.remove("selected");
  const items = listEl.querySelectorAll("li[data-id]");
  items.forEach((li) => {
    if (Number(li.dataset.id) === place.id) {
      li.classList.add("selected");
      activeListItem = li;
      li.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  map.setView([place.lat, place.lon], 16);
  localStorage.setItem("catholicAtlasSelectedPlace", JSON.stringify(place));

  placeCardBadge.textContent = place.category;
  placeCardName.textContent = place.name;
  placeCardAddr.textContent = place.address || `Coordonnees : ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;
  placeCard.classList.remove("hidden");
  loadPlaceDetails(place);
  placeCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderDetailItems(target, items) {
  target.innerHTML = "";
  const available = items.filter((item) => item.value);

  if (!available.length) {
    target.innerHTML = "<li>Information non disponible.</li>";
    return;
  }

  available.forEach((item) => {
    const li = document.createElement("li");
    if (item.href) {
      li.innerHTML = `<strong>${escapeHtml(item.label)}:</strong> <a href="${escapeHtml(item.href)}" target="_blank" rel="noreferrer">${escapeHtml(item.value)}</a>`;
    } else {
      li.innerHTML = `<strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}`;
    }
    target.appendChild(li);
  });
}

async function loadPlaceDetails(place) {
  placeDetailsEl.classList.remove("hidden");
  detailsSummaryEl.textContent = "Chargement des informations utiles...";
  detailsNoteEl.textContent = "";
  detailsPracticalEl.innerHTML = "";
  detailsContactsEl.innerHTML = "";
  detailsMediaWrapEl.classList.add("hidden");
  detailsImageEl.removeAttribute("src");

  try {
    const details = await fetchJson("/api/place-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place })
    });

    renderDetailItems(detailsPracticalEl, [
      { label: "Horaires des messes", value: details.practical?.massTimes },
      { label: "Confessions", value: details.practical?.confessionTimes },
      { label: "Adoration", value: details.practical?.adorationTimes },
      { label: "Ouverture", value: details.practical?.openingHours },
      { label: "Acces PMR", value: details.practical?.wheelchair },
      { label: "Diocese / gestion", value: details.diocese },
      { label: "Dedicace", value: details.saint },
      { label: "Activites / description", value: details.practical?.description || details.parishActivities }
    ]);

    renderDetailItems(detailsContactsEl, [
      { label: "Telephone", value: details.contacts?.phone },
      { label: "Email", value: details.contacts?.email, href: details.contacts?.email ? `mailto:${details.contacts.email}` : "" },
      { label: "Site web", value: details.contacts?.website, href: details.contacts?.website },
      { label: "Facebook", value: details.contacts?.facebook, href: details.contacts?.facebook },
      { label: "Instagram", value: details.contacts?.instagram, href: details.contacts?.instagram },
      { label: "Wikipedia", value: details.contacts?.wikipedia, href: details.contacts?.wikipedia }
    ]);

    detailsSummaryEl.textContent = details.summary || "Aucun resume public disponible pour ce lieu.";
    if (details.adminMeta?.updatedAt) {
      detailsNoteEl.textContent = `${details.sourceNote || ""} Derniere mise a jour admin: ${new Date(details.adminMeta.updatedAt).toLocaleString("fr-FR")}.`;
    } else {
      detailsNoteEl.textContent = details.sourceNote || "";
    }

    if (details.media?.image) {
      detailsImageEl.src = details.media.image;
      detailsMediaWrapEl.classList.remove("hidden");
    }
  } catch (error) {
    detailsSummaryEl.textContent = "Impossible de charger les informations detaillees pour ce lieu.";
    detailsNoteEl.textContent = error.message;
  }
}

window.selectFromPopup = function (id) {
  const place = currentPlaces.find((p) => p.id === id);
  if (place) selectPlace(place);
};

function renderPlaces(places) {
  listEl.innerHTML = "";
  markersLayer.clearLayers();

  if (searchCircle) {
    map.removeLayer(searchCircle);
    searchCircle = null;
  }

  if (!places.length) {
    listEl.innerHTML = "<li>Aucun lieu trouve.</li>";
    return;
  }

  places.forEach((place) => {
    const li = document.createElement("li");
    li.dataset.id = place.id;
    const dist = place.distanceM != null
      ? (place.distanceM >= 1000
          ? ` &mdash; ${(place.distanceM / 1000).toFixed(1)} km`
          : ` &mdash; ${place.distanceM} m`)
      : "";
    li.innerHTML = `<strong>${place.name}</strong><br><small>${place.category}${dist}${place.address ? " &mdash; " + escapeHtml(place.address) : ""}</small>`;
    li.addEventListener("click", () => selectPlace(place));
    listEl.appendChild(li);

    const marker = L.marker([place.lat, place.lon]).bindPopup(
      `<strong>${place.name}</strong><br>${place.category}<br>${place.address || "Adresse non disponible"}<br><br><button class="popup-btn" onclick="selectFromPopup(${place.id})">&#10013; Choisir ce lieu</button>`
    );
    markersLayer.addLayer(marker);
  });
}

async function loadEditorialContent() {
  try {
    const data = await fetchJson("/api/content");
    const title = document.getElementById("hero-title");
    const subtitle = document.getElementById("hero-subtitle");
    const sug = document.getElementById("pilgrimage-suggestions");
    const tips = document.getElementById("tips-list");

    if (data.homeHero) {
      title.textContent = data.homeHero.title || title.textContent;
      subtitle.textContent = data.homeHero.subtitle || subtitle.textContent;
    }

    sug.innerHTML = "";
    (data.suggestedPilgrimages || []).forEach((p) => {
      const li = document.createElement("li");
      li.textContent = `${p.name}: ${p.why}`;
      sug.appendChild(li);
    });

    tips.innerHTML = "";
    (data.tips || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      tips.appendChild(li);
    });
  } catch {
    // Keep defaults if content loading fails.
  }
}

async function searchByCoordinates(lat, lon, radius, locationLabel = "") {
  setStatus("Recherche en cours...");
  const data = await fetchJson(`/api/places?lat=${lat}&lon=${lon}&radius=${radius}`);

  currentPlaces = data.places || [];
  selectedPlace = null;
  placeCard.classList.add("hidden");
  placeDetailsEl.classList.add("hidden");
  renderPlaces(currentPlaces);

  if (currentPlaces.length > 0) {
    map.setView([currentPlaces[0].lat, currentPlaces[0].lon], 12);
  } else {
    map.setView([lat, lon], 12);
  }

  searchCircle = L.circle([lat, lon], {
    radius,
    color: "#84401a",
    fillColor: "#b98b2f",
    fillOpacity: 0.1
  }).addTo(map);

  currentLocationText = locationLabel || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  setStatus(`${currentPlaces.length} lieu(x) catholique(s) trouve(s).`);
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocalisation non supportee."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    });
  });
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const place = placeInput.value.trim();
  const radius = Number(radiusInput.value || 15000);

  try {
    if (!place) {
      setStatus("Obtention de votre position...");
      const position = await getCurrentPosition();
      await searchByCoordinates(
        position.coords.latitude,
        position.coords.longitude,
        radius,
        "position actuelle"
      );
      return;
    }

    const geo = await fetchJson(`/api/geocode?place=${encodeURIComponent(place)}`);
    await searchByCoordinates(geo.lat, geo.lon, radius, geo.displayName);
  } catch (error) {
    setStatus(`Recherche impossible: ${error.message}`, true);
  }
});

locateBtn.addEventListener("click", async () => {
  setStatus("Obtention de votre position...");

  try {
    const position = await getCurrentPosition();
    const radius = Number(radiusInput.value || 15000);
    await searchByCoordinates(
      position.coords.latitude,
      position.coords.longitude,
      radius,
      "position actuelle"
    );
  } catch (error) {
    setStatus(`Impossible d'obtenir la position: ${error.message}`, true);
  }
});

generatePlaceGuideBtn.addEventListener("click", async () => {
  if (!selectedPlace) return;
  aiOutputEl.textContent = `Generation du guide spirituel pour "${selectedPlace.name}"...`;
  aiOutputEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

  try {
    const response = await fetchJson("/api/ai/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place: selectedPlace })
    });

    const source = response.from === "openai" ? "IA OpenAI" : "Mode local";
    aiOutputEl.textContent = `[${source}]\n\n${response.text}`;
  } catch (error) {
    aiOutputEl.textContent = `Erreur: ${error.message}`;
  }
});

openAdminPlaceBtn.addEventListener("click", () => {
  if (!selectedPlace) {
    return;
  }
  localStorage.setItem("catholicAtlasSelectedPlace", JSON.stringify(selectedPlace));
  window.open("/admin.html", "_blank");
});

askAiBtn.addEventListener("click", async () => {
  try {
    aiOutputEl.textContent = "Generation IA en cours...";

    const payload = {
      prompt: aiPromptEl.value.trim(),
      places: currentPlaces,
      locationText: currentLocationText
    };

    const response = await fetchJson("/api/ai/guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const source = response.from === "openai" ? "IA OpenAI" : "Mode local";
    aiOutputEl.textContent = `[${source}]\n\n${response.text}`;
  } catch (error) {
    aiOutputEl.textContent = `Erreur IA: ${error.message}`;
  }
});

loadEditorialContent();
