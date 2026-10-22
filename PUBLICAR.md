# Publicar en xXROCHETXx/peak-online

El repositorio y el iniciador ya están publicados. GitHub rechazó el workflow por un bloqueo de facturación de la cuenta. Para completar Pages, resuelve ese bloqueo en GitHub y vuelve a ejecutar `gh workflow run pages.yml --repo xXROCHETXx/peak-online --ref main`. Las instrucciones de creación siguientes son una referencia para reconstruir el proyecto; no vuelvas a crear el repositorio existente.

Ejecuta desde esta carpeta. GitHub necesita que autorices la sesión de GitHub CLI en su web; no envíes contraseñas ni tokens por el chat.

```powershell
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh api user --jq .login
```

Comprueba que la cuenta es `xXROCHETXx`. Antes de crear, verifica que `peak-online` no existe o que es el repositorio destinado a este proyecto. Esta carpeta ya tiene un repositorio Git local y un commit preparado. La siguiente secuencia crea un repositorio remoto **nuevo** y público:

```powershell
git status --short
git log -1 --oneline
gh repo create xXROCHETXx/peak-online --public --source . --remote origin --description "PEAK en navegador: cada grupo juega en el PC de su propio host"
gh api repos/xXROCHETXx/peak-online/pages --method POST -f build_type=workflow
git push -u origin main
gh release create v0.1.0 artifacts/PEAK-host-Windows.zip --repo xXROCHETXx/peak-online --title "PEAK: un host por grupo" --notes-file RELEASE-NOTES.md
gh run list --repo xXROCHETXx/peak-online --workflow pages.yml --limit 3
```

Si Pages no permite configurarse antes del primer push, haz el push, actívalo en Settings → Pages → GitHub Actions y vuelve a ejecutar el workflow. Si Git necesita identidad para el commit, configura nombre y email para **este repositorio** con la identidad que elijas.

La URL prevista es `https://xXROCHETXx.github.io/peak-online/`. Solo está publicada cuando el workflow termine correctamente y la URL responda. No se debe confundir esta dirección prevista con una publicación confirmada.
