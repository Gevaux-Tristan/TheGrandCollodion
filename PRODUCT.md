# Product

## Register

product

## Users

Photographes et créatifs (amateurs comme pros) qui veulent donner à leurs photos numériques le rendu du collodion humide (plaque de verre, XIXe siècle). Usage ponctuel et ludique : on charge une photo, on ajuste, on télécharge. Une part importante de l'usage se fait sur mobile (photo prise sur place, retouchée immédiatement).

## Product Purpose

The Grand Collodion est un outil web statique (HTML/CSS/JS, canvas 2D) qui applique un effet collodion : conversion noir & blanc, contraste, exposition, flou radial de lentille ancienne, et 22 textures de plaques scannées. Le succès : un rendu crédible obtenu en moins d'une minute, sans compte ni installation. PWA installable, hébergé sur GitHub Pages.

## Brand Personality

Artisanal, vintage, précis. Chambre noire moderne : interface sombre (#0F0F0F) et ambre (#FFBF00), typographie DM Sans, logo script d'époque. L'outil s'efface derrière l'image ; la chaleur vient de l'accent ambre et du sujet, pas de la décoration.

## Anti-references

- Pas d'app photo « sociale » (filtres Instagram, stickers, gamification).
- Pas de skeuomorphisme lourd (fausses textures de bois, faux boutons de laiton).
- Pas d'usine à réglages type Lightroom : cinq contrôles maximum, chacun avec un effet visible.

## Design Principles

- L'image d'abord : l'aperçu occupe le maximum d'écran, les contrôles restent compacts et toujours accessibles.
- Réglage direct : chaque curseur agit en temps réel sur l'aperçu, jamais de bouton « appliquer ».
- Un geste, un effet : les contrôles sont peu nombreux, nommés simplement, sans sous-menus.
- Mobile de plein droit : le tactile n'est pas une version dégradée du bureau ; gestes, cibles de 44 px et zones du pouce sont pensés d'origine.

## Accessibility & Inclusion

Pas d'exigence WCAG formelle déclarée ; viser AA de fait : contrastes ambre/noir déjà conformes, cibles tactiles ≥ 44 px, `prefers-reduced-motion` respecté, labels reliés aux contrôles, navigation clavier sur les contrôles principaux.
