# Notizbuch

Persönliches Notizbuch mit KI-strukturierter Wissensbasis – portiert aus einem
Claude.ai-Artifact zu einer selbst gehosteten Web-App.

- **Live:** https://tschachim.github.io/notizbuch-app/
- **Hosting:** GitHub Pages (dieses Repo, Deploy per GitHub Actions bei Push auf `main`)
- **Datenspeicher:** privates Repo `notizbuch-data` über die GitHub Contents API
  (`wissensbasis.md`, `bilder/`, `data/state.json`)
- **KI:** Anthropic Messages API direkt aus dem Browser mit eigenem API-Key
  (erzwungener Tool-Call `update_notebook`)

Dieses Repo enthält ausschließlich Code – keine Daten, Namen, Tokens oder
personenbezogenen Inhalte. Zugangsdaten (Fine-grained PAT, Anthropic-API-Key)
trägt der Nutzer in der laufenden App ein; sie liegen nur im localStorage des
jeweiligen Geräts.

## Sicherheitshinweis

Alle GitHub-Pages-Projektseiten eines Kontos teilen sich den Origin
`<owner>.github.io` – und damit den localStorage. JavaScript aus jedem anderen
Pages-Projekt desselben Kontos könnte die hier gespeicherten Zugangsdaten
lesen. Deshalb: auf diesem Konto keine fremden oder ungeprüften Pages-Projekte
hosten, den PAT strikt auf das Daten-Repo beschränken und für den
Anthropic-Key ein Budgetlimit setzen. Wer das Risiko ganz ausschließen will,
betreibt die App unter einer eigenen Domain (z. B. Cloudflare Pages) oder in
einem separaten GitHub-Konto.

## Entwicklung

```bash
npm install
npm run dev     # http://localhost:5173/notizbuch-app/
npm run build   # Produktions-Build nach dist/
```

Architekturentscheidungen: siehe [DECISIONS.md](DECISIONS.md).
