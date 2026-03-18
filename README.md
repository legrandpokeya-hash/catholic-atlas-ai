# Catholic Atlas AI

Application de geolocalisation des eglises et sanctuaires catholiques dans le monde, avec assistant IA integre.

## 1) Fonctionnalites

- Recherche par ville/pays/lieu (geocodage Nominatim)
- Recherche locale autour de l'utilisateur (GPS navigateur)
- Carte interactive (Leaflet + OpenStreetMap)
- Extraction des lieux catholiques (Overpass API)
- Assistant IA de recommandations de pelerinage
- Fiche detaillee par lieu: horaires, contacts, site, image, resume
- Base de donnees SQLite pour enrichir manuellement les lieux
- Interface d'administration pour gerer horaires, activites, contacts, images
- Contenu editorial configurable (hero, suggestions, conseils)

## 2) Stack technique

- Frontend: HTML, CSS, JavaScript (vanilla), Leaflet
- Back-office: HTML, CSS, JavaScript (vanilla)
- Backend: Node.js + Express
- Base de donnees: SQLite
- Donnees geographiques: OpenStreetMap (Nominatim + Overpass)
- IA: OpenAI Chat Completions (optionnelle)

## 3) Installation

### Prerequis

- Node.js 18+
- npm

### Etapes

1. Ouvrir un terminal dans le dossier du projet.
2. Installer les dependances:

```bash
npm install
```

3. Copier le fichier d'environnement:

```bash
cp .env.example .env
```

Sous Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

4. Configurer `.env`:

```env
OPENAI_API_KEY=votre_cle_api
OPENAI_MODEL=gpt-4o-mini
ADMIN_SECRET=un-mot-de-passe-admin-fort
DATABASE_PATH=
```

- `ADMIN_SECRET` protege les routes d'administration.
- `DATABASE_PATH` peut rester vide en local. En production, il peut pointer vers un chemin persistant.

5. Lancer l'application:

```bash
npm start
```

6. Ouvrir:

- http://localhost:3000

## 4) Utilisation

1. Entrez un lieu (ex: `Rome, Italie`) et un rayon.
2. Cliquez sur `Rechercher` pour afficher les lieux sur la carte.
3. Optionnel: cliquez sur `Me localiser` pour recherche autour de vous.
4. Cliquez sur une eglise ou un sanctuaire pour ouvrir sa fiche detaillee.
5. Cliquez sur `✝ Generer le parcours spirituel complet` pour un guide IA du lieu choisi.
6. Dans la zone IA, vous pouvez aussi decrire un besoin global (ex: parcours marial, visite d'une demi-journee, budget, etc.).

### Administration des fiches

1. Ouvrir `http://localhost:3000/admin.html`
2. Entrer la valeur de `ADMIN_SECRET`
3. Cliquer sur `Importer le lieu selectionne` pour pre-remplir la fiche depuis la carte
4. Completer ou corriger:
	- horaires de messe
	- confessions
	- adoration
	- activites paroissiales
	- telephone, email, site
	- image principale
	- resume et notes
5. Enregistrer la fiche

Les donnees admin sont stockees dans SQLite et se superposent aux donnees publiques OpenStreetMap/Wikipedia.

## 5) Structure du projet

- `server.js`: API backend (content, geocode, places, IA)
- `db.js`: couche SQLite et fusion des donnees admin
- `public/index.html`: interface principale
- `public/styles.css`: design responsive
- `public/app.js`: logique front (map + appels API)
- `public/admin.html`: interface d'administration
- `public/admin.css`: styles du back-office
- `public/admin.js`: logique CRUD de l'administration
- `content/editorial-content.json`: contenu editable
- `data/catho-atlas.sqlite`: base SQLite locale creee automatiquement
- `.env.example`: variables d'environnement
- `render.yaml`: configuration de deploiement Render

## 6) Personnaliser le contenu

Modifier `content/editorial-content.json`:

- `homeHero.title`, `homeHero.subtitle`
- `suggestedPilgrimages` (liste de lieux recommandes)
- `tips` (conseils d'usage)

## 7) Brancher une vraie IA

Si `OPENAI_API_KEY` est absente, l'app fonctionne en mode local (fallback intelligent basique).
Si la cle est presente, les endpoints `/api/ai/guide` et `/api/ai/place` utilisent OpenAI.

## 8) Deploiement public (Render)

### Important

- `localhost` ne peut pas etre publie sur Play Store ou App Store.
- Il faut d'abord une URL publique, par exemple via Render.
- SQLite doit etre stockee sur un disque persistant en production, sinon les donnees admin seront perdues au redeploiement.

### Preparation deja incluse

- `render.yaml` est deja configure
- `.gitignore` exclut `.env` et la base locale
- `DATABASE_PATH` est configurable

### Etapes Render

1. Mettre le projet sur GitHub.
2. Creer un compte Render.
3. Creer un nouveau `Blueprint` ou `Web Service` depuis le depot GitHub.
4. Configurer les variables d'environnement:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
ADMIN_SECRET=...
DATABASE_PATH=/var/data/catho-atlas.sqlite
```

5. Ajouter un disque persistant si le plan choisi le permet.
6. Lancer le deploy.
7. Vous obtiendrez une URL du type `https://catholic-atlas-ai.onrender.com`

### Pour Play Store / App Store ensuite

Une fois l'application deployee publiquement, il faudra l'emballer en application mobile native/hybride (par exemple avec Capacitor) avant publication sur les stores.

## 9) Ameliorations proposees (prochaine etape)

- Compte utilisateur + favoris
- Filtres avances (messe, confession, adoration)
- Export d'itineraires PDF
- Mode multilingue FR/EN/IT/ES
- Packaging mobile Android / iOS

## 10) Notes production

- Respecter la politique d'utilisation OSM (User-Agent deja defini dans le backend).
- Ajouter une couche de cache (Redis) pour limiter les appels API.
- Ajouter logs + monitoring (ex: Sentry).
- Pour une vraie production avec beaucoup de traffic, migrer SQLite vers Postgres.
