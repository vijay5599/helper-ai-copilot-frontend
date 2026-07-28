import { app, BrowserWindow, globalShortcut, ipcMain, session, systemPreferences, desktopCapturer, screen } from 'electron';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import { startWebSocketServer } from './server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const maxAllowedHeight = Math.floor(primaryDisplay.workAreaSize.height * 0.85);
  // Set to a compact height (400px) so the app stays discreet
  const initialHeight = Math.min(400, 800);

  mainWindow = new BrowserWindow({
    width: 800,
    height: initialHeight,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Hides the window from screen capturing software (Zoom, Meet, OBS)
  // mainWindow.setContentProtection(true); // Commented out temporarily for screenshots

  // Hide the app from the Windows taskbar
  if (process.platform === 'win32') {
    mainWindow.setSkipTaskbar(true);
  }

  // Load from Next.js dev server or compiled out/index.html
  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
  if (isDev) {
    const loadURLWithRetry = (url: string) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.loadURL(url).catch((err) => {
        console.log(`Failed to load ${url}, retrying in 1s...`);
        setTimeout(() => loadURLWithRetry(url), 1000);
      });
    };
    loadURLWithRetry('http://localhost:3000');
    // Automatically open Developer Tools in dev mode
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../out/index.html'));
  }

  // Redirect console messages from renderer to main process terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('resize-window', (event, height) => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: Math.ceil(height)
    });
  }
});

app.whenReady().then(() => {
  // Start local WebSocket backend server on port 8000
  startWebSocketServer(8000);

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

  // Register a 'Shift+Enter' shortcut listener.
  globalShortcut.register('Shift+Enter', () => {
    console.log('Shift+Enter is pressed: Triggering LLM');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('trigger-llm');
    }
  });

  // Ghost Mode: Toggle click-through and opacity
  let isGhostMode = false;
  globalShortcut.register('Alt+X', () => {
    isGhostMode = !isGhostMode;
    console.log(`Ghost Mode: ${isGhostMode}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      // forward: true allows mouse events to pass through to the OS behind the app
      mainWindow.setIgnoreMouseEvents(isGhostMode, { forward: true });
      mainWindow.webContents.send('toggle-ghost-mode', isGhostMode);
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
