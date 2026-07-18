// ================================================================
// 📘 STRUCTORY - COMMUNICATOR (version 3)
// Fichier: Code.gs
// ================================================================
//
// communicate(text, orgId) : interprète un message libre (français),
// puis soit ajoute une écriture au journal ledger-cli de l'organisation,
// soit interroge le journal (solde, mouvements...).
//
// L'interprétation du texte libre est déléguée au LLM (message court,
// pas de problème de taille de prompt ici). Le compte comptable est lui
// choisi par des règles déterministes côté ledger_api (pcg_rules.py) —
// jamais par le LLM.
// ================================================================

const DEFAULT_ORG_ID = 'structory_default';

// Garde-fou déterministe : le LLM peut proposer "query", mais Communicator ne
// l'exécute que si le message contient un vrai mot de comptabilité. Règle en
// code (jamais dans le prompt), mais le VOCABULAIRE lui-même est une donnée —
// brique rule_0002_vocabulaire_comptable.json côté analyzor (le service qui
// possède les briques documentaires, pas ledger_api), pas une liste en dur
// ici. La compléter (ex: nouveau terme métier) ne redéploie jamais Communicator.
function looksLikeAccountingQuestion(text) {
  const lower = (text || '').toLowerCase();
  const keywords = Bibliotheque.analyzorGetQueryKeywords();
  return keywords.some(function (kw) { return lower.indexOf(kw) !== -1; });
}

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('communicator.html');
  template.orgId = (e && e.parameter && (e.parameter.orgId || e.parameter.sheetId)) || DEFAULT_ORG_ID;

  return template.evaluate()
    .setTitle('Structory - Raconte-nous ta compta')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function communicate(text, orgId) {
  orgId = orgId || DEFAULT_ORG_ID;
  Logger.log('📝 [' + orgId + '] ' + text);

  try {
    const parsed = interpret(text, orgId);

    if (parsed.intent === 'add_entry') {
      return handleAddEntry(orgId, parsed);
    }
    if (parsed.intent === 'query' && looksLikeAccountingQuestion(text)) {
      return handleQuery(orgId, parsed);
    }
    return handleUnclear(orgId, parsed);

  } catch (error) {
    Logger.log('❌ communicate error: ' + error.message);
    return "❌ Une erreur est survenue : " + error.message;
  }
}

// ================================================================
// INTERPRÉTATION DU TEXTE LIBRE (LLM, message court)
// ================================================================

function interpret(text, orgId) {
  const context = Bibliotheque.getStructoryContext(orgId) +
    '\n\n# OUTIL : Communicator\n\n' +
    "Tu interprètes un message court d'un utilisateur qui raconte sa comptabilité au fil de l'eau.";

  const mission = `
# MISSION

Analyse ce message. Il décrit soit une opération (dépense ou recette), soit une
question sur le journal comptable (solde, mouvements...).

Réponds UNIQUEMENT en JSON, un seul de ces trois formats :

Écriture :
{"intent":"add_entry","libelle":"...","montant":12.5,"sens":"depense"}
{"intent":"add_entry","libelle":"...","montant":12.5,"sens":"recette"}

Consultation — 5 commandes possibles (ce sont les seules que le serveur sait exécuter,
n'en invente pas d'autres) :
{"intent":"query","command":"balance","filters":[]}   -> solde par compte
{"intent":"query","command":"register","filters":["terme optionnel"]}   -> détail des écritures/mouvements
{"intent":"query","command":"equity","filters":[]}   -> capitaux propres / clôture
{"intent":"query","command":"print","filters":["terme optionnel"]}   -> écritures au format ledger-cli brut
{"intent":"query","command":"accounts","filters":["terme optionnel"]}   -> liste des comptes utilisés

Exemples :
- "quel est mon solde", "ma balance ?" -> command:"balance"
- "mon journal ?", "montre-moi mon journal", "montre-moi les écritures banque",
  "qu'est-ce que j'ai enregistré" -> command:"register"
- "mes capitaux propres", "solde de clôture" -> command:"equity"
- "affiche mes écritures brutes", "print mon journal" -> command:"print"
- "quels comptes j'utilise", "liste mes comptes" -> command:"accounts"

Message ambigu (pas de montant identifiable, pas de question claire) :
{"intent":"unclear","reason":"explication courte en français"}

Règles :
- "sens" = "depense" si l'utilisateur a payé/dépensé, "recette" s'il a reçu/encaissé.
- "montant" est toujours un nombre positif.
- N'invente jamais de montant absent du message.
- N'utilise "query" QUE si le message demande explicitement un chiffre, un solde,
  un mouvement, un journal ou un rapport sur le journal comptable (ex: "quel est mon
  solde", "combien j'ai dépensé", "montre-moi les charges", "mon journal ?"). Même
  une formulation courte ou elliptique ("mon journal ?", "ma balance ?") compte comme
  une vraie question dès qu'elle nomme explicitement le journal, le solde ou un
  compte. Une salutation, une question sur toi-même ("tu parles de quoi", "ça va")
  ou une remarque générale sans lien clair avec un chiffre ou le journal = "unclear",
  jamais "query".
- Dans le doute entre "unclear" et "query", choisis "unclear".
`;

  const payload = {
    context: context,
    task: { mission: mission, language: 'fr' },
    documents: [
      { name: 'message.txt', mimeType: 'text/plain', content: text }
    ]
  };

  const response = Bibliotheque.llmExecute('/analyse', payload, 'POST');

  if (!response || !response.reponse) {
    return { intent: 'unclear', reason: 'Pas de réponse du moteur de compréhension.' };
  }

  const jsonMatch = response.reponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { intent: 'unclear', reason: 'Réponse non interprétable.' };
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { intent: 'unclear', reason: 'JSON invalide reçu du moteur de compréhension.' };
  }
}

// ================================================================
// ÉCRITURE
// ================================================================

function handleAddEntry(orgId, parsed) {
  if (!parsed.libelle || parsed.montant === undefined || parsed.montant === null) {
    return "Il me manque le montant ou ce à quoi il correspond — tu peux reformuler ?";
  }

  const isFirstEntry = !Bibliotheque.ledgerExists(orgId);

  const result = Bibliotheque.ledgerAddEntry(orgId, {
    libelle: parsed.libelle,
    montant: parsed.montant,
    sens: parsed.sens === 'recette' ? 'recette' : 'depense'
  });

  if (!result.success) {
    return "❌ Écriture refusée : " + (result.error || 'erreur inconnue');
  }

  const confiancePct = Math.round((result.confidence || 0) * 100);
  let message = (isFirstEntry ? '📁 Je viens de créer ton journal comptable — première écriture enregistrée !\n' : '') +
    `✅ Écriture ajoutée : ${parsed.montant}€ — ${parsed.libelle}\n` +
    `📂 Compte : ${result.compte} ${result.compteNom} (confiance ${confiancePct}%)`;

  if (result.confidence < 0.5) {
    message += "\n⚠️ Confiance basse — vérifie ce compte, je ne suis pas sûr à 100%.";
  }

  return message;
}

// ================================================================
// CONSULTATION
// ================================================================

function handleQuery(orgId, parsed) {
  if (!Bibliotheque.ledgerExists(orgId)) {
    return "🌱 Tu n'as pas encore de journal comptable ici — raconte-moi une première " +
      'écriture (ex: "j\'ai payé 20€ de fournitures") et je le crée tout de suite.';
  }

  // Les 5 commandes réellement supportées côté serveur (QUERY_COMMANDS dans
  // ~/ledger_api/app.py) — tout le reste retombe sur "balance" par défaut.
  const SUPPORTED_COMMANDS = ['balance', 'register', 'equity', 'print', 'accounts'];
  const command = SUPPORTED_COMMANDS.indexOf(parsed.command) !== -1 ? parsed.command : 'balance';

  const result = Bibliotheque.ledgerQuery(orgId, command, parsed.filters || []);

  if (!result.success) {
    return "❌ Impossible de consulter le journal : " + (result.error || 'erreur inconnue');
  }

  if (!result.output || !result.output.trim()) {
    return "📭 Rien à afficher pour l'instant — ton journal est vide.";
  }

  return "📊 Résultat :\n" + result.output;
}

// ================================================================
// MESSAGE AMBIGU (salutation, question générale...)
// ================================================================

function handleUnclear(orgId, parsed) {
  const hasJournal = Bibliotheque.ledgerExists(orgId);

  const intro = hasJournal
    ? '👋 Salut !'
    : "👋 Bienvenue ! Tu n'as pas encore de journal comptable connecté ici — " +
      'raconte-moi une première dépense ou recette et je le crée automatiquement.';

  const precision = (parsed.intent === 'query')
    ? "Ça ressemble à une question sur ta compta, mais il me manque un chiffre ou un compte précis pour la traiter.\n\n"
    : '';

  return intro + '\n\n' + precision +
    "Voici ce que je sais faire :\n" +
    '• Ajouter une écriture : "j\'ai payé 45€ de ménage" ou "j\'ai reçu 200€ de Dupont"\n' +
    '• Consulter le solde : "quel est mon solde ?"\n' +
    '• Voir les mouvements d\'un compte : "montre-moi les écritures banque"';
}
