# HelperAI Copilot - Installation Instructions

Welcome to HelperAI! This app uses advanced AI to analyze your screen and answer coding questions.

Because this app was built independently and is not digitally signed through Apple's official $99/year Developer Program, macOS will flag it as an "unidentified developer" app and try to prevent it from opening.

**Follow these exact steps to install and open the app successfully:**

### 1. Install the App
1. Double-click the `HelperAI-0.0.0-arm64.dmg` file to mount it.
2. Drag the **HelperAI** app icon into your **Applications** folder shortcut.

### 2. Fix the macOS "Damaged App" Error
If you try to open the app now, your Mac might say *"HelperAI is damaged and can't be opened. You should move it to the Trash."* **It is not damaged!** This is just Mac's strict quarantine system blocking unsigned apps downloaded from the internet.

To remove the quarantine block:
1. Open the **Terminal** app on your Mac (Press `Cmd + Space`, type "Terminal", and hit Enter).
2. Copy and paste the following command into the terminal exactly as written and press Enter:
   ```bash
   xattr -cr /Applications/HelperAI.app
   ```
*(Note: This command simply removes Apple's quarantine flag from the application).*

### 3. Open the App
1. Go to your Applications folder and double-click **HelperAI**.
2. The app will open as a sleek, floating dark-mode toolbar on your screen.
3. Make sure whatever you want the AI to analyze (like a LeetCode problem) is visible on your screen, and click **Analyze Screen**!

Enjoy!

---

### For Developers: How to Build the App
If you are a developer looking to clone this project and build the `.dmg` file yourself from the source code, follow these steps:

1. **Prerequisites**: Ensure you have Node.js and npm installed.
2. **Clone the repository** and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Build the Application**:
   - **For Mac**: `npm run build:mac` (creates a `.dmg`)
   - **For Windows**: `npm run build:win` (creates a `.exe` installer)

5. Once finished, you will find the final installer in the `release/` folder!
