import { app, BrowserWindow, globalShortcut, ipcMain, session, systemPreferences, desktopCapturer } from 'electron';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Hides the window from screen capturing software (Zoom, Meet, OBS)
  mainWindow.setContentProtection(true); // Commented out temporarily for screenshots

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
      // Select the first screen source to resolve the getDisplayMedia promise
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(err => {
      console.log('desktopCapturer error:', err);
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
      mainWindow.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: Math.ceil(height)
      });
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
