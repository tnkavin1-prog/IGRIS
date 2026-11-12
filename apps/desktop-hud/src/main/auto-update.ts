import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

export function startAutoUpdates(): () => void {
  if (!app.isPackaged || process.env.GEMATRON_CHECK_UPDATES !== 'true') return () => {};
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', () => console.warn('[Updater] Update check or download failed.'));
  autoUpdater.on('update-available', async (info) => {
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: 'Gemetron update',
      message: `Version ${info.version} is available. Download it?`,
      buttons: ['Download', 'Later'],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice.response === 0) await autoUpdater.downloadUpdate().catch(() => undefined);
  });
  autoUpdater.on('update-downloaded', async () => {
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: 'Gemetron update',
      message: 'The update is ready. Restart and install?',
      buttons: ['Restart', 'Later'],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice.response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  };
  check();
  const timer = setInterval(check, 6 * 60 * 60 * 1000);
  timer.unref();
  return () => {
    clearInterval(timer);
    autoUpdater.removeAllListeners();
  };
}
