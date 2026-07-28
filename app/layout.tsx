import './globals.css';

export const metadata = {
  title: 'HelperAI',
  description: 'AI-powered screen and speech analysis copilot',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-transparent text-white antialiased">
        {children}
      </body>
    </html>
  );
}
