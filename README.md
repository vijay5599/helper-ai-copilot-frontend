# HelperAI Copilot

HelperAI is a floating desktop AI assistant built with React, Vite, Electron, and FastAPI. It analyzes your screen context in real-time and provides intelligent coding assistance—especially designed to help you solve LeetCode-style coding challenges!

## 🚀 How to Use the App

Once you have installed and opened the `HelperAI` application, it will run as a sleek, transparent toolbar that sits on top of all your other windows.

### Analyzing Your Screen (The "LeetCode Mode")
1. Open a coding challenge (like LeetCode, HackerRank, or an IDE) on your screen.
2. Bring the **HelperAI** toolbar into view.
3. Click the **"Analyze Screen"** button (or press your global shortcut if configured).
4. The AI will instantly read the problem on your screen, determine the optimal solution, and stream the bug-free code (along with time and space complexity) directly into the answer panel!

### Asking Voice Questions
1. Click the **"AI Help"** button.
2. The AI will listen to your microphone using Deepgram.
3. Speak your question out loud (e.g., *"How do I reverse a linked list in Python?"*).
4. The AI will stream the answer back to you in real-time!

### Navigating History
During long coding sessions, the AI remembers your previous questions!
* Use the **Left (←)** and **Right (→)** arrows in the answer panel to scroll back through past questions and answers.
* Click the small **X** next to an answer to delete that specific question from your history.
* Click the main **Clear** button (broom icon) in the top toolbar to completely wipe all history and reset the session.

---

## 🛠️ For Developers: How to Build the App

If you are a developer looking to clone this project and build the `.dmg` or `.exe` file yourself from the source code, follow these steps:

1. **Prerequisites**: Ensure you have Node.js and npm installed.
2. **Clone the repository** and navigate to the frontend directory:
   ```bash
   git clone https://github.com/vijay5599/helper-ai-copilot-frontend.git
   cd helper-ai-copilot-frontend
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Build the Application**:
   - **For Mac**: `npm run build:mac` (creates a `.dmg`)
   - **For Windows**: `npm run build:win` (creates a `.exe` installer)

5. Once finished, you will find the final installer in the `release/` folder!
