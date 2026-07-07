import { app, BrowserWindow, globalShortcut, ipcMain, session, systemPreferences, desktopCapturer, screen } from 'electron';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const maxAllowedHeight = Math.floor(primaryDisplay.workAreaSize.height * 0.85);
  const initialHeight = Math.min(900, maxAllowedHeight);

  mainWindow = new BrowserWindow({
    width: 800,
    height: initialHeight,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Hides the window from screen capturing software (Zoom, Meet, OBS)
  mainWindow.setContentProtection(true); // Commented out temporarily for screenshots

  // Hide the app from the Windows taskbar
  if (process.platform === 'win32') {
    mainWindow.setSkipTaskbar(true);
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // Automatically open Developer Tools in dev mode
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone');
    // Hide the app from the macOS Dock
    if (app.dock) {
      app.dock.hide();
    }
  }

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources && sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        // Must call callback with null or throw to prevent promise from hanging
        callback(null as any);
      }
    }).catch(err => {
      console.log('desktopCapturer error:', err);
      callback(null as any);
    });
  });

  createWindow();

  // Register a 'CommandOrControl+Enter' shortcut listener.
  globalShortcut.register('CommandOrControl+Enter', () => {
    console.log('Ctrl+Enter is pressed: Triggering LLM');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('trigger-llm');
    }
  });

  ipcMain.on('resize-window', (event, { height }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      const currentDisplay = screen.getDisplayMatching(bounds);
      const maxAllowedHeight = Math.floor(currentDisplay.workAreaSize.height * 0.85);
      const targetHeight = Math.min(Math.ceil(height), maxAllowedHeight);

      if (bounds.height !== targetHeight) {
        mainWindow.setBounds({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: targetHeight
        });
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
