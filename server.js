const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const fs = require("fs/promises");
const {
  buildExternalId,
  deleteAdminPlace,
  getAdminPlaceByExternalId,
  getDb,
  listAdminPlaces,
  mergeDetailsWithAdmin,
  upsertAdminPlace
} = require("./db");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "local-dev-admin";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const USER_AGENT = "CatholicAtlasAI/1.0 (educational-app)";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    let upstreamMessage = `Service externe indisponible (HTTP ${response.status}).`;

    if (contentType.includes("application/json")) {
      try {
        const body = await response.json();
        upstreamMessage = body?.error || body?.message || upstreamMessage;
      } catch {
        // Ignore JSON parsing errors and keep a safe generic message.
      }
    }

    throw new Error(upstreamMessage);
  }

  return response.json();
}

function normalizeFeature(el) {
  const lat = el.lat || (el.center && el.center.lat);
  const lon = el.lon || (el.center && el.center.lon);
  const tags = el.tags || {};
  const name = tags.name || "Lieu catholique";

  let category = "eglise";
  const lowerName = name.toLowerCase();
  if (lowerName.includes("basil") || lowerName.includes("basilica")) {
    category = "basilique";
  } else if (lowerName.includes("sanct") || lowerName.includes("shrine")) {
    category = "sanctuaire";
  } else if (lowerName.includes("paroiss") || lowerName.includes("parish")) {
    category = "paroisse";
  }

  return {
    id: el.id,
    osmType: el.type,
    name,
    category,
    lat,
    lon,
    address: [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"]]
      .filter(Boolean)
      .join(" "),
    tags
  };
}

function escapeOverpassRegex(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bste\.?\b/g, "sainte")
    .replace(/\bst\.?\b/g, "saint")
    .replace(/\bnd\b/g, "notre dame")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapScore(a, b) {
  const aTokens = normalizeSearchText(a).split(" ").filter(Boolean);
  const bTokens = normalizeSearchText(b).split(" ").filter(Boolean);

  if (!aTokens.length || !bTokens.length) {
    return 0;
  }

  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  let common = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      common += 1;
    }
  }

  return common / Math.max(setA.size, setB.size);
}

function scorePlaceCandidate(place, wantedName) {
  const rawName = String(place.name || "");
  const normalizedWanted = normalizeSearchText(wantedName);
  const normalizedName = normalizeSearchText(rawName);
  let score = 0;

  if (normalizedName === normalizedWanted) score += 8;
  if (normalizedName.includes(normalizedWanted)) score += 4;
  if (normalizedWanted.includes(normalizedName)) score += 2;

  const overlap = tokenOverlapScore(normalizedWanted, normalizedName);
  if (overlap >= 0.8) score += 4;
  else if (overlap >= 0.5) score += 2;
  else if (overlap > 0) score += 1;

  if (place.tags?.denomination && String(place.tags.denomination).toLowerCase().includes("cath")) score += 2;
  if (place.tags?.religion && String(place.tags.religion).toLowerCase().includes("christ")) score += 1;

  return score;
}

function pickBestPlaceCandidate(candidates, wantedName) {
  if (!candidates.length) {
    return null;
  }

  const scored = candidates
    .map((place) => ({ place, score: scorePlaceCandidate(place, wantedName) }))
    .sort((a, b) => b.score - a.score);

  return scored[0].place;
}

function buildNameRegexAlternatives(name) {
  const raw = String(name || "").trim();
  const normalized = normalizeSearchText(raw);
  const variants = new Set([raw]);

  if (normalized) {
    variants.add(normalized.replace(/\bsaint\b/g, "st"));
    variants.add(normalized.replace(/\bsainte\b/g, "ste"));
    variants.add(normalized.replace(/\bnotre dame\b/g, "nd"));
  }

  return Array.from(variants)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => escapeOverpassRegex(v));
}

async function findCatholicPlaceByName(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    return null;
  }

  // Geocode first, then score catholic places around this point.
  // This is more reliable than a global name regex query on Overpass.
  let geo;
  try {
    geo = await geocodePlace(cleanName);
  } catch {
    return null;
  }

  const fallbackRadii = [8000, 12000, 16000];
  for (const r of fallbackRadii) {
    try {
      const around = await queryCatholicPlaces(geo.lat, geo.lon, r);
      const best = pickBestPlaceCandidate(around, cleanName);
      if (best) {
        return best;
      }
    } catch {
      // Continue with the next radius to tolerate transient Overpass failures.
    }
  }

  return null;
}

function getFirstTag(tags, keys) {
  for (const key of keys) {
    if (tags[key]) {
      return String(tags[key]).trim();
    }
  }
  return "";
}

function normalizeExternalUrl(value) {
  if (!value) {
    return "";
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

async function getWikipediaSummary(tags) {
  let language = "fr";
  let title = "";

  if (tags.wikipedia) {
    const [lang, ...rest] = String(tags.wikipedia).split(":");
    if (rest.length > 0) {
      language = lang || "fr";
      title = rest.join(":");
    } else {
      title = String(tags.wikipedia);
    }
  }

  if (!title && tags.wikidata) {
    try {
      const wikidataUrl = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(tags.wikidata)}.json`;
      const wikidata = await fetchJson(wikidataUrl);
      const entity = wikidata.entities?.[tags.wikidata];
      const frWiki = entity?.sitelinks?.frwiki?.title;
      const enWiki = entity?.sitelinks?.enwiki?.title;
      title = frWiki || enWiki || "";
      language = frWiki ? "fr" : "en";
    } catch {
      return null;
    }
  }

  if (!title) {
    return null;
  }

  try {
    const url = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const data = await fetchJson(url);
    return {
      title: data.title || title,
      summary: data.extract || "",
      image: data.thumbnail?.source || data.originalimage?.source || "",
      url: data.content_urls?.desktop?.page || `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title)}`
    };
  } catch {
    return null;
  }
}

async function buildPlaceDetails(place) {
  const tags = place.tags || {};
  const wikipedia = await getWikipediaSummary(tags);
  const imageUrl = getFirstTag(tags, ["image", "image:0"]);

  const baseDetails = {
    externalId: buildExternalId(place),
    name: place.name,
    category: place.category,
    address: place.address,
    coordinates: `${place.lat}, ${place.lon}`,
    denomination: getFirstTag(tags, ["denomination"]),
    diocese: getFirstTag(tags, ["diocese", "operator"]),
    saint: getFirstTag(tags, ["dedication", "subject:wikidata"]),
    practical: {
      massTimes: getFirstTag(tags, ["mass_times", "service_times"]),
      confessionTimes: getFirstTag(tags, ["confession_times"]),
      adorationTimes: getFirstTag(tags, ["adoration_hours"]),
      openingHours: getFirstTag(tags, ["opening_hours"]),
      wheelchair: getFirstTag(tags, ["wheelchair"]),
      description: getFirstTag(tags, ["description", "note"])
    },
    contacts: {
      phone: getFirstTag(tags, ["phone", "contact:phone"]),
      email: getFirstTag(tags, ["email", "contact:email"]),
      website: normalizeExternalUrl(getFirstTag(tags, ["website", "contact:website"])),
      facebook: normalizeExternalUrl(getFirstTag(tags, ["contact:facebook", "facebook"])),
      instagram: normalizeExternalUrl(getFirstTag(tags, ["contact:instagram", "instagram"])),
      wikipedia: wikipedia?.url || ""
    },
    media: {
      image: imageUrl || wikipedia?.image || ""
    },
    parishActivities: getFirstTag(tags, ["community_centre:for", "description"]),
    summary: wikipedia?.summary || "",
    sourceNote: "Les horaires, contacts et activites dependent des donnees publiques disponibles. Beaucoup de paroisses ne publient pas encore toutes ces informations dans OpenStreetMap."
  };

  const adminDetails = await getAdminPlaceByExternalId(baseDetails.externalId);
  return mergeDetailsWithAdmin(baseDetails, adminDetails);
}

function requireAdmin(req, res, next) {
  const adminKey = req.header("x-admin-key") || req.query.adminKey;
  if (!adminKey || adminKey !== ADMIN_SECRET) {
    return res.status(401).json({ error: "Acces admin refuse" });
  }
  return next();
}

async function geocodePlace(place) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`;
  const data = await fetchJson(url);

  if (!data || data.length === 0) {
    throw new Error("Aucun resultat de geocodage");
  }

  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
    displayName: data[0].display_name
  };
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function queryCatholicPlaces(lat, lon, radius = 15000) {
  const safeRadius = Math.min(Math.max(Number(radius) || 15000, 1000), 50000);

  const strictQuery = `
[out:json][timeout:25];
(
  node["amenity"="place_of_worship"]["religion"="christian"]["denomination"="catholic"](around:${safeRadius},${lat},${lon});
  way["amenity"="place_of_worship"]["religion"="christian"]["denomination"="catholic"](around:${safeRadius},${lat},${lon});
  relation["amenity"="place_of_worship"]["religion"="christian"]["denomination"="catholic"](around:${safeRadius},${lat},${lon});
  node["historic"="wayside_shrine"](around:${safeRadius},${lat},${lon});
);
out center tags;
`;

  async function runOverpassQuery(query) {
    let lastError = null;

    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        return await fetchJson(endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: query
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Service cartographique temporairement indisponible.");
  }

  const strictData = await runOverpassQuery(strictQuery);

  let elements = strictData.elements || [];

  if (!elements.length) {
    const relaxedQuery = `
[out:json][timeout:25];
(
  node["amenity"="place_of_worship"]["religion"~"christian|catholic",i](around:${safeRadius},${lat},${lon});
  way["amenity"="place_of_worship"]["religion"~"christian|catholic",i](around:${safeRadius},${lat},${lon});
  relation["amenity"="place_of_worship"]["religion"~"christian|catholic",i](around:${safeRadius},${lat},${lon});
  node["historic"="wayside_shrine"](around:${safeRadius},${lat},${lon});
);
out center tags;
`;

    const relaxedData = await runOverpassQuery(relaxedQuery);

    elements = relaxedData.elements || [];
  }

  return elements
    .map(normalizeFeature)
    .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))
    .map((f) => ({ ...f, distanceM: Math.round(haversineDistance(lat, lon, f.lat, f.lon)) }))
    .sort((a, b) => a.distanceM - b.distanceM);
}

function buildFallbackAiPlaceResponse(place) {
  const cat = place.category === "sanctuaire" ? "sanctuaire" : "eglise";
  return [
    `=== GUIDE SPIRITUEL : ${place.name} ===`,
    `Type : ${cat}${place.address ? "\nAdresse : " + place.address : ""}`,
    `1. HISTOIRE & SIGNIFICATION SPIRITUELLE\nCe lieu catholique est un espace sacre de priere et de recueillement. Les eglises et sanctuaires sont des portes ouvertes vers Dieu, la celebration des sacrements et la communion fraternelle.`,
    `2. PROGRAMME DE VISITE SUGGERE\n• Arriver en silence, s'arreter a l'entree pour un moment de recueillement.\n• Allumer un cierge : signe de priere et d'intercession.\n• Parcourir le chemin de croix si present.\n• Participer a une messe ou un temps d'adoration eucharistique.\n• Profiter du sacrement de la reconciliation (horaires a verifier).`,
    `3. PRIERES RECOMMANDEES\n• Notre Pere, Je vous salue Marie\n• Acte de contrition\n• Chapelet (mysteres joyeux le lundi/samedi, douloureux mardi/vendredi, glorieux mercredi/dimanche)`,
    `4. CONSEILS PRATIQUES\n• Verifiez les horaires des messes sur le site de la paroisse.\n• Adoptez une tenue correcte et discrete.\n• Eteignez votre telephone avant d'entrer.\n• Respectez le silence liturgique.`,
    `5. A PROXIMITE\nRecherchez d'autres eglises catholiques dans un rayon de quelques kilometres via la carte.`,
    `[Mode local - Ajoutez une cle OpenAI dans .env pour des guides personnalises et detailles]`
  ].join("\n\n");
}

async function callOpenAiForPlace(place) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { from: "fallback", text: buildFallbackAiPlaceResponse(place) };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const details = await buildPlaceDetails(place);

  const system = `Tu es un guide expert en pelerinage catholique, historien de l'art sacre et conseiller spirituel. Pour chaque lieu demande, genere un guide spirituel complet en francais, structure en 5 sections:
1. HISTOIRE & SIGNIFICATION SPIRITUELLE
2. PROGRAMME DE VISITE DETAILLE (avec timing indicatif)
3. PRIERES ET DEVOCIONS ADAPTEES au lieu
4. CONSEILS PRATIQUES (horaires probables, tenue, transport, accessibilite)
5. LIEUX CATHOLIQUES PROCHES A VISITER
Sois precis, chaleureux et respectueux. Utilise des sous-titres lisibles. Quand une information pratique est disponible, affiche-la explicitement: horaires de messe, confession, adoration, site, telephone, email, acces PMR, activites. Quand elle manque, dis clairement "information non disponible".`;

  const user = `Genere un guide spirituel complet pour ce lieu catholique:
Nom: ${place.name}
Type: ${place.category}
Adresse: ${place.address || "inconnue"}
Coordonnees: ${place.lat}, ${place.lon}
Tags OpenStreetMap: ${JSON.stringify(place.tags || {})}
Donnees pratiques deja extraites: ${JSON.stringify(details)}`;

  const response = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  const text = response.choices?.[0]?.message?.content?.trim() || "Pas de reponse IA.";
  return { from: "openai", text };
}

function buildFallbackAiResponse({ userPrompt, places, userLocationText }) {
  const top = places.slice(0, 5);
  const itinerary = top
    .map((p, i) => `${i + 1}. ${p.name} (${p.category})`)
    .join("\n");

  return [
    `Voici une proposition sans API externe pour: ${userPrompt || "pelerinage catholique"}.`,
    userLocationText ? `Zone analysee: ${userLocationText}.` : "Zone analysee: votre recherche en cours.",
    "Itineraire conseille:",
    itinerary || "Aucun lieu disponible pour proposer un itineraire.",
    "Conseil: verifiez les horaires de messe avant la visite."
  ].join("\n\n");
}

async function callOpenAi({ userPrompt, places, userLocationText }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { from: "fallback", text: buildFallbackAiResponse({ userPrompt, places, userLocationText }) };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const placeBrief = places.slice(0, 20).map((p) => ({
    name: p.name,
    category: p.category,
    lat: p.lat,
    lon: p.lon,
    address: p.address
  }));

  const system = "Tu es un guide catholique et logistique de pelerinage. Reponds en francais, de maniere claire, concise et respectueuse. Inclure un mini-plan de visite et des conseils pratiques.";

  const user = {
    question: userPrompt || "Propose un parcours spirituel.",
    location: userLocationText || "non specifie",
    places: placeBrief
  };

  const response = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ]
    })
  });

  const text = response.choices?.[0]?.message?.content?.trim() || "Pas de reponse IA.";
  return { from: "openai", text };
}

app.get("/api/content", async (_req, res) => {
  try {
    const raw = await fs.readFile(path.join(__dirname, "content", "editorial-content.json"), "utf8");
    res.json(JSON.parse(raw));
  } catch (error) {
    res.status(200).json({
      hero: {
        title: "Catholic Atlas AI",
        subtitle: "Trouvez des eglises et sanctuaires catholiques"
      },
      suggestions: ["Lourdes", "Rome", "Fatima"],
      tips: []
    });
  }
});

app.get("/api/geocode", async (req, res) => {
  try {
    const place = (req.query.place || "").toString().trim();
    if (!place) {
      return res.status(400).json({ error: "Parametre 'place' requis" });
    }

    const result = await geocodePlace(place);
    return res.json(result);
  } catch (error) {
    if (error.message && error.message.includes("Aucun resultat de geocodage")) {
      return res.status(404).json({ error: "Lieu non trouve" });
    }
    return res.status(500).json({ error: "Erreur geocodage" });
  }
});

app.get("/api/place-search", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    const radius = Number(req.query.radius || 15000);

    if (!name) {
      return res.status(400).json({ error: "Parametre 'name' requis" });
    }

    const matched = await findCatholicPlaceByName(name);
    if (!matched) {
      return res.status(404).json({ error: "Lieu non trouve" });
    }

    const nearby = await queryCatholicPlaces(matched.lat, matched.lon, radius);
    const hasMatched = nearby.some((p) => p.id === matched.id && p.osmType === matched.osmType);
    const places = hasMatched ? nearby : [{ ...matched, distanceM: 0 }, ...nearby];

    return res.json({
      matched,
      places,
      locationText: matched.address || `${matched.lat.toFixed(5)}, ${matched.lon.toFixed(5)}`
    });
  } catch {
    return res.status(500).json({ error: "Erreur recherche lieu" });
  }
});

app.get("/api/places", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radius = Number(req.query.radius || 15000);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: "Parametres lat/lon invalides" });
    }

    const places = await queryCatholicPlaces(lat, lon, radius);
    return res.json({ count: places.length, places });
  } catch (error) {
    return res.status(503).json({
      error: "Recherche des lieux temporairement indisponible",
      detail: error.message
    });
  }
});

app.get("/api/admin/config", (_req, res) => {
  res.json({
    hasDefaultSecret: ADMIN_SECRET === "local-dev-admin",
    message: ADMIN_SECRET === "local-dev-admin"
      ? "La cle admin utilise encore la valeur locale par defaut. Definissez ADMIN_SECRET dans .env avant publication."
      : "Configuration admin chargee."
  });
});

app.get("/api/admin/places", requireAdmin, async (req, res) => {
  try {
    const results = await listAdminPlaces(String(req.query.q || ""));
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: "Erreur liste admin", detail: error.message });
  }
});

app.get("/api/admin/places/:externalId", requireAdmin, async (req, res) => {
  try {
    const entry = await getAdminPlaceByExternalId(req.params.externalId);
    if (!entry) {
      return res.status(404).json({ error: "Fiche admin introuvable" });
    }
    return res.json(entry);
  } catch (error) {
    return res.status(500).json({ error: "Erreur fiche admin", detail: error.message });
  }
});

app.post("/api/admin/places", requireAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.name) {
      return res.status(400).json({ error: "Le nom du lieu est requis" });
    }
    const saved = await upsertAdminPlace(payload);
    return res.json(saved);
  } catch (error) {
    return res.status(500).json({ error: "Erreur sauvegarde admin", detail: error.message });
  }
});

app.delete("/api/admin/places/:externalId", requireAdmin, async (req, res) => {
  try {
    await deleteAdminPlace(req.params.externalId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Erreur suppression admin", detail: error.message });
  }
});

app.post("/api/ai/guide", async (req, res) => {
  try {
    const { prompt, places, locationText } = req.body || {};

    const ai = await callOpenAi({
      userPrompt: String(prompt || ""),
      places: Array.isArray(places) ? places : [],
      userLocationText: String(locationText || "")
    });

    res.json(ai);
  } catch (error) {
    res.status(500).json({ error: "Erreur assistant IA", detail: error.message });
  }
});

app.post("/api/ai/place", async (req, res) => {
  try {
    const { place } = req.body || {};
    if (!place || !place.name) {
      return res.status(400).json({ error: "Champ 'place' requis" });
    }
    const ai = await callOpenAiForPlace(place);
    res.json(ai);
  } catch (error) {
    res.status(500).json({ error: "Erreur assistant IA lieu", detail: error.message });
  }
});

app.post("/api/place-details", async (req, res) => {
  try {
    const { place } = req.body || {};
    if (!place || !place.name) {
      return res.status(400).json({ error: "Champ 'place' requis" });
    }

    const details = await buildPlaceDetails(place);
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: "Erreur details lieu", detail: error.message });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function startServer() {
  // Démarrer le serveur HTTP immédiatement pour répondre au health check Render
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Catholic Atlas AI demarre sur http://localhost:${PORT}`);
  });

  // Initialiser la base de données en arrière-plan
  try {
    await getDb();
    // eslint-disable-next-line no-console
    console.log("Base de donnees SQLite initialisee.");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Erreur initialisation SQLite (non bloquante):", error.message);
  }
}

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Echec de demarrage de Catholic Atlas AI:", error);
  process.exit(1);
});
