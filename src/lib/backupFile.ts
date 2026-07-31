import { AppData } from './types';

// Partagé entre SettingsPanel (import depuis Réglages) et SetupWizard (import direct dès
// l'écran d'accueil, pour sauter l'initialisation quand on a déjà une sauvegarde).
export async function parseBackupFile(file: File): Promise<AppData> {
  // Retire un BOM éventuel (certains partages de fichiers iOS en ajoutent un en tête,
  // ce qui fait échouer JSON.parse sans que le fichier soit visuellement différent).
  const text = (await file.text()).replace(/^\uFEFF/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (parseErr) {
    // Erreur la plus utile à distance : dit où ça casse (souvent des guillemets
    // "intelligents" introduits par Notes/Mail/Messages si le fichier a été collé ou
    // édité comme texte quelque part avant l'import, plutôt qu'envoyé tel quel).
    throw new Error(`JSON illisible : ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
  }

  const imported: AppData | undefined =
    parsed && typeof parsed === 'object' && 'data' in parsed && typeof (parsed as { data: unknown }).data === 'object' ? (parsed as { data: AppData }).data :
    (parsed && typeof parsed === 'object' && Array.isArray((parsed as AppData).sessions) && Array.isArray((parsed as AppData).workoutTypes)) ? (parsed as AppData) :
    undefined;

  if (!imported || !Array.isArray(imported.workoutTypes) || !Array.isArray(imported.sessions)) {
    throw new Error('Structure inattendue : pas de "workoutTypes"/"sessions" reconnaissables.');
  }

  return imported;
}
