<!-- markdownlint-disable MD033 MD041-->
<div align="center">
  <img src="client/public/icons/icon-192.png" width="80" alt="JewelBox icon" />

# JewelBox Music Library

_Parce que vos albums méritent mieux qu'une simple étagère._
</div>

<div align="center">
  <img src="client/public/jewelbox-app.png" width="80%" alt="JewelBox Application" />
</div>
<!-- markdownlint-enable MD033 MD041 -->

- 🚀 [Démarrage rapide (développement)](#-démarrage-rapide-développement)
- 🎵 [Lecteur audio intégré](#-lecteur-audio-intégré)
- 🐳 [Deploy with Docker](#-docker)
- 🧪 [Tests](#-tests)
- 🌐 [API REST](#-api-rest)
- 📄 [Licence](#-licence)

## 🚀 Démarrage rapide (développement)

### Prérequis

- Node.js 20+
- npm 9+

### Installation

```bash
git clone https://github.com/William-De71/jewelbox-music-library.git
cd JewelBox-Music-Library
npm install
```

### Lancement

```bash
# Démarre le backend (port 3001) et le frontend (port 5173) simultanément
npm run dev
```

Ouvrir [http://localhost:5173](http://localhost:5173)

---

## 🎵 Lecteur audio intégré

Écoutez les albums de votre collection directement dans JewelBox, façon Spotify local.

1. **Paramètres → Bibliothèque musicale** : renseignez le chemin du dossier contenant vos fichiers audio (mp3, flac, ogg, opus, m4a, aac, wav), puis **Enregistrer**.
2. Cliquez sur **Scanner la bibliothèque** : les fichiers sont associés automatiquement aux albums de la collection grâce à leurs tags (ID3/Vorbis/FLAC), avec repli sur la structure de dossiers `Artiste/Album/NN - Titre.ext`.
3. Pour les albums non reconnus, ouvrez la fiche album et utilisez **Associer un dossier** pour choisir manuellement le dossier correspondant (cette association survit aux scans suivants).

Un bouton lecture apparaît sur les albums disposant de fichiers audio (cartes, listes et fiche album). La barre de lecture persistante en bas de page offre lecture/pause, piste précédente/suivante, avance dans la piste et volume. Les contrôles s'affichent aussi sur l'écran verrouillé (Android) et dans les notifications multimédia (GNOME) via l'API MediaSession.

💡 L'application est installable en PWA (menu « Installer l'application » du navigateur) sur Android comme sur le bureau (Fedora/GNOME, Chrome/Firefox).

> **Docker** : montez votre musique en lecture seule (voir `docker/docker-compose.yml`, ex. `- /home/user/Musique:/music:ro`) et indiquez `/music` comme chemin de bibliothèque dans les Paramètres.

---

## 🐳 Docker

### Lancement avec Docker Compose (recommandé)

```bash
cd docker
docker compose up -d
```

L'application est accessible sur [http://localhost:3001](http://localhost:3001).
Les bases de données et les pochettes sont persistées dans le volume `jewelbox_data`.

### Sans Docker Compose (Docker seul)

```bash
# 1. Build de l'image depuis la racine du projet
docker build -f docker/Dockerfile -t jewelbox .

# 2. Créer le volume pour persister les données
docker volume create jewelbox_data

# 3. Lancer le conteneur
docker run -d \
  -p 3001:3001 \
  -v jewelbox_data:/app/server/data \
  -e NODE_ENV=production \
  --name jewelbox-app \
  --restart unless-stopped \
  jewelbox
```

L'application est accessible sur [http://localhost:3001](http://localhost:3001).

```bash
# Arrêter / relancer
docker stop jewelbox-app
docker start jewelbox-app

# Voir les logs
docker logs -f jewelbox-app

# Mettre à jour (rebuild)
docker stop jewelbox-app && docker rm jewelbox-app
docker build -f docker/Dockerfile -t jewelbox .
docker run -d -p 3001:3001 -v jewelbox_data:/app/server/data \
  -e NODE_ENV=production --name jewelbox-app --restart unless-stopped jewelbox
```

### Données persistantes

Le volume Docker monte `/app/server/data` qui contient :

- les bases SQLite (`.db`)
- les pochettes téléchargées (`covers/`)

```bash
# Voir les données persistées
docker volume inspect jewelbox_data

# Sauvegarder les données
docker run --rm -v jewelbox_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/jewelbox-backup.tar.gz /data
```

---

## 🧪 Tests

```bash
# Run all tests (server + client)
npm run test

# Server tests only
npm run test --workspace=server

# Client tests only
npm run test --workspace=client

# Server tests with coverage report (≥ 98% statements, ≥ 85% branches)
npm run test:coverage --workspace=server
```

---

## 🌐 API REST

| Méthode  | Endpoint                     | Description                              |
|----------|------------------------------|------------------------------------------|
| `GET`    | `/api/albums`                | Liste paginée (filtres, tri, recherche)  |
| `GET`    | `/api/albums/:id`            | Détail + pistes                          |
| `POST`   | `/api/albums`                | Créer un album                           |
| `PATCH`  | `/api/albums/:id`            | Modifier un album                        |
| `DELETE` | `/api/albums/:id`            | Supprimer un album                       |
| `PATCH`  | `/api/albums/:id/lend`       | Prêter / récupérer                       |
| `GET`    | `/api/albums/:id/loans`      | Historique des prêts                     |
| `GET`    | `/api/albums/export`         | Exporter la collection (CSV ou JSON)     |
| `POST`   | `/api/albums/import`         | Importer depuis un CSV                   |
| `GET`    | `/api/albums/duplicate`      | Vérifier si un doublon existe            |
| `GET`    | `/api/albums/genres`         | Liste des genres                         |
| `GET`    | `/api/search?q=`             | Recherche MusicBrainz par titre/artiste  |
| `GET`    | `/api/search?ean=`           | Recherche par EAN/code-barres            |
| `GET`    | `/api/search/:mbid`          | Détail complet d'une release             |
| `POST`   | `/api/upload/cover`          | Upload d'une pochette                    |
| `GET`    | `/api/database`              | Liste des bases de données               |
| `POST`   | `/api/database`              | Créer une nouvelle base                  |
| `POST`   | `/api/database/:id/activate` | Activer une base                         |
| `GET`    | `/api/database/active`       | Base de données active                   |
| `POST`   | `/api/player/scan`           | Scanner la bibliothèque musicale         |
| `GET`    | `/api/player/scan/status`    | Progression / résultat du scan           |
| `GET`    | `/api/player/tracks/:id/stream` | Flux audio d'une piste (Range)        |
| `GET`    | `/api/player/browse?dir=`    | Parcourir les dossiers de la bibliothèque |
| `PUT`    | `/api/player/albums/:id/folder` | Associer un dossier à un album        |
| `DELETE` | `/api/player/albums/:id/folder` | Dissocier le dossier d'un album       |

### Paramètres de `GET /api/albums`

| Paramètre | Type    | Description                             |
|-----------|---------|-----------------------------------------|
| `page`    | entier  | Numéro de page (défaut : 1)             |
| `limit`   | entier  | Albums par page (défaut : 24)           |
| `genre`   | texte   | Filtrer par genre                       |
| `rating`  | entier  | Filtrer par note (1-5)                  |
| `sort`    | texte   | `title`, `artist`, `year`, `rating`     |
| `order`   | texte   | `asc` ou `desc`                         |
| `search`  | texte   | Recherche sur titre et artiste          |
| `wanted`  | booléen | `true` = liste de souhaits uniquement   |
| `lent`    | booléen | `true` = albums prêtés uniquement       |

---

## 📄 Licence

Ce projet est distribué sous licence **MIT**.  
Voir le fichier [LICENSE](LICENSE) pour le texte complet.

---
