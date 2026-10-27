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

Un bouton lecture apparaît sur les albums disposant de fichiers audio (cartes, listes et fiche album). La barre de lecture persistante en bas de page offre lecture/pause, piste précédente/suivante, avance dans la piste et volume — **touchez la zone titre/pochette pour ouvrir le lecteur plein écran** (grande pochette, contrôles et file de lecture). Les contrôles s'affichent aussi sur l'écran verrouillé (Android) et dans les notifications multimédia (GNOME) via l'API MediaSession.

💡 L'application est installable en PWA (menu « Installer l'application » du navigateur) sur Android comme sur le bureau (Fedora/GNOME, Chrome/Firefox).

> **Docker** : montez votre musique en lecture seule (voir `docker/docker-compose.yml`, ex. `- /home/user/Musique:/music:ro`) et indiquez `/music` comme chemin de bibliothèque dans les Paramètres.

### Bibliothèque sur le réseau (NAS)

La bibliothèque doit être un dossier accessible par le **serveur** via le système de fichiers. Pour une musique stockée sur un NAS, montez le partage sur la machine qui héberge JewelBox, puis renseignez le point de montage dans les Paramètres :

```bash
# NFS
sudo mount -t nfs nas:/volume/musique /mnt/musique

# SMB / CIFS
sudo mount -t cifs //nas/musique /mnt/musique -o credentials=/etc/samba/creds,ro

# SSHFS
sshfs user@nas:/musique /mnt/musique
```

Ajoutez l'entrée correspondante dans `/etc/fstab` pour un montage permanent. En Docker, montez le point de montage hôte dans le conteneur : `- /mnt/musique:/music:ro` (chemin à déclarer : `/music`). Les URL de type `smb://` ou `nfs://` ne sont pas supportées directement.

### Playlists

Créez des listes de lecture depuis le menu **Playlists** : ajoutez une piste ou un album entier depuis la fiche album (bouton « Ajouter à une playlist »), réordonnez les pistes, renommez, supprimez, et lancez la lecture complète. Les playlists survivent aux modifications d'albums.

### File d'attente

Ouvrez le lecteur plein écran (touchez la zone titre/pochette de la barre de lecture) pour voir la file en cours : réordonnez les pistes par glisser-déposer, retirez-en d'une croix, ou videz la file entière. Depuis une fiche album, **Lire ensuite** insère juste après la piste courante, **Ajouter à la file** place en fin — au niveau de l'album entier comme d'une piste isolée.

La file est enregistrée sur le serveur : elle est restaurée au rechargement de la page, avec la piste et la position exactes (en pause — les navigateurs interdisent de relancer le son sans action de votre part).

Chaque appareil possède sa propre file, identifiée par un jeton local : le navigateur du bureau et le téléphone ne s'écrasent donc jamais l'un l'autre. `GET /api/player/queue/devices` liste les files laissées par les autres appareils, de quoi reprendre sur le téléphone ce que le bureau écoutait.

### Paroles

Dans le lecteur plein écran, l'onglet **Paroles** affiche les paroles du morceau : synchronisées (la ligne chantée suit la musique, un clic y saute) quand elles existent, sinon le texte. Le serveur prend d'abord un fichier `.lrc` posé à côté du fichier audio (même nom), puis interroge [LRCLIB](https://lrclib.net) (libre, sans compte) et garde la réponse. La recherche en ligne se coupe dans **Paramètres → Paroles**. Même chose dans les lecteurs bureau et Android.

### Fondu entre les morceaux

**Paramètres → Normalisation du volume → Fondu entre les morceaux** (2 à 8 s, désactivé par défaut) : le son baisse à la fin d'un morceau et remonte au début du suivant, sans chevauchement, et jamais entre deux pistes qui se suivent sur un même album.

### Normalisation du volume (ReplayGain)

L'analyse de la bibliothèque lit aussi les tags ReplayGain des fichiers (écrits par JewelBox Ripper, ou `rsgain easy` sur une bibliothèque existante) et les expose aux lecteurs (`replaygain` sur chaque piste : gains en dB, crêtes linéaires). Dans **Paramètres → Normalisation du volume**, choisissez *Par album* (défaut), *Par piste* ou *Désactivée* — réglage propre à chaque navigateur. Le gain passe par le volume du lecteur : les albums masterisés fort sont baissés, un gain positif est ignoré. Pour des fichiers déjà associés, relancez l'analyse une fois.

### Scrobbling Last.fm

Aucune configuration : rendez-vous dans **Paramètres → Last.fm**, cliquez sur « Connecter mon compte Last.fm » et autorisez l'application sur last.fm — c'est tout.

Les écoutes sont scrobblées selon la règle Last.fm : piste d'au moins 30 secondes, écoutée à moitié ou pendant 4 minutes. Le « now playing » s'affiche dès le début de la lecture. Votre clé de session ne quitte jamais le serveur.

<details>
<summary>Utiliser votre propre clé API Last.fm</summary>

JewelBox embarque sa propre clé d'application Last.fm, comme la plupart des lecteurs de bureau (Strawberry, Clementine…). Cette clé identifie l'application, pas votre compte : chaque utilisateur autorise son propre profil et obtient une clé de session personnelle.

Pour utiliser votre propre application Last.fm, définissez ces deux variables d'environnement sur le serveur :

```bash
LASTFM_API_KEY=votre_cle
LASTFM_API_SECRET=votre_secret
```

Les sessions autorisées avec une autre clé sont automatiquement invalidées : il suffit de reconnecter son compte.
</details>

---

## 📡 Découverte réseau (mDNS)

Au démarrage, le serveur s'annonce sur le réseau local en Zeroconf sous le type
`_jewelbox._tcp`. L'application mobile le trouve ainsi toute seule, sans avoir à
saisir une adresse IP qui change à chaque bail DHCP.

Vérifier l'annonce depuis une autre machine du réseau :

```bash
avahi-browse -rt _jewelbox._tcp        # Linux
dns-sd -B _jewelbox._tcp               # macOS
```

L'enregistrement porte le port réel, ainsi que des champs TXT (`app`, `version`,
`api`, `id`). Après résolution, un client confirme sa trouvaille via
`GET /api/server-info`, qui renvoie notamment un `server_id` stable — généré au
premier démarrage et conservé — permettant de reconnaître un serveur déjà appairé
même si son adresse a changé.

| Variable        | Défaut                  | Rôle                                    |
|-----------------|-------------------------|-----------------------------------------|
| `MDNS_ENABLED`  | `true`                  | `false` désactive complètement l'annonce |
| `MDNS_NAME`     | `JewelBox (<hostname>)` | Nom affiché du service                   |
| `MDNS_ADDRESS`  | *(autodétectée)*        | IPv4 annoncée. Par défaut : l'adresse de la route par défaut de la machine — ce qui exclut les bridges Docker (`172.x.0.1`), qui seraient injoignables depuis le LAN. À forcer seulement pour les configurations multi-réseaux exotiques. |

Si le multicast est indisponible, l'annonce échoue sans bloquer le démarrage : le
serveur reste joignable normalement par son adresse IP.

> **⚠️ En Docker :** le multicast ne traverse pas le NAT du bridge par défaut.
> L'annonce sera donc invisible depuis le réseau local avec la configuration
> standard. Pour que la découverte fonctionne, utilisez `network_mode: host` dans
> `docker-compose.yml` (en retirant la section `ports`, inutile dans ce mode).
> Sinon, réglez `MDNS_ENABLED=false` pour éviter une annonce qui ne sert à rien.

---

## 💾 Sauvegardes

**Paramètres → Sauvegardes** : le serveur sauvegarde lui-même toutes les collections (bases SQLite, copiées à chaud, et pochettes), chaque jour ou chaque semaine à l'heure choisie, en gardant les N dernières. Un bouton lance une sauvegarde tout de suite ; chaque sauvegarde se restaure en un clic, après une copie de sécurité de l'état actuel. Choisissez de préférence un dossier sur un autre disque (un NAS monté dans le conteneur) : par défaut, les sauvegardes vont dans `data/backups`, sur le même volume que les données. Les réglages (bibliothèque musicale, Last.fm…) ne sont pas sauvegardés.

## 🐳 Docker

### Lancement avec Docker Compose (recommandé)

```bash
cd docker
cp .env.example .env   # facultatif : tag de l'image, Last.fm, Watchtower
docker compose up -d
```

L'application est accessible sur [http://localhost:3001](http://localhost:3001).
Les bases de données et les pochettes sont persistées dans le volume `jewelbox_data`.

- L'image est celle des releases (`willde71/jewelbox-music-library`), au tag `JEWELBOX_TAG` (`latest` par défaut, ou `v1.18.1`, `v1.18`, `v1`).
- Mise à jour : `docker compose pull && docker compose up -d`, ou le bouton **Mettre à jour maintenant** (voir ci-dessous).
- Construire depuis les sources : `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

### Mise à jour depuis l'interface

JewelBox vérifie les releases GitHub : quand une nouvelle version sort, une notification apparaît une fois et un lien « vX.Y.Z disponible » s'affiche dans le menu, avec les notes de version. Pour avoir aussi le bouton **Mettre à jour maintenant**, activez [Watchtower](https://github.com/nicholas-fedor/watchtower) dans `docker/.env` :

```bash
COMPOSE_PROFILES=updater
WATCHTOWER_TOKEN=...   # un jeton secret, par exemple : openssl rand -hex 32
```

puis `docker compose up -d`. Watchtower n'agit que sur demande (pas de vérification périodique) et uniquement sur le conteneur JewelBox ; c'est lui, et non JewelBox, qui a accès au socket Docker. Le bouton n'apparaît pas si `JEWELBOX_TAG` est une version fixe (`v1.18.1`).

> **Avec `network_mode: host`** (mDNS), le nom `watchtower` n'est pas résolu : publiez le port de Watchtower (`ports: ["127.0.0.1:8080:8080"]` sur le service `watchtower`) et mettez `UPDATER_URL=http://localhost:8080` dans `.env`.

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
| `GET`    | `/api/playlists`             | Liste des playlists                      |
| `POST`   | `/api/playlists`             | Créer une playlist                       |
| `GET`    | `/api/playlists/:id`         | Détail + pistes                          |
| `PATCH`  | `/api/playlists/:id`         | Renommer                                 |
| `DELETE` | `/api/playlists/:id`         | Supprimer                                |
| `POST`   | `/api/playlists/:id/tracks`  | Ajouter une piste ou un album            |
| `PUT`    | `/api/playlists/:id/tracks`  | Réordonner les pistes                    |
| `DELETE` | `/api/playlists/:id/tracks/:entryId` | Retirer une piste                |
| `GET`    | `/api/player/queue`          | File d'attente de l'appareil courant     |
| `PUT`    | `/api/player/queue`          | Remplacer la file                        |
| `PATCH`  | `/api/player/queue/state`    | Position de lecture (piste + secondes)   |
| `POST`   | `/api/player/queue/tracks`   | Ajouter à la file / lire ensuite         |
| `DELETE` | `/api/player/queue/tracks/:entryId` | Retirer une entrée de la file     |
| `DELETE` | `/api/player/queue`          | Vider la file                            |
| `GET`    | `/api/player/queue/devices`  | Files laissées par les autres appareils  |
| `GET`    | `/api/player/stats?period=`  | Statistiques d'écoute (`month`, `year`, `all`) |
| `GET`    | `/api/lastfm/connect`        | URL d'autorisation Last.fm               |
| `DELETE` | `/api/lastfm/session`        | Déconnecter le compte Last.fm            |
| `POST`   | `/api/lastfm/nowplaying`     | Signaler la piste en cours               |
| `POST`   | `/api/lastfm/scrobble`       | Scrobbler une écoute                     |
| `GET`    | `/api/server-info`           | Identité du serveur (découverte mDNS)    |

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
