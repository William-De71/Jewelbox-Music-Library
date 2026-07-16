npm# Procédure de Release

## Prérequis

- Être sur la branche `main` avec les dernières modifications
- Tous les tests passent

## Étapes

### 1. Incrémenter la version

Selon le type de changement :

```bash
# Correction de bug (1.1.8 → 1.1.9)
npm version patch

# Nouvelle fonctionnalité (1.1.8 → 1.2.0)
npm version minor

# Changement majeur / breaking change (1.1.8 → 2.0.0)
npm version major
```

Cette commande :
- Met à jour `package.json`
- Crée un commit automatique
- Crée un tag git `vX.Y.Z`

### 2. Pousser les changements et le tag

```bash
git push && git push --tags
```

### 3. Vérification

Les workflows GitHub Actions se déclenchent automatiquement :
- **release.yml** : Crée la release GitHub avec le changelog
- **docker-release-build.yml** : Build et push l'image Docker de production

Vérifier sur GitHub :
- [Actions](../../actions) - Statut des workflows
- [Releases](../../releases) - Nouvelle release créée
- [Docker Hub](https://hub.docker.com) - Nouvelle image disponible

## Versioning (SemVer)

| Type | Quand l'utiliser | Exemple |
|------|------------------|---------|
| **patch** | Corrections de bugs, petites améliorations | `1.1.8 → 1.1.9` |
| **minor** | Nouvelles fonctionnalités rétrocompatibles | `1.1.8 → 1.2.0` |
| **major** | Changements non rétrocompatibles | `1.1.8 → 2.0.0` |
