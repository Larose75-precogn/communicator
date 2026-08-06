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

// Detection d'echec de comprehension (retour de Stephane, 2026-08-06) : deux reponses
// consecutives quasi-identiques a des messages differents = signe qu'Analyzor a decroche.
// Voir communicate() / _isNearlyIdenticalResponse() / _handleUnderstandingFailure().
const NAVIGATOR_URL = 'https://script.google.com/macros/s/AKfycbzJ_mGTi4mYSVAMBZIWJ1ybbEaDyOaF6AGrzZo-VU8mv7jp5n5YzE2vCJcCz4JBX3TEkQ/exec';
const DEBUG_EMAIL_ADDRESS = 'contact@example.com';

// ================================================================
// Comptes patrimoine — brique Compte réelle (Analyzor/DriveApp), plus le Sheet V0
// ================================================================
// Migration Sheet V0 -> vraies briques Compte terminée le 2026-07-22 (18 comptes de smcspl
// migrés via identityCreateCompte, voir CLAUDE.md suivre_mes_comptes). Un seul appelant, la
// même fonction que toutes les autres orgs (`compta_copro` etc.) — Communicator n'est jamais
// forké par org, la donnée vient toujours d'Analyzor.
function getComptesForOrg(orgId) {
  return Bibliotheque.analyzorListComptes(orgId);
}

// ================================================================
// BRIQUES OBJECTS/TIME pour le menu du Communicator (2026-08-03, retour de Stéphane :
// "voir et matérialiser tous les objets existants de l'organisation, groupés" — jamais une
// liste inventée en dur, toujours les vrais comptes du journal ledger de CETTE org).
// ================================================================

// Mêmes regroupements que la Balance (structory-demo-addon/Code.js::BALANCE_GROUPES) —
// cohérence entre le sheet et le Communicator sur ce qu'est un "groupe" de comptes.
const OBJECTS_GROUPES = [
  { label: 'Capitaux propres', prefix: '1' },
  { label: 'Immobilisations',  prefix: '2' },
  { label: 'Stocks',           prefix: '3' },
  { label: 'Clients',          prefix: '411' },
  { label: 'Fournisseurs',     prefix: '401' },
  { label: 'TVA',              prefix: '445' },
  { label: 'Autres tiers',     prefix: '42|43|44' }, // hors TVA/401, testé après les plus spécifiques
  { label: 'Trésorerie',       prefix: '51' },
  { label: 'Charges',          prefix: '6' },
  { label: 'Produits',         prefix: '7' },
];

function _matchGroupe(compte) {
  const testes = OBJECTS_GROUPES.filter(function (g) { return g.prefix.length > 1 && g.prefix.indexOf('|') === -1; })
    .concat(OBJECTS_GROUPES.filter(function (g) { return g.prefix.indexOf('|') !== -1; }))
    .concat(OBJECTS_GROUPES.filter(function (g) { return g.prefix.length === 1; }));
  for (var i = 0; i < testes.length; i++) {
    var alts = testes[i].prefix.split('|');
    for (var j = 0; j < alts.length; j++) {
      if (compte.indexOf(alts[j]) === 0) return testes[i].label;
    }
  }
  return 'Autres';
}

/**
 * Tous les comptes réellement utilisés dans le journal de l'org, groupés (mêmes groupes que
 * la Balance). Jamais une liste statique — reflète l'état réel du journal à l'instant présent.
 * @returns {{success:boolean, groupes?:Object<string,string[]>, error?:string}}
 */
function getOrgObjects(orgId) {
  const result = Bibliotheque.ledgerQuery(orgId, 'accounts', []);
  if (!result.success) return { success: false, error: result.error || 'journal introuvable' };

  const comptes = (result.output || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  const groupes = {};
  comptes.forEach(function (compte) {
    const label = _matchGroupe(compte);
    (groupes[label] = groupes[label] || []).push(compte);
  });
  return { success: true, groupes: groupes };
}

/**
 * Années réellement présentes dans le journal — pour la brique Time ("aujourd'hui" par
 * défaut, ou choisir une année passée). Jamais une plage de dates devinée.
 * @returns {{success:boolean, years?:string[], error?:string}}
 */
function getOrgYears(orgId) {
  const result = Bibliotheque.ledgerQuery(orgId, 'register', []);
  if (!result.success) return { success: false, error: result.error || 'journal introuvable' };

  const years = new Set();
  (result.output || '').split('\n').forEach(function (line) {
    const m = line.match(/^(\d{4})[/-]/);
    if (m) years.add(m[1]);
  });
  return { success: true, years: Array.from(years).sort().reverse() };
}


// ================================================================
// MODULE "MON COMPTE" (widget Bibliotheque.AccountPanel) — relais requis
// car google.script.run ne peut pas appeler une fonction de library directement.
// ================================================================
function accountUpsertUser(email, locale) { return Bibliotheque.accountUpsertUser(email, locale); }
function accountRegisterOrg(orgId, name, ownerUid) { return Bibliotheque.accountRegisterOrg(orgId, name, ownerUid); }
function accountGetOrgProfile(orgId) { return Bibliotheque.accountGetOrgProfile(orgId); }
function accountUpdateOrgProfile(orgId, fields) { return Bibliotheque.accountUpdateOrgProfile(orgId, fields); }
function accountUpdateUserProfile(uid, fields) { return Bibliotheque.accountUpdateUserProfile(uid, fields); }
function accountSubscriptionCheckout(payerUid, country, locale, email) { return Bibliotheque.accountSubscriptionCheckout(payerUid, country, locale, email); }
function accountResolveCheckoutSession(sessionId) { return Bibliotheque.accountResolveCheckoutSession(sessionId); }
function accountOrgsForUid(uid) { return Bibliotheque.accountOrgsForUid(uid); }
function accountJoinRequest(uid, orgId, requestedRole) { return Bibliotheque.accountJoinRequest(uid, orgId, requestedRole); }
function accountJoinDecide(requestId, decision) { return Bibliotheque.accountJoinDecide(requestId, decision); }
function accountListJoinRequests(orgId) { return Bibliotheque.accountListJoinRequests(orgId); }

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('communicator.html');
  const orgId = (e && e.parameter && (e.parameter.orgId || e.parameter.sheetId)) || DEFAULT_ORG_ID;
  template.orgId = orgId;
  // Mode embed (Navigator, 2026-07-21) : masque header/intro/footer/widget compte — inutiles
  // et redondants une fois affiché à l'intérieur d'un Navigator déjà branding+compte, ne garde
  // que le chat lui-même. Communicator ouvert seul (hors iframe) garde son plein affichage.
  template.embed = !!(e && e.parameter && e.parameter.embed === '1');
  // Marque affichée = nom de l'org elle-même, en remontant parent_org_id si besoin — jamais
  // "Structory" figé en dur, sauf en dernier repli (org inconnue / chaîne épuisée). Retour de
  // Stéphane 2026-07-22 : "c'est du structory, pas utile pour nous" — le Communicator reste un
  // seul outil partagé, mais sa marque doit refléter l'org qui l'utilise.
  template.brandName = Bibliotheque.accountResolveBrandName(orgId);

  return template.evaluate()
    .setTitle(template.brandName + ' - Raconte-nous ta compta')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ================================================================
// CONNECTOR DE SORTIE EMAIL (§9 ARCHITECTURE.md Suivre Mes Comptes, construit 2026-07-22)
// ================================================================
// MailApp ne s'utilise que depuis Apps Script (identité utilisateur réelle) — pas d'accès
// direct depuis l'Executor (Python). Endpoint HTTP dédié, réutilise le connector de sortie
// "email" comme un cas parmi d'autres prévus par Stéphane (imprimer, WhatsApp...) : contrat
// {orgId, payload} -> {success, error?}, jamais de logique métier ici, juste l'envoi.
const EMAIL_SERVICE_KEY = "***REMOVED_SERVICE_KEY***"; // même clé que ConnectorAccount.js

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.serviceKey !== EMAIL_SERVICE_KEY) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'sendReportEmail') {
      return ContentService.createTextOutput(JSON.stringify(sendReportEmail(body.to, body.payload)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'createFacilitateur') {
      return ContentService.createTextOutput(JSON.stringify(createFacilitateurSheet(body.title || 'Facilitateur Compta Copro')))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'action inconnue' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Crée le sheet Facilitateur PreCogn via l'API Sheets (UrlFetchApp + token splaissy).
 * Évite SpreadsheetApp.create() qui nécessite une re-autorisation.
 */
function createFacilitateurSheet(title) {
  try {
    var token = ScriptApp.getOAuthToken();
    var headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // Créer le spreadsheet avec les 4 tabs directement
    var createResp = UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: headers,
      payload: JSON.stringify({
        properties: { title: title },
        sheets: [
          { properties: { title: 'Objet', index: 0 } },
          { properties: { title: 'Rule',  index: 1 } },
          { properties: { title: 'Flow',  index: 2 } },
          { properties: { title: 'Time',  index: 3 } },
        ]
      }),
      muteHttpExceptions: true
    });
    if (createResp.getResponseCode() !== 200) {
      return { success: false, error: 'Sheets API ' + createResp.getResponseCode() + ': ' + createResp.getContentText() };
    }
    var ssId = JSON.parse(createResp.getContentText()).spreadsheetId;

    // Partager avec le service account (Drive API)
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + ssId + '/permissions', {
      method: 'POST',
      headers: headers,
      payload: JSON.stringify({ type: 'user', role: 'writer', emailAddress: 'analyzor-ownstorage@focused-brand-454315-s8.iam.gserviceaccount.com' }),
      muteHttpExceptions: true
    });

    return { success: true, sheetId: ssId, url: 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Envoie le rapport quotidien de patrimoine par email.
 *
 * @param {string} to
 * @param {{date:string, totals:Object, variations:Object}} payload
 * @returns {{success:boolean, error?:string}}
 */
function sendReportEmail(to, payload) {
  if (!to || !payload) {
    return { success: false, error: 'to/payload manquant' };
  }

  const lignes = Object.keys(payload.totals || {}).map(function (devise) {
    const total = payload.totals[devise];
    const variation = (payload.variations || {})[devise] || 0;
    const signe = variation > 0 ? '+' : '';
    return devise + ' : ' + total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      + ' (' + signe + variation.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' vs veille)';
  }).join('\n');

  const body = 'Position de tes comptes au ' + payload.date + ' :\n\n' + (lignes || 'Aucun solde enregistré.');

  try {
    MailApp.sendEmail(to, 'Suivre Mes Comptes — ' + payload.date, body);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ================================================================
// MIGRATION UNIQUE Sheet V0 -> vraies briques Compte (2026-07-22)
// ================================================================
// Le Sheet V0 (SMC_V0_SHEET_ID historique, remplacé par de vraies briques via
// identityCreateCompte — même contournement de quota que identityCreateOrg). Fonction
// temporaire, à retirer une fois la migration faite une bonne fois pour toutes — plus jamais
// besoin de la relancer, le Sheet n'est plus la source de vérité après ça.
function communicateWithDocument(text, orgId, filename, base64content) {
  orgId = orgId || DEFAULT_ORG_ID;
  Logger.log('📎 [' + orgId + '] doc=' + filename + ' msg=' + text);
  var ANALYZOR = 'http://213.32.16.118:8000';
  try {
    var resp = UrlFetchApp.fetch(ANALYZOR + '/api/analyzor/understand', {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({
        orgId: orgId,
        message: text || ('Analyse ce document : ' + filename),
        documentBase64: base64content,
        documentFilename: filename,
      }),
      muteHttpExceptions: true,
    });
    var data = JSON.parse(resp.getContentText());
    if (!data.success) return '❌ ' + (data.error || 'Erreur Analyzor');
    if (data.intent === 'add_entry')     return handleAddEntry(orgId, data);
    if (data.intent === 'batch_entries') return previewBatchEntries(orgId, data.entries || []);
    return data.response || 'Document analysé.';
  } catch (e) {
    return '❌ Erreur upload document : ' + e.message;
  }
}

/**
 * Affiche un aperçu numéroté des transactions extraites et les met en cache.
 * L'utilisateur valide ensuite via communicate() : "importer", "ignorer 2,5", "annuler".
 */
function previewBatchEntries(orgId, entries) {
  if (!entries || entries.length === 0) {
    return '📄 Document analysé — aucune transaction détectée.';
  }

  // Mise en cache (10 min) pour la validation différée
  var cache = CacheService.getScriptCache();
  cache.put('pending_batch_' + orgId, JSON.stringify(entries), 600);

  var lines = ['📄 ' + entries.length + ' transaction(s) extraite(s) — vérifiez ligne par ligne :\n'];
  var totalDep = 0, totalRec = 0;

  entries.forEach(function(e, i) {
    var sens = e.sens === 'recette' ? 'recette' : 'dépense';
    var emoji = e.sens === 'recette' ? '↗' : '↘';
    var montant = parseFloat(e.montant) || 0;
    if (e.sens === 'recette') totalRec += montant; else totalDep += montant;
    lines.push((i + 1) + '. ' + (e.date || '?') + ' — ' + e.libelle + ' — ' + montant.toFixed(2) + '€ [' + emoji + ' ' + sens + ']');
  });

  lines.push('');
  lines.push('Total dépenses : ' + totalDep.toFixed(2) + '€  |  Total recettes : ' + totalRec.toFixed(2) + '€');
  lines.push('');
  lines.push('Répondez :');
  lines.push('  "importer" — tout importer');
  lines.push('  "ignorer 2,5" — importer tout sauf les lignes 2 et 5');
  lines.push('  "annuler" — abandonner');

  return lines.join('\n');
}

function communicate(text, orgId) {
  orgId = orgId || DEFAULT_ORG_ID;
  Logger.log('📝 [' + orgId + '] ' + text);

  // Mémoire de conversation : on retient le dernier message (5 min) — et depuis 2026-08-06,
  // aussi la dernière réponse donnée (comm_resp_ + orgId, même TTL), pour détecter le cas
  // rapporté par Stéphane : deux réponses consécutives identiques ("votre patrimoine est de
  // 200000 euros" deux fois de suite) à une question de connexion bancaire — un vrai échec de
  // compréhension, pas une coïncidence. Voir _isNearlyIdenticalResponse/_handleUnderstandingFailure.
  var cache = CacheService.getScriptCache();
  var histKey = 'comm_hist_' + orgId;
  var respKey = 'comm_resp_' + orgId;
  var lastMsg = cache.get(histKey) || '';
  var lastResp = cache.get(respKey) || '';
  cache.put(histKey, text, 300);

  try {
    // Commande spéciale configure email (jamais au LLM)
    if (/^configure\s+email\b/i.test(text.trim())) {
      return handleConfigureEmail(orgId, text);
    }

    // Définir IBAN de la copropriété
    if (/^iban\s+[A-Z]{2}/i.test(text.trim())) {
      return handleSetIban(orgId, text);
    }

    // Envoi appel de fonds (jamais au LLM)
    if (/^(envoyer?|send)\s+appel/i.test(text.trim()) || /^appel\s+(de\s+fonds?\s+)?(email|mail|envo)/i.test(text.trim())) {
      return handleAppelFondsEmail(orgId, text);
    }

    // Confirmation envoi appel de fonds
    var previewKey = 'appel_preview_' + orgId;
    var previewRaw = cache.get(previewKey);
    if (previewRaw && /^confirmer\s+envoi/i.test(text.trim())) {
      cache.remove(previewKey);
      return sendAppelFondsEmails(orgId, JSON.parse(previewRaw));
    }
    if (previewRaw && /^annuler/i.test(text.trim())) {
      cache.remove(previewKey);
      return '❌ Envoi annulé.';
    }

    // Écriture en partie double explicite (jamais au LLM — retour de Stéphane 2026-08-03 :
    // besoin de contrôler soi-même la contrepartie, pas de laisser le classement automatique
    // deviner). Voir handleEcritureManuelle().
    if (/^ecriture\b|^écriture\b/i.test(text.trim())) {
      return handleEcritureManuelle(orgId, text);
    }

    // Validation d'un import en attente (batch_entries mis en cache par previewBatchEntries)
    var pendingKey = 'pending_batch_' + orgId;
    var pendingRaw = cache.get(pendingKey);
    if (pendingRaw) {
      var trimmed = text.trim().toLowerCase();

      if (/^annuler/.test(trimmed)) {
        cache.remove(pendingKey);
        return '❌ Import annulé.';
      }

      if (/^importer/.test(trimmed) || /^valider/.test(trimmed)) {
        var allEntries = JSON.parse(pendingRaw);
        var toImport = allEntries;

        // "ignorer 2,5" → filtrer ces numéros (1-indexés)
        var ignoreMatch = trimmed.match(/ignorer\s+([\d,\s]+)/);
        if (ignoreMatch) {
          var skipNums = ignoreMatch[1].split(/[\s,]+/).map(Number).filter(Boolean);
          toImport = allEntries.filter(function(_, i) { return skipNums.indexOf(i + 1) === -1; });
        }

        cache.remove(pendingKey);
        return handleBatchEntries(orgId, toImport);
      }

      // Message non reconnu pendant un import en attente → rappeler les options
      if (!/^(budget|solde|dépenses|depenses|balance|journal|query)/i.test(trimmed)) {
        return '⏳ Import en attente. Répondez "importer", "ignorer 2,5" ou "annuler".';
      }
    }

    // Analyzor comprend, route, et exécute les queries — le Communicator ne fait que relayer
    var result = Bibliotheque.analyzorUnderstand(orgId, text, lastMsg, '');

    if (!result || !result.success) {
      return '❌ Erreur Analyzor : ' + ((result && result.error) || 'indisponible');
    }

    // Seules deux actions nécessitent le Communicator : les écritures et les constats de solde
    if (result.intent === 'add_entry')     return handleAddEntry(orgId, result);
    if (result.intent === 'balance_point') return handleBalancePoint(orgId, result);

    // Tout le reste (answer, query déjà exécutée, unclear) → réponse directe de l'Analyzor.
    // Détection de répétition : uniquement sur ce chemin conversationnel (pas sur les écritures/
    // confirmations d'import, qui répètent légitimement des messages fixes comme "❌ Import annulé.").
    var finalResponse = result.response || "Je n'ai pas compris.";
    if (lastResp && text !== lastMsg && _isNearlyIdenticalResponse(finalResponse, lastResp)) {
      finalResponse = _handleUnderstandingFailure(orgId, text, lastMsg, lastResp);
    }
    cache.put(respKey, finalResponse, 300);
    return finalResponse;

  } catch (error) {
    Logger.log('❌ communicate error: ' + error.message);
    return '❌ Une erreur est survenue : ' + error.message;
  }
}

// ================================================================
// DÉTECTION D'ÉCHEC DE COMPRÉHENSION (2026-08-06)
// ================================================================
// Retour de Stéphane : question sur un problème de connexion bancaire, réponse hors-sujet
// ("votre patrimoine est de 200000 euros") deux fois de suite. Critère explicite : "si deux fois
// la même réponse" à un message différent. Comparaison texte simple (pas d'embedding) — voir
// communicate() pour où c'est branché (cache comm_resp_ + orgId, TTL 5 min).

/**
 * Normalise un texte pour comparaison : minuscules, sans emoji ni ponctuation, espaces réduits.
 */
function _normalizeForCompare(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/(\d)\s+(?=\d)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Vrai si a et b sont identiques ou quasi-identiques une fois normalisés (recouvrement de mots
 * — indice de Jaccard — plutôt qu'une égalité stricte, pour couvrir les petites variations).
 */
function _isNearlyIdenticalResponse(a, b) {
  var na = _normalizeForCompare(a);
  var nb = _normalizeForCompare(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  var wa = na.split(' ').filter(Boolean);
  var wb = nb.split(' ').filter(Boolean);
  if (wa.length < 3 || wb.length < 3) return false;

  var setA = {};
  wa.forEach(function (w) { setA[w] = true; });
  var setB = {};
  wb.forEach(function (w) { setB[w] = true; });

  var inter = 0;
  Object.keys(setA).forEach(function (w) { if (setB[w]) inter++; });
  var union = Object.keys(setA).length + Object.keys(setB).length - inter;
  var jaccard = union > 0 ? inter / union : 0;
  return jaccard >= 0.85;
}

/**
 * Échec de compréhension confirmé : réponse honnête (ne prétend pas avoir compris), lien vers
 * le palier "Partenaire" (support prioritaire, voir OrgPanel.html), email de debug envoyé en
 * best-effort (try/catch, ne bloque jamais la réponse au user — Apps Script n'a pas de vraie
 * exécution en tâche de fond, mais un échec d'envoi ne doit jamais faire planter le chat).
 */
function _handleUnderstandingFailure(orgId, text, lastMsg, lastResp) {
  Logger.log('⚠️ [' + orgId + '] Echec de comprehension detecte (reponse repetee) : "' + text + '"');
  try {
    _sendUnderstandingFailureDebugEmail(orgId, text, lastMsg, lastResp);
  } catch (e) {
    Logger.log('❌ [' + orgId + '] Envoi email debug echoue : ' + e.message);
  }

  var orgUrl = NAVIGATOR_URL + '?orgId=' + encodeURIComponent(orgId);
  return [
    "Je crois que je n'ai pas compris ta question — je t'ai redonné deux fois la même réponse, ce n'est pas normal, désolé.",
    '',
    "Un signalement vient d'être envoyé à notre équipe pour regarder ce cas précis.",
    '',
    'En attendant, si tu veux un support humain prioritaire, le palier "Partenaire" (1€/mois) te donne accès à un vrai chat avec nous : ' +
      '<a href="' + orgUrl + '" target="_blank">ouvrir ton organisation</a>.'
  ].join('\n');
}

/**
 * Email de debug (MailApp — même mécanisme que sendReportEmail plus bas dans ce fichier).
 * L'email utilisateur n'est volontairement PAS résolu via Session.getActiveUser() : ce webapp
 * tourne en executeAs=USER_DEPLOYING/ANYONE_ANONYMOUS (voir appsscript.json), donc cet appel
 * renverrait TOUJOURS l'email du déployeur, jamais celui du visiteur réel — exactement le bug
 * réel déjà corrigé une fois côté OrgPanel.html (2026-08-02, "affichait avant l'email du
 * déployeur pour tout le monde"). Mieux vaut dire honnêtement "inconnu" que réintroduire ce bug.
 */
function _sendUnderstandingFailureDebugEmail(orgId, text, lastMsg, lastResp) {
  var orgName = orgId;
  try {
    var profile = Bibliotheque.identityGetOrgProfile(orgId);
    if (profile && profile.success && profile.name) orgName = profile.name;
  } catch (e) {}

  var subject = '[Communicator] Echec de comprehension repete — org ' + orgId;
  var body = [
    'Organisation : ' + orgName + ' (orgId=' + orgId + ')',
    'Email utilisateur : inconnu (session anonyme, executeAs=USER_DEPLOYING)',
    '',
    'Echange (2 derniers tours) :',
    '1) User: ' + lastMsg,
    '   Communicator: ' + lastResp,
    '2) User: ' + text,
    '   Communicator (avant correctif) : ' + lastResp + '  [réponse quasi-identique au tour précédent]',
    '',
    'Détection : deux réponses consécutives quasi-identiques (indice de Jaccard >= 0.85 sur les',
    "mots normalisés) alors que le message de l'utilisateur a changé. Voir Code.js::_isNearlyIdenticalResponse."
  ].join('\n');

  MailApp.sendEmail(DEBUG_EMAIL_ADDRESS, subject, body);
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

function handleBatchEntries(orgId, entries) {
  if (!entries || entries.length === 0) {
    return '📄 Document analysé — aucune écriture détectée.';
  }

  var ok = 0, ko = 0, total = 0;
  var lines = ['📄 Import Docling — ' + entries.length + ' écriture(s) détectée(s) :\n'];

  entries.forEach(function(e) {
    if (!e.libelle || e.montant === undefined || e.montant === null) { ko++; return; }
    var result = Bibliotheque.ledgerAddEntry(orgId, {
      libelle:  e.libelle,
      montant:  e.montant,
      sens:     e.sens === 'recette' ? 'recette' : 'depense',
      date:     e.date || null,
      compte:   e.compte || null,
    });
    if (result.success) {
      ok++;
      total += parseFloat(e.montant) || 0;
      lines.push('✅ ' + e.montant + '€ — ' + e.libelle + ' → ' + (result.compteNom || result.compte || ''));
    } else {
      ko++;
      lines.push('❌ ' + e.libelle + ' : ' + (result.error || 'erreur'));
    }
  });

  lines.push('\n' + ok + '/' + entries.length + ' écritures ajoutées · total ' + total.toFixed(2) + '€');
  if (ko > 0) lines.push('⚠️ ' + ko + ' écriture(s) ignorée(s) — vérifie le document.');
  return lines.join('\n');
}

// ================================================================
// CONSTAT DE SOLDE (Suivre Mes Comptes — pas une écriture classée)
// ================================================================

// ================================================================
// CONFIG SMTP (pour le connector de sortie email, §9) — saisie via Communicator
// ================================================================

/**
 * Enregistre l'IBAN de la copropriété dans le profil de l'organisation.
 * Commande : "iban FR76 XXXX XXXX XXXX XXXX XXXX XXX"
 */
function handleSetIban(orgId, text) {
  var m = text.match(/\b([A-Z]{2}[\d\s]{10,})\b/i);
  if (!m) return '❌ IBAN non reconnu. Exemple : "iban FR76 3000 4000 0500 0600 0700 089"';
  var iban = m[1].replace(/\s+/g, '').toUpperCase();
  if (iban.length < 14 || iban.length > 34) return '❌ IBAN invalide (' + iban.length + ' caractères).';

  var profile = Bibliotheque.identityGetOrgProfile(orgId);
  if (!profile || !profile.success || !profile.folderId) {
    return '❌ Organisation introuvable ou inaccessible.';
  }

  var result = Bibliotheque.identityUpdateOrgProfile(orgId, profile.folderId, { iban: iban });
  if (!result || !result.success) {
    return '❌ Erreur : ' + (result && result.errorCode || 'inconnue');
  }

  try {
    UrlFetchApp.fetch('http://213.32.16.118:8000/api/journal/log', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        orgId: orgId,
        actor: 'communicator',
        summary: '# IBAN copropriété enregistré',
        details: ['# IBAN : ' + iban]
      }),
      muteHttpExceptions: true
    });
  } catch(e) {}

  return '✅ IBAN enregistré : ' + iban + '\nIl apparaîtra sur les prochains appels de fonds.';
}


/**
 * Envoie les emails d'appel de fonds via MailApp (compte Google de l'utilisateur).
 * Appelle /api/copro/appel-fonds/email-preview pour obtenir les destinataires et corps,
 * puis envoie chaque email. Routage : mandataire si défini, sinon copropriétaire direct.
 * Commande : "envoyer appel" ou "appel de fonds email [Q4]"
 */
function handleAppelFondsEmail(orgId, text) {
  var ANALYZOR = 'http://213.32.16.118:8000';

  // Détecter trimestre optionnel (ex: "envoyer appel Q4")
  var trimMatch = text.match(/\bQ[1-4]\b/i);
  var trimParam = trimMatch ? '&trimestre=' + trimMatch[0].toUpperCase() : '';

  var previewUrl = ANALYZOR + '/api/copro/appel-fonds/email-preview?orgId=' + encodeURIComponent(orgId) + trimParam;
  var resp;
  try {
    resp = UrlFetchApp.fetch(previewUrl, {muteHttpExceptions: true});
  } catch(e) {
    return '❌ Erreur réseau : ' + e.message;
  }

  var data;
  try { data = JSON.parse(resp.getContentText()); } catch(e) { return '❌ Réponse invalide de l\'Analyzor.'; }
  if (!data.success) return '❌ ' + (data.error || 'Erreur inconnue');

  var emails = data.emails || [];
  if (!emails.length) return '📭 Aucun email à envoyer.';

  // Aperçu avant envoi
  var cache = CacheService.getScriptCache();
  var previewKey = 'appel_preview_' + orgId;
  cache.put(previewKey, JSON.stringify(data), 300);

  var lines = ['📬 Appel ' + data.trimestre + ' 2026 — ' + data.total.toFixed(2) + '€ total\n'];
  emails.forEach(function(e, i) {
    if (e.error) {
      lines.push((i+1) + '. ' + e.copro + ' — ⚠️ ' + e.error);
    } else {
      lines.push((i+1) + '. → ' + e.to + ' (' + e.destinataire + ') — ' + e.montant.toFixed(2) + '€');
    }
  });
  lines.push('\nRépondez "confirmer envoi" pour envoyer, "annuler" pour abandonner.');
  return lines.join('\n');
}


function sendAppelFondsEmails(orgId, data) {
  var sent = [], failed = [];
  (data.emails || []).forEach(function(e) {
    if (!e.to) { failed.push(e.copro + ' (email manquant)'); return; }
    try {
      MailApp.sendEmail({
        to: e.to,
        subject: e.subject,
        body: e.body,
      });
      sent.push(e.copro + ' → ' + e.to);
    } catch(err) {
      failed.push(e.copro + ' : ' + err.message);
    }
  });

  // Log dans le journal Structory (non-comptable — # prefix)
  if (sent.length) {
    try {
      UrlFetchApp.fetch('http://213.32.16.118:8000/api/journal/log', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          orgId: orgId,
          actor: 'communicator',
          summary: '# appel de fonds ' + data.trimestre + ' — ' + sent.length + ' email(s) envoyé(s)',
          details: sent.map(function(s) { return '# ' + s; })
        }),
        muteHttpExceptions: true
      });
    } catch(e) { /* journal failure non-bloquant */ }
  }

  var lines = ['✅ Appel ' + data.trimestre + ' 2026 envoyé\n'];
  sent.forEach(function(s) { lines.push('  ✓ ' + s); });
  if (failed.length) {
    lines.push('\n⚠️ Échecs :');
    failed.forEach(function(f) { lines.push('  ✗ ' + f); });
  }
  return lines.join('\n');
}


/**
 * Reconnaît "configure email host=... port=... user=... password=..." (n'importe quel ordre,
 * espaces tolérés). Jamais passé au LLM (voir communicate()). Le mot de passe n'est jamais
 * ré-affiché dans la réponse.
 */
function handleConfigureEmail(orgId, text) {
  const fields = {};
  const re = /(host|port|user|password)\s*=\s*("([^"]*)"|(\S+))/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    fields[m[1].toLowerCase()] = m[3] !== undefined ? m[3] : m[4];
  }

  const manquants = ['host', 'port', 'user', 'password'].filter(function (f) { return !fields[f]; });
  if (manquants.length) {
    return '❌ Il manque : ' + manquants.join(', ') + '.\n'
      + 'Format attendu : "configure email host=smtp.zoho.com port=587 user=toi@exemple.com password=xxxx"';
  }

  const value = JSON.stringify({ host: fields.host, port: fields.port, user: fields.user, password: fields.password });

  // Protocole en 2 temps (2026-07-25) : org_secrets.py (Python, chiffrement Fernet réel) ne
  // peut pas CRÉER un nouveau fichier (quota du compte de service) mais peut le REMPLIR une
  // fois qu'il existe (update_file, jamais bloqué). Premier appel : s'il manque des fichiers
  // (1re fois pour cette org/ce secret), Analyzor renvoie needs_bootstrap + la liste exacte à
  // créer — DriveApp (identité réelle) les crée vides, puis on rappelle une seconde fois.
  let result = Bibliotheque.analyzorSetSecret(orgId, 'email_smtp', value);

  if (!result.success && result.errorCode === 'needs_bootstrap') {
    const bootstrap = Bibliotheque.identityEnsureSecretPlaceholders(orgId, result.folderId, result.missingFiles);
    if (!bootstrap.success) {
      return '❌ Échec de la préparation du stockage : ' + (bootstrap.errorCode || 'erreur inconnue');
    }
    result = Bibliotheque.analyzorSetSecret(orgId, 'email_smtp', value);
  }

  if (!result.success) {
    return '❌ Échec de l\'enregistrement : ' + (result.errorCode || 'erreur inconnue');
  }

  return '✅ Config email enregistrée et chiffrée (' + fields.host + ':' + fields.port + ', ' + fields.user + '). Le mot de passe n\'est jamais réaffiché.';
}

/**
 * Écriture en partie double EXPLICITE — les deux comptes sont donnés directement par
 * l'utilisateur, aucune contrepartie devinée côté serveur (contrairement à handleAddEntry,
 * qui laisse le classement automatique choisir). Répond au besoin de contrôler/vérifier
 * la partie double (retour de Stéphane 2026-08-03). S'appuie sur /api/ledger/import
 * (Bibliotheque.ledgerImportEntries), qui vérifie réellement via ledger-cli que les jambes
 * s'équilibrent — jamais une simple déclaration non vérifiée.
 *
 * Syntaxe : "ecriture <libellé> | debit <compte> <montant> | credit <compte> <montant>"
 * (autant de jambes debit/credit que nécessaire, tant que la somme fait 0)
 */
function handleEcritureManuelle(orgId, text) {
  const parts = text.split('|').map(function (p) { return p.trim(); });
  if (parts.length < 3) {
    return '❌ Format attendu :\n"ecriture <libellé> | debit <compte> <montant> | credit <compte> <montant>"\n\n'
      + 'Exemple : "ecriture Achat fournitures | debit 606 45 | credit 512 45"';
  }

  const libelle = parts[0].replace(/^(ecriture|écriture)\s+/i, '').trim();
  if (!libelle) {
    return '❌ Il manque le libellé de l\'écriture (juste après "ecriture").';
  }

  const legs = [];
  for (let i = 1; i < parts.length; i++) {
    const m = parts[i].match(/^(debit|d[ée]bit|credit|cr[ée]dit)\s+(\S+)\s+([\d.,]+)$/i);
    if (!m) {
      return '❌ Jambe invalide : "' + parts[i] + '".\nFormat : "debit <compte> <montant>" ou "credit <compte> <montant>".';
    }
    const sensDebit = /^d/i.test(m[1]);
    const compte = m[2];
    const montant = parseFloat(m[3].replace(',', '.'));
    if (isNaN(montant) || montant <= 0) {
      return '❌ Montant invalide dans : "' + parts[i] + '" (doit être positif).';
    }
    legs.push({ compte: compte, amount: sensDebit ? montant : -montant });
  }

  const total = legs.reduce(function (s, l) { return s + l.amount; }, 0);
  if (Math.abs(total) > 0.01) {
    return '❌ Écriture déséquilibrée : la somme des jambes fait ' + total.toFixed(2)
      + '€ (devrait faire 0€). Vérifie tes débits/crédits.';
  }

  const today = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy/MM/dd');
  const result = Bibliotheque.ledgerImportEntries(orgId, [{ date: today, libelle: libelle, legs: legs }]);

  if (!result.success) {
    return '❌ Écriture refusée : ' + (result.error || 'erreur inconnue');
  }

  const lignes = legs.map(function (l) {
    return (l.amount >= 0 ? 'Débit  ' : 'Crédit ') + l.compte + ' : ' + Math.abs(l.amount).toFixed(2) + '€';
  }).join('\n');

  return '✅ Écriture enregistrée — partie double vérifiée par ledger-cli :\n' + lignes;
}

function handleBalancePoint(orgId, parsed) {
  if (!parsed.compteNom || parsed.solde === undefined || parsed.solde === null) {
    return "Il me manque le compte ou le solde — tu peux reformuler ?";
  }

  const comptes = getComptesForOrg(orgId);
  const compte = comptes.filter(function (c) { return c.contenu.nom === parsed.compteNom; })[0];

  if (!compte) {
    return '❌ Je ne trouve pas de compte nommé "' + parsed.compteNom + '" pour cette organisation.';
  }

  const result = Bibliotheque.executorBalancePoint(orgId, {
    etablissement: compte.contenu.etablissement,
    nature: compte.contenu.nature,
    solde: parsed.solde,
    devise: compte.contenu.devise_origine
  });

  if (!result.success) {
    return "❌ Constat de solde refusé : " + (result.error || 'erreur inconnue');
  }

  if (result.ecart === 0) {
    return `✅ Noté — le solde de ${compte.contenu.nom} n'a pas bougé (toujours ${parsed.solde}${compte.contenu.devise_origine}).`;
  }

  const sens = result.ecart > 0 ? 'en hausse' : 'en baisse';
  return `✅ Solde de ${compte.contenu.nom} mis à jour : ${parsed.solde}${compte.contenu.devise_origine} ` +
    `(${sens} de ${Math.abs(result.ecart).toFixed(2)}${compte.contenu.devise_origine} depuis le dernier relevé).`;
}

