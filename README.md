# Idle Sounds (No Scene)

Extension Owlbear Rodeo qui joue des sons aléatoires quand **aucune scène n'est active**.

## Utilisation
1. Uploade tes fichiers audio dans `public/sounds/` et liste-les dans `public/sounds/sounds.json`.
2. Déploie sur Vercel (ou autre hébergeur static) avec l’en-tête CORS `Access-Control-Allow-Origin: https://www.owlbear.rodeo`.
3. Dans Owlbear: **Profil → Add Extension** et colle l’URL de ton `manifest.json`, p. ex.:  
   `https://<ton-projet>.vercel.app/manifest.json`
4. Active l’extension dans ta Room, ouvre le popover **Idle Sounds**, clique **Activer l’audio**.
5. Tant qu’aucune scène n’est ouverte, des sons se jouent à intervalles aléatoires.

## Dev local
```bash
npm i
npm run dev
