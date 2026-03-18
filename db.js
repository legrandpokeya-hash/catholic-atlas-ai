const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "data", "catho-atlas.sqlite");
let dbPromise;

function clean(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function buildExternalId(place = {}) {
  if (place.externalId) {
    return String(place.externalId);
  }

  const osmType = place.osmType || place.osm_type || "osm";
  const osmId = place.osmId || place.osm_id || place.id || "manual";
  return `${osmType}:${osmId}`;
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
  }

  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_places (
      external_id TEXT PRIMARY KEY,
      osm_type TEXT,
      osm_id TEXT,
      name TEXT NOT NULL,
      category TEXT,
      address TEXT,
      lat REAL,
      lon REAL,
      mass_times TEXT,
      confession_times TEXT,
      adoration_times TEXT,
      opening_hours TEXT,
      activities TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      facebook TEXT,
      instagram TEXT,
      image_url TEXT,
      summary TEXT,
      notes TEXT,
      admin_comment TEXT,
      source_label TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_admin_places_name ON admin_places(name);
    CREATE INDEX IF NOT EXISTS idx_admin_places_category ON admin_places(category);
  `);

  return db;
}

function mapRow(row) {
  if (!row) {
    return null;
  }

  return {
    externalId: row.external_id,
    osmType: row.osm_type,
    osmId: row.osm_id,
    name: row.name,
    category: row.category,
    address: row.address,
    lat: row.lat,
    lon: row.lon,
    practical: {
      massTimes: row.mass_times,
      confessionTimes: row.confession_times,
      adorationTimes: row.adoration_times,
      openingHours: row.opening_hours,
      description: row.notes || ""
    },
    contacts: {
      phone: row.phone,
      email: row.email,
      website: row.website,
      facebook: row.facebook,
      instagram: row.instagram
    },
    media: {
      image: row.image_url
    },
    parishActivities: row.activities,
    summary: row.summary,
    adminComment: row.admin_comment,
    sourceLabel: row.source_label,
    updatedAt: row.updated_at
  };
}

async function getAdminPlaceByExternalId(externalId) {
  const db = await getDb();
  const row = await db.get("SELECT * FROM admin_places WHERE external_id = ?", [externalId]);
  return mapRow(row);
}

async function listAdminPlaces(query = "") {
  const db = await getDb();
  const q = clean(query);

  if (!q) {
    const rows = await db.all(
      "SELECT external_id, name, category, address, updated_at FROM admin_places ORDER BY updated_at DESC, name ASC LIMIT 100"
    );
    return rows.map((row) => ({
      externalId: row.external_id,
      name: row.name,
      category: row.category,
      address: row.address,
      updatedAt: row.updated_at
    }));
  }

  const like = `%${q}%`;
  const rows = await db.all(
    `SELECT external_id, name, category, address, updated_at
     FROM admin_places
     WHERE name LIKE ? OR address LIKE ? OR category LIKE ?
     ORDER BY updated_at DESC, name ASC
     LIMIT 100`,
    [like, like, like]
  );

  return rows.map((row) => ({
    externalId: row.external_id,
    name: row.name,
    category: row.category,
    address: row.address,
    updatedAt: row.updated_at
  }));
}

async function upsertAdminPlace(input) {
  const db = await getDb();
  const payload = input || {};
  const externalId = buildExternalId(payload);
  const osmType = clean(payload.osmType);
  const osmId = clean(payload.osmId || payload.id);
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO admin_places (
      external_id, osm_type, osm_id, name, category, address, lat, lon,
      mass_times, confession_times, adoration_times, opening_hours, activities,
      phone, email, website, facebook, instagram, image_url,
      summary, notes, admin_comment, source_label, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO UPDATE SET
      osm_type = excluded.osm_type,
      osm_id = excluded.osm_id,
      name = excluded.name,
      category = excluded.category,
      address = excluded.address,
      lat = excluded.lat,
      lon = excluded.lon,
      mass_times = excluded.mass_times,
      confession_times = excluded.confession_times,
      adoration_times = excluded.adoration_times,
      opening_hours = excluded.opening_hours,
      activities = excluded.activities,
      phone = excluded.phone,
      email = excluded.email,
      website = excluded.website,
      facebook = excluded.facebook,
      instagram = excluded.instagram,
      image_url = excluded.image_url,
      summary = excluded.summary,
      notes = excluded.notes,
      admin_comment = excluded.admin_comment,
      source_label = excluded.source_label,
      updated_at = excluded.updated_at`,
    [
      externalId,
      osmType,
      osmId,
      clean(payload.name) || "Lieu catholique",
      clean(payload.category),
      clean(payload.address),
      payload.lat ? Number(payload.lat) : null,
      payload.lon ? Number(payload.lon) : null,
      clean(payload.massTimes),
      clean(payload.confessionTimes),
      clean(payload.adorationTimes),
      clean(payload.openingHours),
      clean(payload.activities),
      clean(payload.phone),
      clean(payload.email),
      clean(payload.website),
      clean(payload.facebook),
      clean(payload.instagram),
      clean(payload.imageUrl),
      clean(payload.summary),
      clean(payload.notes),
      clean(payload.adminComment),
      clean(payload.sourceLabel) || "Fiche admin",
      now
    ]
  );

  return getAdminPlaceByExternalId(externalId);
}

async function deleteAdminPlace(externalId) {
  const db = await getDb();
  await db.run("DELETE FROM admin_places WHERE external_id = ?", [externalId]);
}

function mergeDetailsWithAdmin(baseDetails, adminDetails) {
  if (!adminDetails) {
    return {
      ...baseDetails,
      adminMeta: null
    };
  }

  return {
    ...baseDetails,
    name: adminDetails.name || baseDetails.name,
    category: adminDetails.category || baseDetails.category,
    address: adminDetails.address || baseDetails.address,
    coordinates: baseDetails.coordinates,
    practical: {
      ...baseDetails.practical,
      massTimes: adminDetails.practical?.massTimes || baseDetails.practical?.massTimes,
      confessionTimes: adminDetails.practical?.confessionTimes || baseDetails.practical?.confessionTimes,
      adorationTimes: adminDetails.practical?.adorationTimes || baseDetails.practical?.adorationTimes,
      openingHours: adminDetails.practical?.openingHours || baseDetails.practical?.openingHours,
      description: adminDetails.practical?.description || baseDetails.practical?.description
    },
    contacts: {
      ...baseDetails.contacts,
      phone: adminDetails.contacts?.phone || baseDetails.contacts?.phone,
      email: adminDetails.contacts?.email || baseDetails.contacts?.email,
      website: adminDetails.contacts?.website || baseDetails.contacts?.website,
      facebook: adminDetails.contacts?.facebook || baseDetails.contacts?.facebook,
      instagram: adminDetails.contacts?.instagram || baseDetails.contacts?.instagram
    },
    media: {
      ...baseDetails.media,
      image: adminDetails.media?.image || baseDetails.media?.image
    },
    parishActivities: adminDetails.parishActivities || baseDetails.parishActivities,
    summary: adminDetails.summary || baseDetails.summary,
    sourceNote: adminDetails.adminComment || baseDetails.sourceNote,
    adminMeta: {
      sourceLabel: adminDetails.sourceLabel,
      updatedAt: adminDetails.updatedAt,
      externalId: adminDetails.externalId
    }
  };
}

module.exports = {
  buildExternalId,
  deleteAdminPlace,
  getAdminPlaceByExternalId,
  getDb,
  listAdminPlaces,
  mergeDetailsWithAdmin,
  upsertAdminPlace
};
