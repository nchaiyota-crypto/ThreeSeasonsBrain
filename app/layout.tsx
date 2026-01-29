import "./globals.css";

export const metadata = {
  title: "3 Seasons Online",
  description: "Online ordering",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">¸
      <body>{children}</body>
    </html>
  );
}